import type { Bot } from "mineflayer";
import { Movements, goals } from "mineflayer-pathfinder";
import type { AppConfig, MovementService, Position3 } from "../types";

const { GoalNear, GoalBlock } = goals;
const RETRY_DELAY_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMovementTimeout(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith("movement_timeout_");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(new Error(`movement_timeout_${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function createMovementService(
  bot: Bot,
  mcData: any,
  config: AppConfig,
): MovementService {
  const defaultMovements = new Movements(bot);
  defaultMovements.canDig = false;
  if (mcData.blocksByName.farmland) {
    defaultMovements.blocksToAvoid.add(mcData.blocksByName.farmland.id);
  }
  bot.pathfinder.setMovements(defaultMovements);

  async function runGoal(goal: any, timeoutMs: number): Promise<void> {
    try {
      await withTimeout(bot.pathfinder.goto(goal), timeoutMs, () =>
        bot.pathfinder.setGoal(null),
      );
    } catch (error) {
      if (!isMovementTimeout(error)) throw error;
      bot.pathfinder.setGoal(null);
      await wait(RETRY_DELAY_MS);
      await withTimeout(bot.pathfinder.goto(goal), timeoutMs, () =>
        bot.pathfinder.setGoal(null),
      );
    }
  }

  async function goNear(
    position: Position3,
    range = 1,
    timeoutMs = config.movementTimeoutMs,
  ): Promise<void> {
    await runGoal(new GoalNear(position.x, position.y, position.z, range), timeoutMs);
  }

  async function goBlock(
    position: Position3,
    timeoutMs = config.movementTimeoutMs,
  ): Promise<void> {
    await runGoal(new GoalBlock(position.x, position.y, position.z), timeoutMs);
  }

  function stop(): void {
    bot.pathfinder.setGoal(null);
  }

  return { goNear, goBlock, stop };
}
