import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import { loadSpawnBedPosition } from "./spawnPointStore";
import type {
  AfkService,
  AppConfig,
  AppState,
  FarmService,
  FollowService,
  Logger,
  MovementService,
  Position3,
  SleepService,
} from "../types";

function isBedBlock(block: any): boolean {
  return Boolean(block?.name && block.name.endsWith("_bed"));
}

function isNight(bot: Bot): boolean {
  const timeOfDay = bot.time.timeOfDay;
  return timeOfDay >= 12541 && timeOfDay <= 23458;
}

interface ActivitySnapshot {
  mode: AppState["mode"];
  followTarget: string | null;
  afkPosition: Position3 | null;
  autoFarmWasEnabled: boolean;
  wasFarming: boolean;
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
): SleepService {
  let autoSleepEnabled = false;
  let sleepInProgress = false;
  let resumeAfterWake: ActivitySnapshot | null = null;
  let nextAutoSleepAttemptAt = 0;

  function snapshotActivity(): ActivitySnapshot {
    return {
      mode: state.mode,
      followTarget: state.followTarget,
      afkPosition: state.afkPosition,
      autoFarmWasEnabled: farm.isAutoFarmEnabled(),
      wasFarming: state.isFarming,
    };
  }

  function pauseActivity(): void {
    follow.stopFollow();
    afk.stopAfk();
    farm.stopAutoFarm();
    farm.interruptCurrentCycle();
    movement.stop();
  }

  async function resumeActivity(snapshot: ActivitySnapshot): Promise<void> {
    if (snapshot.autoFarmWasEnabled) {
      farm.startAutoFarm();
      return;
    }
    if (snapshot.mode === "farming" || snapshot.wasFarming) {
      await farm.runFarmCycle("sleep_resume");
      return;
    }
    if (snapshot.mode === "follow" && snapshot.followTarget) {
      try {
        follow.startFollow(snapshot.followTarget);
      } catch (error) {
        logger.warn(
          "Could not resume follow after sleep.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }
    if (snapshot.mode === "afk") {
      await afk.startAfk(snapshot.afkPosition || undefined);
    }
  }

  bot.on("wake", () => {
    const snapshot = resumeAfterWake;
    resumeAfterWake = null;
    if (!snapshot) return;
    state.mode = "idle";
    resumeActivity(snapshot).catch((error: unknown) => {
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

    const spawnBed = await loadSpawnBedPosition();
    if (!spawnBed) {
      if (triggeredBy === "manual") {
        bot.chat("No saved spawn bed. Use setspawnpoint first.");
      } else {
        logger.warn("Autosleep is on, but no saved spawn bed was found.");
      }
      return false;
    }

    const bedPos = new Vec3(spawnBed.x, spawnBed.y, spawnBed.z);
    const bedBlock = bot.blockAt(bedPos);
    if (!isBedBlock(bedBlock)) {
      if (triggeredBy === "manual") {
        bot.chat("Saved spawn bed not found. Use setspawnpoint again.");
      } else {
        logger.warn("Autosleep bed not found at saved spawn point.");
      }
      return false;
    }

    sleepInProgress = true;
    const snapshot = snapshotActivity();
    pauseActivity();

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
      await resumeActivity(snapshot);
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

  async function maybeAutoSleep(): Promise<void> {
    if (!autoSleepEnabled || sleepInProgress || bot.isSleeping || !isNight(bot))
      return;
    if (Date.now() < nextAutoSleepAttemptAt) return;
    const slept = await sleepAtSpawnBed("auto");
    if (!slept) {
      nextAutoSleepAttemptAt = Date.now() + 15000;
    }
  }

  return {
    sleepAtSpawnBed,
    setAutoSleepEnabled,
    isAutoSleepEnabled,
    maybeAutoSleep,
  };
}
