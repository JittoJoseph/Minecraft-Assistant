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

  async function startAfk(position?: Position3): Promise<void> {
    const targetPos: Position3 = position || config.afkPosition || {
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
      // small random movement to appear alive: occasional jump and look-around
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 200);
      // slight yaw change to look like activity
      const deltaYaw = (Math.random() - 0.5) * 0.4;
      try { bot.look(bot.entity.yaw + deltaYaw, bot.entity.pitch, false); } catch (e) {}
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
