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
  let unloadInProgress = false;
  let lastDepositAt = Date.now();
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

  async function maybeDeposit(
    options: { force?: boolean; keepReserve?: boolean } = {},
  ): Promise<boolean> {
    if (unloadInProgress) return false;
    const force = options.force === true;
    const keepReserve = options.keepReserve !== false;
    const used = usedInventorySlots(bot);
    const timedDepositDue =
      Date.now() - lastDepositAt >= config.inventoryDepositIntervalMs;
    if (!force && !timedDepositDue && used < config.inventoryDepositThreshold) {
      return false;
    }

    const result = await depositToChest(bot, config, movement, logger, {
      keepReserve,
    });
    if (result.deposited) {
      lastDepositAt = Date.now();
      return true;
    }
    if (
      !result.deposited &&
      result.reason &&
      (used >= config.inventoryDepositThreshold || timedDepositDue || force)
    ) {
      logger.warn("Scheduled deposit failed.", result.reason);
    }
    return false;
  }

  async function runFarmCycle(triggeredBy = "manual"): Promise<void> {
    if (state.isFarming || unloadInProgress) return;
    state.isFarming = true;
    state.mode = "farming";
    interruptRequested = false;

    const cycleStartedAt = Date.now();
    let harvestedThisCycle = 0;

    try {
      const scannedJobs = scanMatureCrops(
        bot,
        config.farmScanRadius,
        config.farmScanMaxBlocks,
      );
      const jobs = selectLocalSquareBatch(scannedJobs);

      for (const job of jobs) {
        if (
          interruptRequested ||
          harvestedThisCycle >= config.farmBatchSize ||
          Date.now() - cycleStartedAt >= config.farmCycleMaxMs
        ) {
          break;
        }

        try {
          const harvested = await harvestAndReplant(job);
          if (harvested) {
            harvestedThisCycle += 1;
          }
        } catch (error) {
          logger.warn(
            "Skipping failed farm job.",
            error instanceof Error ? error.message : String(error),
          );
        }

        await maybeDeposit();
      }

      await maybeDeposit();

      stats.cycles += 1;
      logger.info(`Farm cycle complete (${triggeredBy}).`, {
        harvestedThisCycle,
        batchSize: config.farmBatchSize,
        jobsScanned: scannedJobs.length,
        jobsSelected: jobs.length,
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

  function selectLocalSquareBatch(jobs: HarvestJob[]): HarvestJob[] {
    if (!jobs.length) return [];
    const anchor = jobs[0].position;
    const radius = config.farmBatchSquareRadius;
    const squareBatch = jobs.filter(
      (job) =>
        Math.abs(job.position.x - anchor.x) <= radius &&
        Math.abs(job.position.z - anchor.z) <= radius,
    );
    if (!squareBatch.length) {
      return jobs.slice(0, config.farmBatchSize);
    }
    return squareBatch.slice(0, config.farmBatchSize);
  }

  async function unloadToChest(): Promise<boolean> {
    if (unloadInProgress) return false;

    interruptRequested = true;
    while (state.isFarming) {
      await wait(100);
    }

    unloadInProgress = true;
    try {
      const result = await depositToChest(bot, config, movement, logger, {
        keepReserve: false,
        includeAllItems: true,
      });
      if (result.deposited) {
        lastDepositAt = Date.now();
        return true;
      }
      return false;
    } finally {
      unloadInProgress = false;
    }
  }

  function getStats(): FarmStats {
    return { ...stats };
  }

  return {
    runFarmCycle,
    startAutoFarm,
    stopAutoFarm,
    interruptCurrentCycle,
    unloadToChest,
    getStats,
  };
}
