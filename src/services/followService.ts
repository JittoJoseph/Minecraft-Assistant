import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import type {
  AppConfig,
  AppState,
  FollowService,
  Logger,
  MovementService,
} from "../types";

const { GoalFollow } = goals;

export function createFollowService(
  bot: Bot,
  movement: MovementService,
  config: AppConfig,
  _logger: Logger,
  state: AppState,
): FollowService {
  function startFollow(username: string): void {
    const player = bot.players[username];
    if (!player?.entity) {
      throw new Error(`Cannot follow ${username}; player entity not found.`);
    }
    state.mode = "follow";
    state.followTarget = username;
    bot.pathfinder.setGoal(
      new GoalFollow(player.entity, config.followDistance),
      true,
    );
  }

  function stopFollow(): void {
    if (state.mode === "follow") {
      movement.stop();
      state.followTarget = null;
      state.mode = "patrolling";
    }
  }

  return { startFollow, stopFollow };
}
