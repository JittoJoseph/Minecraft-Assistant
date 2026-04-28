import type { Bot } from "mineflayer";
import type {
  AppConfig,
  AppState,
  FarmService,
  FarmStats,
  Logger,
  MovementService,
  Position3,
} from "../types";
import { toPositionKey } from "../utils/position";
import { replantCrop } from "./replant";
import { isMatureCrop, scanMatureCrops, type HarvestJob } from "./scanner";
import { depositToChest, usedInventorySlots } from "./storage";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInterruptedMovementError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text === "movement_interrupted" ||
    text.includes("The goal was changed before it could be completed!")
  );
}

export function createFarmService(
  bot: Bot,
  movement: MovementService,
  config: AppConfig,
  logger: Logger,
  state: AppState,
): FarmService {
  const collectBlockApi = (bot as Bot & {
    collectBlock?: {
      collect?: (
        target: any,
        options?: { ignoreNoPath?: boolean },
      ) => Promise<void>;
    };
  }).collectBlock;
  const dropSweepEveryHarvests = 6;
  let autoFarmEnabled = false;
  let autoFarmTimer: NodeJS.Timeout | null = null;
  let autoFarmPatrolStep = 0;
  let autoFarmOrigin: { x: number; y: number; z: number } | null = null;
  let interruptRequested = false;
  let unloadInProgress = false;
  let pendingRespawnRecovery: {
    resumePosition: Position3;
    autoFarmWasEnabled: boolean;
    wasFarming: boolean;
  } | null = null;
  let respawnRecoveryInProgress = false;
  let lastDepositAt = Date.now();
  const stats: FarmStats = {
    harvested: 0,
    replanted: 0,
    cycles: 0,
  };

  function currentBlockPosition(): Position3 {
    return {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z),
    };
  }

  async function recoverFromRespawn(): Promise<void> {
    if (!pendingRespawnRecovery || respawnRecoveryInProgress) return;
    const recovery = pendingRespawnRecovery;
    pendingRespawnRecovery = null;
    respawnRecoveryInProgress = true;

    try {
      await wait(250);
      await movement.goNear(
        recovery.resumePosition,
        2,
        config.movementTimeoutMs * 4,
      );
    } catch (error) {
      if (isInterruptedMovementError(error)) {
        respawnRecoveryInProgress = false;
        return;
      }
      logger.warn(
        "Could not return to farm after respawn.",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      respawnRecoveryInProgress = false;
    }

    if (recovery.autoFarmWasEnabled && !autoFarmEnabled) {
      startAutoFarm();
      return;
    }
    if (recovery.wasFarming && !recovery.autoFarmWasEnabled) {
      await runFarmCycle("respawn");
    }
  }

  async function harvestAndReplant(job: HarvestJob): Promise<boolean> {
    const key = toPositionKey(job.position);
    state.cropMemory.set(key, job.cropType);

    const currentBlock = bot.blockAt(job.position);
    if (!currentBlock || !isMatureCrop(currentBlock) || currentBlock.name !== job.blockName) {
      return false;
    }

    await movement.goNear(job.position, 1);
    const targetBlock = bot.blockAt(job.position);
    if (!targetBlock || !isMatureCrop(targetBlock) || targetBlock.name !== job.blockName) {
      return false;
    }
    if (bot.tool?.equipForBlock) {
      await bot.tool.equipForBlock(targetBlock, {});
    }
    await bot.dig(targetBlock, true);
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

  async function collectNearbyDrops(): Promise<void> {
    if (!collectBlockApi?.collect) return;
    await bot.waitForTicks(3);

    const drops = Object.values(bot.entities)
      .filter((entity: any) => {
        if (!entity || entity.name !== "item" || !entity.position) return false;
        return bot.entity.position.distanceTo(entity.position) <= 8;
      })
      .sort(
        (a: any, b: any) =>
          bot.entity.position.distanceTo(a.position) -
          bot.entity.position.distanceTo(b.position),
      )
      .slice(0, 10);

    for (const drop of drops) {
      if (interruptRequested) break;
      try {
        await collectBlockApi.collect(drop, { ignoreNoPath: true });
      } catch (error) {
        if (isInterruptedMovementError(error)) continue;
        logger.debug(
          "Drop collect skipped.",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
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
    let harvestedSinceDropSweep = 0;

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
            harvestedSinceDropSweep += 1;
            if (harvestedSinceDropSweep >= dropSweepEveryHarvests) {
              harvestedSinceDropSweep = 0;
              await collectNearbyDrops();
            }
          }
        } catch (error) {
          if (interruptRequested && isInterruptedMovementError(error)) {
            break;
          }
          if (isInterruptedMovementError(error)) {
            continue;
          }
          logger.warn(
            "Skipping failed farm job.",
            error instanceof Error ? error.message : String(error),
          );
        }

        await maybeDeposit();
      }

      if (harvestedSinceDropSweep > 0) {
        await collectNearbyDrops();
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

  bot.on("death", () => {
    const wasFarming = state.mode === "farming" || state.isFarming;
    if (!autoFarmEnabled && !wasFarming) return;

    pendingRespawnRecovery = {
      resumePosition: currentBlockPosition(),
      autoFarmWasEnabled: autoFarmEnabled,
      wasFarming,
    };
    interruptRequested = true;
    movement.stop();
  });

  bot.on("spawn", () => {
    if (!pendingRespawnRecovery) return;
    setTimeout(() => {
      recoverFromRespawn().catch((error: unknown) => {
        logger.error(
          "Respawn farming recovery failed.",
          error instanceof Error ? error.message : String(error),
        );
      });
    }, 0);
  });

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

  function isAutoFarmEnabled(): boolean {
    return autoFarmEnabled;
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
      if (isInterruptedMovementError(error)) {
        return;
      }
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
    isAutoFarmEnabled,
    interruptCurrentCycle,
    unloadToChest,
    getStats,
  };
}
