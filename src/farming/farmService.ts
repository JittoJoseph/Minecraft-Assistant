import type { Bot } from "mineflayer";
import type {
  AppConfig,
  AppState,
  FarmService,
  FarmStats,
  Logger,
  MovementService,
} from "../types";
import { toPositionKey } from "../utils/position";
import { replantCrop } from "./replant";
import { scanMatureCrops, type HarvestJob } from "./scanner";
import { depositToChest, usedInventorySlots } from "./storage";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFarmService(
  bot: Bot,
  movement: MovementService,
  config: AppConfig,
  logger: Logger,
  state: AppState,
): FarmService {
  let autoFarmEnabled = false;
  let autoFarmTimer: NodeJS.Timeout | null = null;
  let interruptRequested = false;
  const stats: FarmStats = {
    harvested: 0,
    replanted: 0,
    cycles: 0,
  };

  async function harvestAndReplant(job: HarvestJob): Promise<boolean> {
    const key = toPositionKey(job.position);
    state.cropMemory.set(key, job.cropType);

    const currentBlock = bot.blockAt(job.position);
    if (!currentBlock || currentBlock.name !== job.blockName) return false;

    await movement.goNear(job.position, 1);
    if (bot.tool?.equipForBlock) {
      await bot.tool.equipForBlock(currentBlock, {});
    }
    await bot.dig(currentBlock, true);
    await bot.waitForTicks(4);
    stats.harvested += 1;

    const cropType = state.cropMemory.get(key);
    if (!cropType) return true;
    const result = await replantCrop(bot, logger, job.position, cropType);
    if (result.success) {
      stats.replanted += 1;
    } else if (result.reason === "missing_seed") {
      logger.warn(`Seed shortage for ${cropType} at ${key}`);
    }

    return true;
  }

  async function maybeDeposit(force = false): Promise<void> {
    const used = usedInventorySlots(bot);
    if (!force && used < config.inventoryDepositThreshold) return;

    const result = await depositToChest(bot, config, movement, logger);
    if (!result.deposited && result.reason && used >= 30) {
      logger.warn("Inventory is getting full but deposit failed.", result.reason);
    }
  }

  async function runFarmCycle(triggeredBy = "manual"): Promise<void> {
    if (state.isFarming) return;
    state.isFarming = true;
    state.mode = "farming";
    interruptRequested = false;

    const cycleStartedAt = Date.now();
    let harvestedThisCycle = 0;
    let scanPasses = 0;

    try {
      while (
        !interruptRequested &&
        harvestedThisCycle < config.farmBatchSize &&
        Date.now() - cycleStartedAt < config.farmCycleMaxMs
      ) {
        const jobs = scanMatureCrops(bot, config.farmScanRadius, config.farmScanMaxBlocks);
        if (!jobs.length) break;

        let progressed = false;
        for (const job of jobs) {
          if (interruptRequested || harvestedThisCycle >= config.farmBatchSize) break;

          try {
            const harvested = await harvestAndReplant(job);
            if (harvested) {
              harvestedThisCycle += 1;
              progressed = true;
            }
          } catch (error) {
            logger.warn(
              "Skipping failed farm job.",
              error instanceof Error ? error.message : String(error),
            );
          }

          if (usedInventorySlots(bot) >= config.inventoryDepositThreshold) {
            await maybeDeposit();
          }
        }

        scanPasses += 1;
        if (!progressed) break;
      }

      // Keep headroom in inventory for continued autofarming.
      await maybeDeposit(usedInventorySlots(bot) > config.inventoryDepositThreshold - 2);

      stats.cycles += 1;
      logger.info(`Farm cycle complete (${triggeredBy}).`, {
        harvestedThisCycle,
        scanPasses,
        durationMs: Date.now() - cycleStartedAt,
        stats,
      });
    } catch (error) {
      logger.error(
        "Farm cycle failed.",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      state.isFarming = false;
      state.mode = "idle";
    }
  }

  async function runAutoFarmLoop(): Promise<void> {
    while (autoFarmEnabled) {
      await runFarmCycle("autofarm");
      if (!autoFarmEnabled) break;
      await wait(config.autoFarmIntervalMs);
    }
  }

  function startAutoFarm(): boolean {
    if (autoFarmEnabled) return false;
    autoFarmEnabled = true;

    autoFarmTimer = setTimeout(() => {
      runAutoFarmLoop().catch((error: unknown) => {
        logger.error(
          "Autofarm loop failed.",
          error instanceof Error ? error.message : String(error),
        );
        autoFarmEnabled = false;
      });
    }, 0);

    return true;
  }

  function stopAutoFarm(): boolean {
    if (!autoFarmEnabled) return false;
    autoFarmEnabled = false;
    if (autoFarmTimer) {
      clearTimeout(autoFarmTimer);
      autoFarmTimer = null;
    }
    return true;
  }

  function interruptCurrentCycle(): void {
    interruptRequested = true;
    movement.stop();
  }

  function getStats(): FarmStats {
    return { ...stats };
  }

  return { runFarmCycle, startAutoFarm, stopAutoFarm, interruptCurrentCycle, getStats };
}
