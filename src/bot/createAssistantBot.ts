import mineflayer from "mineflayer";
import minecraftData from "minecraft-data";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
const autoEatModule = require("mineflayer-auto-eat");
import config from "../config/env";
import { createFarmService } from "../farming/farmService";
import { createAfkService } from "../services/afkService";
import { createCombatService } from "../services/combatService";
import { createCommandRouter } from "../services/commandRouter";
import { createDiscordService } from "../services/discordService";
import { createFollowService } from "../services/followService";
import { createGearService } from "../services/gearService";
import { createMovementService } from "../services/movement";
import { createPatrolService } from "../services/patrolService";
import { createSleepService } from "../services/sleepService";
import type { AppState, Position3, Services } from "../types";
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
    mode: "patrolling",
    followTarget: null,
    afkPosition: null,
    spawnBedPosition: defaultSpawnBed,
    isFarming: false,
    cropMemory: new Map(),
  };
}

function resetTransientState(state: AppState): void {
  state.mode = "patrolling";
  state.followTarget = null;
  state.isFarming = false;
}

export function createAssistantBot(): void {
  const state = createState(config.spawnBedPosition);
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let lastKickWasSpam = false;
  let shouldResumeAutoFarmAfterReconnect = false;
  let activeServices: Services | null = null;

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
      resetTransientState(state);
      logger.info(
        `Spawned as '${bot.username}' (${config.appName} | ${config.inGameLabel}).`,
      );

      const mcData = minecraftData(bot.version);
      const movement = createMovementService(bot, mcData, config);
      const patrol = createPatrolService(bot, movement, config, logger, state);
      const follow = createFollowService(bot, movement, config, logger, state);
      const afk = createAfkService(bot, movement, config, state);
      const gear = createGearService(bot, config, movement, logger);
      const farm = createFarmService(bot, movement, config, logger, state, gear);
      const sleep = createSleepService(
        bot,
        config,
        logger,
        state,
        movement,
        follow,
        afk,
        farm,
        patrol,
      );
      const combat = createCombatService(
        bot,
        logger,
        state,
        movement,
        follow,
        afk,
        farm,
        patrol,
        gear,
      );
      const discord = createDiscordService(config.discordWebhookUrl, bot.username, logger);
      const services = {
        movement,
        follow,
        afk,
        farm,
        sleep,
        gear,
        combat,
        patrol,
        discord,
      };
      activeServices = services;
      const commandRouter = createCommandRouter(bot, config, logger, services);
      const anyBot = bot as any;
      const recentEntitySwingAt = new Map<number, number>();
      let lastKnownHealth = bot.health;

      function inferDamageSource(): any | null {
        const now = Date.now();
        let bestCandidate: any | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of Object.values(bot.entities) as any[]) {
          if (!candidate || candidate.id === bot.entity.id || !candidate.position) {
            continue;
          }
          if (
            candidate.type !== "player" &&
            candidate.type !== "mob" &&
            candidate.type !== "hostile" &&
            candidate.type !== "monster"
          ) {
            continue;
          }
          const swungAt = recentEntitySwingAt.get(candidate.id) || 0;
          const distance = bot.entity.position.distanceTo(candidate.position);
          const scoredDistance = now - swungAt <= 1500 ? distance : distance + 2;
          if (distance > 6.5 || scoredDistance >= bestDistance) continue;
          bestCandidate = candidate;
          bestDistance = scoredDistance;
        }
        return bestCandidate;
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

      bot.on("playerJoined", (player) => {
        const username = typeof player?.username === "string" ? player.username : "";
        if (!username || username === bot.username) return;
        services.discord.notifyPlayerJoined(username).catch((error: unknown) => {
          logger.warn(
            "Discord join notification failed.",
            error instanceof Error ? error.message : String(error),
          );
        });
      });

      bot.on("playerLeft", (player) => {
        const username = typeof player?.username === "string" ? player.username : "";
        if (!username || username === bot.username) return;
        services.discord.notifyPlayerLeft(username).catch((error: unknown) => {
          logger.warn(
            "Discord leave notification failed.",
            error instanceof Error ? error.message : String(error),
          );
        });
      });

      bot.on("entityHurt", (entity, source) => {
        if (entity.id !== bot.entity.id) return;
        const attacker =
          source && source.id !== bot.entity.id ? source : inferDamageSource();
        combat.retaliateFromDamageEvent(attacker, "entity_hurt");
      });

      bot.on("health", () => {
        if (bot.health < lastKnownHealth) {
          combat.retaliateFromDamageEvent(undefined, "health_drop");
        }
        lastKnownHealth = bot.health;
      });

      bot.on("entitySwingArm", (entity) => {
        if (!entity?.id || entity.id === bot.entity.id) return;
        const now = Date.now();
        recentEntitySwingAt.set(entity.id, now);
        for (const [entityId, swungAt] of recentEntitySwingAt.entries()) {
          if (now - swungAt > 5000) {
            recentEntitySwingAt.delete(entityId);
          }
        }
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

      services.gear.ensureCombatGear("spawn").catch((error: unknown) => {
        logger.warn(
          "Spawn gear check failed.",
          error instanceof Error ? error.message : String(error),
        );
      });

      const shouldStartAutoFarm =
        shouldResumeAutoFarmAfterReconnect || config.autoFarmOnStart;
      if (shouldStartAutoFarm) {
        shouldResumeAutoFarmAfterReconnect = false;
        if (services.farm.startAutoFarm()) {
          logger.warn(
            config.autoFarmOnStart
              ? "Autofarm started from AUTOFARM_ON_START."
              : "Resuming autofarm after reconnect.",
          );
        }
      } else {
        services.patrol.startPatrol();
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
      if (activeServices?.farm.isAutoFarmEnabled()) {
        shouldResumeAutoFarmAfterReconnect = true;
      }
      if (activeServices) {
        activeServices.combat.cancelCombat(false);
        activeServices.farm.stopAutoFarm();
        activeServices.farm.interruptCurrentCycle();
        activeServices.afk.stopAfk();
        activeServices.follow.stopFollow();
        activeServices.patrol.stopPatrol();
        activeServices.movement.stop();
      }
      activeServices = null;
      logger.warn("Disconnected from server.");
      scheduleReconnect();
    });
  }

  connect();
}
