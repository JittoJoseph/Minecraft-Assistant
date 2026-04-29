import type {
  AfkService,
  AppState,
  FarmService,
  FollowService,
  Logger,
  MovementService,
  Position3,
} from "../types";

export interface ActivitySnapshot {
  mode: AppState["mode"];
  followTarget: string | null;
  afkPosition: Position3 | null;
  autoFarmWasEnabled: boolean;
  wasFarming: boolean;
}

interface ActivityLifecycleOptions {
  farmTrigger: string;
  followResumeFailureMessage: string;
}

export function createActivityLifecycle(
  state: AppState,
  logger: Logger,
  movement: MovementService,
  follow: FollowService,
  afk: AfkService,
  farm: FarmService,
) {
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

  async function resumeActivity(
    snapshot: ActivitySnapshot,
    options: ActivityLifecycleOptions,
  ): Promise<void> {
    if (snapshot.autoFarmWasEnabled) {
      farm.startAutoFarm();
      return;
    }
    if (snapshot.mode === "farming" || snapshot.wasFarming) {
      await farm.runFarmCycle(options.farmTrigger);
      return;
    }
    if (snapshot.mode === "follow" && snapshot.followTarget) {
      try {
        follow.startFollow(snapshot.followTarget);
      } catch (error) {
        logger.warn(
          options.followResumeFailureMessage,
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }
    if (snapshot.mode === "afk") {
      await afk.startAfk(snapshot.afkPosition || undefined);
    }
  }

  return {
    snapshotActivity,
    pauseActivity,
    resumeActivity,
  };
}
