import { goals } from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import type {
  AfkService,
  AppState,
  EvadeService,
  FarmService,
  FollowService,
  Logger,
  MovementService,
} from "../types";
import {
  createActivityLifecycle,
  type ActivitySnapshot,
} from "./activityLifecycle";

const { GoalFollow, GoalInvert } = goals;
const EVADE_DURATION_MS = 60 * 1000;
const EVADE_FOLLOW_RANGE = 8;

interface AttackerRef {
  id: number;
  username?: string;
}

export function createEvadeService(
  bot: Bot,
  logger: Logger,
  state: AppState,
  movement: MovementService,
  follow: FollowService,
  afk: AfkService,
  farm: FarmService,
): EvadeService {
  let resumeAfterEvade: ActivitySnapshot | null = null;
  let attackerRef: AttackerRef | null = null;
  let evasionEndsAt = 0;
  let evasionTimer: NodeJS.Timeout | null = null;
  let evasionRefreshTimer: NodeJS.Timeout | null = null;
  const activity = createActivityLifecycle(
    state,
    logger,
    movement,
    follow,
    afk,
    farm,
  );

  function clearTimers(): void {
    if (evasionTimer) {
      clearTimeout(evasionTimer);
      evasionTimer = null;
    }
    if (evasionRefreshTimer) {
      clearInterval(evasionRefreshTimer);
      evasionRefreshTimer = null;
    }
  }

  function resolveAttackerEntity(): any | null {
    if (!attackerRef) return null;
    if (attackerRef.username) {
      return bot.players[attackerRef.username]?.entity || null;
    }
    return bot.entities[attackerRef.id] || null;
  }

  function attackerLabel(attacker: any): string {
    if (typeof attacker?.username === "string") return attacker.username;
    if (typeof attacker?.name === "string") return attacker.name;
    return `entity#${attacker?.id ?? "unknown"}`;
  }

  function applyEvadeGoal(attacker: any): void {
    bot.pathfinder.setGoal(
      new GoalInvert(new GoalFollow(attacker, EVADE_FOLLOW_RANGE)),
      true,
    );
  }

  function scheduleTimers(): void {
    clearTimers();
    const remainingMs = Math.max(1, evasionEndsAt - Date.now());
    evasionTimer = setTimeout(() => {
      cancelEvade(true);
    }, remainingMs);

    evasionRefreshTimer = setInterval(() => {
      if (Date.now() >= evasionEndsAt) {
        cancelEvade(true);
        return;
      }
      const attacker = resolveAttackerEntity();
      if (!attacker) return;
      applyEvadeGoal(attacker);
    }, 1500);
  }

  function startEvadeFromAttacker(attacker: any, reason = "unknown"): boolean {
    if (!attacker || attacker.id === bot.entity.id) return false;
    const attackerId =
      typeof attacker.id === "number" ? Math.floor(attacker.id) : null;
    if (attackerId === null) return false;

    const previousAttackerId = attackerRef?.id ?? null;
    const switchedTarget =
      previousAttackerId !== null && previousAttackerId !== attackerId;
    attackerRef = {
      id: attackerId,
      username:
        typeof attacker.username === "string" ? attacker.username : undefined,
    };

    if (state.mode !== "evading") {
      resumeAfterEvade = activity.snapshotActivity();
      activity.pauseActivity();
      state.mode = "evading";
      logger.warn(
        `Damage detected (${reason}). Evading ${attackerLabel(attacker)} for 60s.`,
      );
    } else if (switchedTarget) {
      logger.warn(
        `Switching evade target to latest attacker: ${attackerLabel(attacker)}.`,
      );
    }

    evasionEndsAt = Date.now() + EVADE_DURATION_MS;
    applyEvadeGoal(attacker);
    scheduleTimers();
    return true;
  }

  function cancelEvade(resumePrevious = false): boolean {
    if (state.mode !== "evading" && !resumeAfterEvade) return false;
    clearTimers();
    movement.stop();

    const snapshot = resumeAfterEvade;
    resumeAfterEvade = null;
    attackerRef = null;
    evasionEndsAt = 0;
    if (state.mode === "evading") {
      state.mode = "idle";
    }

    if (resumePrevious && snapshot) {
      activity
        .resumeActivity(snapshot, {
          farmTrigger: "evade_resume",
          followResumeFailureMessage: "Could not resume follow after evading.",
        })
        .catch((error: unknown) => {
          logger.error(
            "Failed to resume activity after evading.",
            error instanceof Error ? error.message : String(error),
          );
        });
    }
    return true;
  }

  function isEvading(): boolean {
    return state.mode === "evading";
  }

  return {
    startEvadeFromAttacker,
    cancelEvade,
    isEvading,
  };
}
