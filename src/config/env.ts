import dotenv from "dotenv";
import type { AppConfig } from "../types";
import { parseServerAddress } from "../utils/position";

// Minimal env usage: server, username, auth
dotenv.config();

const parsedAddress = parseServerAddress(process.env.MINECRAFT_SERVER);

const config: AppConfig = {
  appName: process.env.APP_NAME || "Minecraft Assistant",
  inGameLabel: process.env.INGAME_LABEL || "TigerBaby",
  host: parsedAddress?.host || process.env.MINECRAFT_HOST || "fullcrewserver.aternos.me",
  port: parsedAddress?.port || Number(process.env.MINECRAFT_PORT || 25172),
  username: process.env.BOT_USERNAME || "TigerBaby",
  auth: process.env.MINECRAFT_AUTH || "offline",
  version: process.env.MINECRAFT_VERSION || false,

  // Defaults kept in code (not configurable via env in minimal mode)
  followDistance: 2,
  farmScanRadius: 32,
  farmScanMaxBlocks: 256,
  farmBatchSize: 64,
  autoFarmIntervalMs: 5 * 60 * 1000,
  movementTimeoutMs: 20 * 1000,
  chestPosition: null,
  chestSearchRadius: 24,
  inventoryDepositThreshold: 30,
  reserve: { wheat_seeds: 64, carrot: 64, potato: 64 },
  afkPosition: null,
  afkJumpIntervalMs: 20 * 1000,
  reconnectBaseDelayMs: 5000,
  reconnectMaxDelayMs: 60 * 1000,
  trustedPlayers: [],
  commandPrefix: "",
};

export default config;
