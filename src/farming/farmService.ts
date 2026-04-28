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
  let autoFarmPatrolStep = 0;
  let autoFarmOrigin: { x: number; y: number; z: number } | null = null;
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

  async function runFarmCycle(triggeredBy = "manual"): Promise<number> {
    if (state.isFarming || unloadInProgress) return 0;
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
    return harvestedThisCycle;
  }

  async function runAutoFarmLoop(): Promise<void> {
    while (autoFarmEnabled) {
      const harvested = await runFarmCycle("autofarm");
      if (!autoFarmEnabled) break;
      if (harvested === 0) {
        await moveToNextPatrolPoint();
      }
      await wait(harvested > 0 ? 250 : config.autoFarmIntervalMs);
    }
  }

  function startAutoFarm(): boolean {
    if (autoFarmEnabled) return false;
    autoFarmEnabled = true;
    autoFarmPatrolStep = 0;
    autoFarmOrigin = {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z),
    };

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
    const radius = config.farmBatchSquareRadius;
    const cellSize = radius * 2 + 1;
    const groups = new Map<string, HarvestJob[]>();

    for (const job of jobs) {
      const cellX = Math.floor(job.position.x / cellSize);
      const cellZ = Math.floor(job.position.z / cellSize);
      const key = `${cellX},${cellZ}`;
      const group = groups.get(key);
      if (group) {
        group.push(job);
      } else {
        groups.set(key, [job]);
      }
    }

    const orderedGroups = Array.from(groups.values()).sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      const aDistance = bot.entity.position.distanceTo(a[0].position);
      const bDistance = bot.entity.position.distanceTo(b[0].position);
      return aDistance - bDistance;
    });

    const selected: HarvestJob[] = [];
    for (const group of orderedGroups) {
      const orderedGroup = group.sort(
        (a, b) =>
          bot.entity.position.distanceTo(a.position) -
          bot.entity.position.distanceTo(b.position),
      );
      for (const job of orderedGroup) {
        selected.push(job);
        if (selected.length >= config.farmBatchSize) {
          return selected;
        }
      }
    }

    return selected;
  }

  function getSpiralOffset(step: number): { x: number; z: number } {
    if (step <= 0) return { x: 0, z: 0 };
    const k = Math.ceil((Math.sqrt(step + 1) - 1) / 2);
    let t = 2 * k + 1;
    let m = t * t;
    t -= 1;

    if (step >= m - t) return { x: k - (m - step), z: -k };
    if (step >= m - 2 * t) return { x: -k, z: -k + (m - t - step) };
    if (step >= m - 3 * t) return { x: -k + (m - 2 * t - step), z: k };
    return { x: k, z: k - (m - 3 * t - step) };
  }

  async function moveToNextPatrolPoint(): Promise<void> {
    if (!autoFarmOrigin) {
      autoFarmOrigin = {
        x: Math.floor(bot.entity.position.x),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z),
      };
      autoFarmPatrolStep = 0;
    }

    autoFarmPatrolStep += 1;
    const offset = getSpiralOffset(autoFarmPatrolStep);
    const stride = Math.max(8, config.farmBatchSquareRadius * 2 + 2);
    const target = {
      x: autoFarmOrigin.x + offset.x * stride,
      y: autoFarmOrigin.y,
      z: autoFarmOrigin.z + offset.z * stride,
    };

    try {
      await movement.goNear(target, 2, config.movementTimeoutMs * 2);
    } catch (error) {
      logger.warn(
        "Autofarm patrol move failed.",
        error instanceof Error ? error.message : String(error),
      );
    }
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
