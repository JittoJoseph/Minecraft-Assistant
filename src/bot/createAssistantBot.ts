import mineflayer from "mineflayer";
import minecraftData from "minecraft-data";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
const autoEatModule = require("mineflayer-auto-eat");
import config from "../config/env";
import { createFarmService } from "../farming/farmService";
import { createAfkService } from "../services/afkService";
import { createCommandRouter } from "../services/commandRouter";
import { createFollowService } from "../services/followService";
import { createMovementService } from "../services/movement";
import { createSleepService } from "../services/sleepService";
import type { AppState, Position3 } from "../types";
import logger from "../utils/logger";

function resolvePluginFunction(mod: any): ((bot: any) => void) | null {
  if (typeof mod === "function") return mod;
  if (typeof mod?.plugin === "function") return mod.plugin;
  if (typeof mod?.loader === "function") return mod.loader;
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.default?.plugin === "function") return mod.default.plugin;
  if (typeof mod?.default?.loader === "function") return mod.default.loader;
  return null;
}

function safeLoadPlugin(bot: any, pluginCandidate: any, name: string): void {
  const plugin = resolvePluginFunction(pluginCandidate);
  if (!plugin) {
    logger.warn(`Skipping plugin '${name}' because export is not a function.`);
    return;
  }
  bot.loadPlugin(plugin);
}

function createState(defaultSpawnBed: Position3 | null): AppState {
  return {
    mode: "idle",
    followTarget: null,
    afkPosition: null,
    spawnBedPosition: defaultSpawnBed,
    isFarming: false,
    cropMemory: new Map(),
  };
}

export function createAssistantBot(): void {
  const state = createState(config.spawnBedPosition);
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
    logger.warn(
      `Reconnecting in ${delay}ms${reasonText} (attempt ${reconnectAttempt}).`,
    );
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

    safeLoadPlugin(bot, pathfinder, "mineflayer-pathfinder");
    safeLoadPlugin(bot, collectBlock, "mineflayer-collectblock");
    safeLoadPlugin(bot, toolPlugin, "mineflayer-tool");
    safeLoadPlugin(bot, autoEatModule, "mineflayer-auto-eat");

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
      const sleep = createSleepService(
        bot,
        config,
        logger,
        state,
        movement,
        follow,
        afk,
        farm,
      );
      const services = { movement, follow, afk, farm, sleep };
      const commandRouter = createCommandRouter(bot, config, logger, services);
      const anyBot = bot as any;
      let previousHealth = bot.health;
      let followResumeTimer: NodeJS.Timeout | null = null;

      function scheduleFollowResume(reason: string): void {
        if (state.mode !== "follow" || !state.followTarget) return;
        const followTarget = state.followTarget;
        if (followResumeTimer) {
          clearTimeout(followResumeTimer);
          followResumeTimer = null;
        }
        logger.warn(
          `Damage detected (${reason}). Letting native knockback resolve.`,
        );
        followResumeTimer = setTimeout(() => {
          followResumeTimer = null;
          if (state.mode !== "follow" || state.followTarget !== followTarget)
            return;
          const player = bot.players[followTarget];
          if (!player?.entity) return;
          try {
            follow.startFollow(followTarget);
          } catch (error) {
            logger.debug(
              "Could not resume follow after hit.",
              error instanceof Error ? error.message : String(error),
            );
          }
        }, 350);
      }

      function onDamage(reason: string): void {
        scheduleFollowResume(reason);
      }

      if (anyBot.autoEat) {
        const autoEat = anyBot.autoEat as {
          setOpts?: (opts: {
            priority?: string;
            minHunger?: number;
            bannedFood?: string[];
          }) => void;
          enableAuto?: () => void;
          enable?: () => void;
          options?: {
            priority?: string;
            startAt?: number;
            bannedFood?: string[];
          };
        };
        const bannedFood = [
          "rotten_flesh",
          "spider_eye",
          "poisonous_potato",
          "pufferfish",
        ];

        if (typeof autoEat.setOpts === "function") {
          autoEat.setOpts({
            priority: "saturation",
            minHunger: 14,
            bannedFood,
          });
        } else if (autoEat.options) {
          autoEat.options = {
            priority: "saturation",
            startAt: 14,
            bannedFood,
          };
        }

        if (typeof autoEat.enableAuto === "function") {
          autoEat.enableAuto();
        } else if (typeof autoEat.enable === "function") {
          autoEat.enable();
        } else {
          logger.warn(
            "Auto-eat plugin loaded, but no enable method was found.",
          );
        }
      }

      bot.on("chat", (username, message) => {
        commandRouter.handleChat(username, message).catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          logger.error("Chat handler error", text);
        });
      });

      bot.on("time", () => {
        sleep.maybeAutoSleep().catch((error: unknown) => {
          logger.warn(
            "Autosleep tick failed.",
            error instanceof Error ? error.message : String(error),
          );
        });
      });

      bot.on("entityHurt", (entity) => {
        if (entity.id !== bot.entity.id) return;
        onDamage("entityHurt");
      });

      bot.on("health", () => {
        if (bot.health < previousHealth) {
          onDamage("health_drop");
        }
        previousHealth = bot.health;
      });

      bot._client.on("entity_velocity", (packet: any) => {
        if (!bot.entity || packet.entityId !== bot.entity.id) return;
        const raw =
          packet?.velocity &&
          typeof packet.velocity.x === "number" &&
          typeof packet.velocity.y === "number" &&
          typeof packet.velocity.z === "number"
            ? packet.velocity
            : {
                x: packet.velocityX,
                y: packet.velocityY,
                z: packet.velocityZ,
              };
        if (
          typeof raw.x !== "number" ||
          typeof raw.y !== "number" ||
          typeof raw.z !== "number"
        ) {
          return;
        }
        bot.entity.velocity.set(raw.x / 8000, raw.y / 8000, raw.z / 8000);
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
      const serialized =
        typeof reason === "string" ? reason : JSON.stringify(reason);
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
