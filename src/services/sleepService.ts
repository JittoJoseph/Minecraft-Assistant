import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type {
  AfkService,
  AppConfig,
  AppState,
  FarmService,
  FollowService,
  Logger,
  MovementService,
  PatrolService,
  Position3,
  SleepService,
} from "../types";
import {
  createActivityLifecycle,
  type ActivitySnapshot,
} from "./activityLifecycle";

function isBedBlock(block: any): boolean {
  return Boolean(block?.name && block.name.endsWith("_bed"));
}

function isNight(bot: Bot): boolean {
  const timeOfDay = bot.time.timeOfDay;
  return timeOfDay >= 12541 && timeOfDay <= 23458;
}

export function createSleepService(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  state: AppState,
  movement: MovementService,
  follow: FollowService,
  afk: AfkService,
  farm: FarmService,
  patrol: PatrolService,
): SleepService {
  let autoSleepEnabled = true;
  let sleepInProgress = false;
  let resumeAfterWake: ActivitySnapshot | null = null;
  let nextAutoSleepAttemptAt = 0;
  const activity = createActivityLifecycle(
    state,
    logger,
    movement,
    follow,
    afk,
    farm,
    patrol,
  );

  bot.on("wake", () => {
    const snapshot = resumeAfterWake;
    resumeAfterWake = null;
    if (!snapshot) return;
    state.mode = "patrolling";
    activity
      .resumeActivity(snapshot, {
        farmTrigger: "sleep_resume",
        followResumeFailureMessage: "Could not resume follow after sleep.",
      })
      .catch((error: unknown) => {
        logger.error(
          "Failed to resume activity after sleep.",
          error instanceof Error ? error.message : String(error),
        );
      });
  });

  async function sleepAtSpawnBed(
    triggeredBy: "manual" | "auto" = "manual",
  ): Promise<boolean> {
    if (sleepInProgress) return false;
    if (triggeredBy === "auto" && !autoSleepEnabled) return false;
    if (triggeredBy === "auto" && !isNight(bot)) return false;
    if (triggeredBy === "auto" && state.mode === "afk") return false;
    if (triggeredBy === "auto" && state.mode === "evading") return false;

    const spawnBed = state.spawnBedPosition;
    if (!spawnBed) {
      if (triggeredBy === "manual") {
        bot.chat(
          "No spawn bed configured. Use setspawnpoint or env SPAWN_BED_X/Y/Z.",
        );
      } else {
        logger.warn("Autosleep is on, but no spawn bed is configured.");
      }
      return false;
    }

    const bedPos = new Vec3(spawnBed.x, spawnBed.y, spawnBed.z);
    const bedBlock = bot.blockAt(bedPos);
    if (!isBedBlock(bedBlock)) {
      if (triggeredBy === "manual") {
        bot.chat("Configured spawn bed not found. Use setspawnpoint again.");
      } else {
        logger.warn("Autosleep bed not found at configured spawn point.");
      }
      return false;
    }

    sleepInProgress = true;
    const snapshot = activity.snapshotActivity();
    activity.pauseActivity();

    try {
      await movement.goNear(bedBlock.position, 1, config.movementTimeoutMs * 2);
      await bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5), true);

      if (bot.isSleeping) {
        resumeAfterWake = snapshot;
        state.mode = "sleeping";
        return true;
      }

      await bot.sleep(bedBlock);
      resumeAfterWake = snapshot;
      state.mode = "sleeping";
      return true;
    } catch (error) {
      await activity.resumeActivity(snapshot, {
        farmTrigger: "sleep_resume",
        followResumeFailureMessage: "Could not resume follow after sleep.",
      });
      if (triggeredBy === "manual") {
        bot.chat(
          `Could not sleep now: ${error instanceof Error ? error.message : String(error)}`,
        );
      } else {
        logger.warn(
          "Autosleep failed.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return false;
    } finally {
      sleepInProgress = false;
    }
  }

  function setAutoSleepEnabled(enabled: boolean): boolean {
    const changed = autoSleepEnabled !== enabled;
    autoSleepEnabled = enabled;
    if (!enabled) {
      nextAutoSleepAttemptAt = 0;
    }
    return changed;
  }

  function isAutoSleepEnabled(): boolean {
    return autoSleepEnabled;
  }

  function setSpawnBedPosition(position: Position3): void {
    state.spawnBedPosition = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
  }

  function getSpawnBedPosition(): Position3 | null {
    return state.spawnBedPosition ? { ...state.spawnBedPosition } : null;
  }

  async function maybeAutoSleep(): Promise<void> {
    if (
      !autoSleepEnabled ||
      sleepInProgress ||
      bot.isSleeping ||
      state.mode === "afk" ||
      state.mode === "evading" ||
      !isNight(bot)
    )
      return;
    if (Date.now() < nextAutoSleepAttemptAt) return;
    const slept = await sleepAtSpawnBed("auto");
    if (!slept) {
      nextAutoSleepAttemptAt = Date.now() + 15000;
    }
  }

  return {
    sleepAtSpawnBed,
    setSpawnBedPosition,
    getSpawnBedPosition,
    setAutoSleepEnabled,
    isAutoSleepEnabled,
    maybeAutoSleep,
  };
}
