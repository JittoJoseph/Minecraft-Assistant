import type { Bot } from "mineflayer";
import type {
  AfkService,
  AppConfig,
  AppState,
  MovementService,
  Position3,
} from "../types";

export function createAfkService(
  bot: Bot,
  movement: MovementService,
  config: AppConfig,
  state: AppState,
): AfkService {
  let jumpTimer: NodeJS.Timeout | null = null;

  function clearJumpTimer(): void {
    if (jumpTimer) {
      clearInterval(jumpTimer);
      jumpTimer = null;
    }
  }

  async function startAfk(): Promise<void> {
    const targetPos: Position3 = config.afkPosition || {
      x: Math.floor(bot.entity.position.x),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z),
    };

    state.mode = "afk";
    state.afkPosition = targetPos;
    await movement.goBlock(targetPos);

    clearJumpTimer();
    jumpTimer = setInterval(() => {
      if (state.mode !== "afk") return;
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 200);
    }, config.afkJumpIntervalMs);
  }

  function stopAfk(): void {
    if (state.mode === "afk") {
      clearJumpTimer();
      movement.stop();
      state.mode = "idle";
    }
  }

  return { startAfk, stopAfk };
}
