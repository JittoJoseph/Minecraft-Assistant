import type { Bot } from "mineflayer";
import { Movements, goals } from "mineflayer-pathfinder";
import type { AppConfig, MovementService, Position3 } from "../types";

const { GoalNear, GoalBlock } = goals;

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

  async function goNear(
    position: Position3,
    range = 1,
    timeoutMs = config.movementTimeoutMs,
  ): Promise<void> {
    const goal = new GoalNear(position.x, position.y, position.z, range);
    await withTimeout(bot.pathfinder.goto(goal), timeoutMs, () =>
      bot.pathfinder.setGoal(null),
    );
  }

  async function goBlock(
    position: Position3,
    timeoutMs = config.movementTimeoutMs,
  ): Promise<void> {
    const goal = new GoalBlock(position.x, position.y, position.z);
    await withTimeout(bot.pathfinder.goto(goal), timeoutMs, () =>
      bot.pathfinder.setGoal(null),
    );
  }

  function stop(): void {
    bot.pathfinder.setGoal(null);
  }

  return { goNear, goBlock, stop };
}
