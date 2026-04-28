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

export function createFarmService(
  bot: Bot,
  movement: MovementService,
  config: AppConfig,
  logger: Logger,
  state: AppState,
): FarmService {
  let autoFarmTimer: NodeJS.Timeout | null = null;
  const stats: FarmStats = {
    harvested: 0,
    replanted: 0,
    cycles: 0,
  };

  async function harvestAndReplant(job: HarvestJob): Promise<void> {
    const key = toPositionKey(job.position);
    state.cropMemory.set(key, job.cropType);

    const currentBlock = bot.blockAt(job.position);
    if (!currentBlock || currentBlock.name !== job.blockName) return;

    await movement.goNear(job.position, 1);
    if (bot.tool?.equipForBlock) {
      await bot.tool.equipForBlock(currentBlock, {});
    }
    await bot.dig(currentBlock, true);
    stats.harvested += 1;

    await bot.waitForTicks(5);
    const cropType = state.cropMemory.get(key);
    if (!cropType) return;
    const result = await replantCrop(bot, logger, job.position, cropType);
    if (result.success) {
      stats.replanted += 1;
    } else if (result.reason === "missing_seed") {
      logger.warn(`Seed shortage for ${cropType} at ${key}`);
    }
  }

  async function maybeDeposit(): Promise<void> {
    if (usedInventorySlots(bot) >= config.inventoryDepositThreshold) {
      await depositToChest(bot, config, movement, logger);
    }
  }

  async function runFarmCycle(triggeredBy = "manual"): Promise<void> {
    if (state.isFarming) return;
    state.isFarming = true;
    state.mode = "farming";
    try {
      const jobs = scanMatureCrops(
        bot,
        config.farmScanRadius,
        config.farmScanMaxBlocks,
      ).slice(0, config.farmBatchSize);

      for (const job of jobs) {
        await harvestAndReplant(job);
        await maybeDeposit();
      }

      stats.cycles += 1;
      logger.info(`Farm cycle complete (${triggeredBy}).`, {
        jobs: jobs.length,
        stats,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      logger.error("Farm cycle failed.", text);
    } finally {
      state.isFarming = false;
      state.mode = "idle";
    }
  }

  function startAutoFarm(): boolean {
    if (autoFarmTimer) return false;
    autoFarmTimer = setInterval(() => {
      runFarmCycle("autofarm").catch((err: unknown) => {
        const text = err instanceof Error ? err.message : String(err);
        logger.error("Autofarm cycle error.", text);
      });
    }, config.autoFarmIntervalMs);
    return true;
  }

  function stopAutoFarm(): boolean {
    if (!autoFarmTimer) return false;
    clearInterval(autoFarmTimer);
    autoFarmTimer = null;
    return true;
  }

  function getStats(): FarmStats {
    return { ...stats };
  }

  return { runFarmCycle, startAutoFarm, stopAutoFarm, getStats };
}
