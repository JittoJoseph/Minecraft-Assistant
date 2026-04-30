import type { Bot } from "mineflayer";
import type {
  AppConfig,
  AppState,
  Logger,
  MovementService,
  PatrolService,
  Position3,
} from "../types";

const PATROL_RADIUS = 4;
const PATROL_MOVE_RANGE = 1;
const PATROL_WAIT_MS = 1200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomOffset(radius: number): number {
  return Math.floor(Math.random() * (radius * 2 + 1)) - radius;
}

export function createPatrolService(
  bot: Bot,
  movement: MovementService,
  config: AppConfig,
  logger: Logger,
  state: AppState,
): PatrolService {
  let patrolAnchor: Position3 | null = null;
  let patrolActive = false;
  let patrolGeneration = 0;

  function currentBlockPosition(): Position3 {
    return {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z),
    };
  }

  async function patrolLoop(generation: number): Promise<void> {
    while (patrolActive && patrolGeneration === generation) {
      if (state.mode !== "patrolling") {
        await wait(200);
        continue;
      }
      if (!patrolAnchor) {
        patrolAnchor = currentBlockPosition();
      }

      const target: Position3 = {
        x: patrolAnchor.x + randomOffset(PATROL_RADIUS),
        y: patrolAnchor.y,
        z: patrolAnchor.z + randomOffset(PATROL_RADIUS),
      };

      try {
        await movement.goNear(
          target,
          PATROL_MOVE_RANGE,
          config.movementTimeoutMs,
        );
      } catch (error) {
        logger.debug(
          "Patrol move skipped.",
          error instanceof Error ? error.message : String(error),
        );
      }

      await wait(PATROL_WAIT_MS);
    }
  }

  function startPatrol(anchor?: Position3): boolean {
    if (anchor) {
      patrolAnchor = {
        x: Math.floor(anchor.x),
        y: Math.floor(anchor.y),
        z: Math.floor(anchor.z),
      };
    } else if (!patrolAnchor || state.mode !== "patrolling") {
      patrolAnchor = currentBlockPosition();
    }
    state.mode = "patrolling";

    if (patrolActive) return false;
    patrolActive = true;
    patrolGeneration += 1;
    const generation = patrolGeneration;
    setTimeout(() => {
      patrolLoop(generation).catch((error: unknown) => {
        logger.error(
          "Patrol loop failed.",
          error instanceof Error ? error.message : String(error),
        );
      });
    }, 0);
    return true;
  }

  function stopPatrol(): boolean {
    if (!patrolActive) return false;
    patrolActive = false;
    patrolGeneration += 1;
    movement.stop();
    return true;
  }

  function isPatrolling(): boolean {
    return patrolActive && state.mode === "patrolling";
  }

  return {
    startPatrol,
    stopPatrol,
    isPatrolling,
  };
}
