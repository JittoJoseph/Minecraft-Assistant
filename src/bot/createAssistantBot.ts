import mineflayer from "mineflayer";
import minecraftData from "minecraft-data";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
import config from "../config/env";
import { createFarmService } from "../farming/farmService";
import { createAfkService } from "../services/afkService";
import { createCommandRouter } from "../services/commandRouter";
import { createFollowService } from "../services/followService";
import { createMovementService } from "../services/movement";
import type { AppState } from "../types";
import logger from "../utils/logger";

function createState(): AppState {
  return {
    mode: "idle",
    followTarget: null,
    afkPosition: null,
    isFarming: false,
    cropMemory: new Map(),
  };
}

export function createAssistantBot(): void {
  const state = createState();
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let lastKickWasSpam = false;

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectAttempt += 1;
    const baseDelay = lastKickWasSpam ? 30000 : config.reconnectBaseDelayMs;
    const delay = Math.min(
      baseDelay * Math.max(1, reconnectAttempt),
      config.reconnectMaxDelayMs,
    );
    const reasonText = lastKickWasSpam ? " (spam cooldown)" : "";
    logger.warn(`Reconnecting in ${delay}ms${reasonText} (attempt ${reconnectAttempt}).`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      lastKickWasSpam = false;
      connect();
    }, delay);
  }

  function connect(): void {
    const bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth as "offline" | "microsoft" | "mojang",
      version: config.version || undefined,
    });

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(toolPlugin);

    bot.once("spawn", () => {
      reconnectAttempt = 0;
      logger.info(
        `Spawned as '${bot.username}' (${config.appName} | ${config.inGameLabel}).`,
      );

      const mcData = minecraftData(bot.version);
      const movement = createMovementService(bot, mcData, config);
      const follow = createFollowService(bot, movement, config, logger, state);
      const afk = createAfkService(bot, movement, config, state);
      const farm = createFarmService(bot, movement, config, logger, state);
      const services = { movement, follow, afk, farm };
      const commandRouter = createCommandRouter(bot, config, logger, services);

      bot.on("chat", (username, message) => {
        commandRouter.handleChat(username, message).catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          logger.error("Chat handler error", text);
        });
      });

      if (config.afkPosition) {
        state.afkPosition = {
          x: config.afkPosition.x,
          y: config.afkPosition.y,
          z: config.afkPosition.z,
        };
      }
    });

    bot.on("kicked", (reason) => {
      const serialized = typeof reason === "string" ? reason : JSON.stringify(reason);
      lastKickWasSpam = serialized.includes("disconnect.spam");
      logger.warn("Kicked from server.", reason);
    });
    bot.on("error", (error) => logger.error("Bot error.", error.message));
    bot.on("end", () => {
      logger.warn("Disconnected from server.");
      scheduleReconnect();
    });
  }

  connect();
}
