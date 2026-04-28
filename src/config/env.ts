import dotenv from "dotenv";
import type { AppConfig } from "../types";
import { parseCoordinateTriplet, parseServerAddress } from "../utils/position";

dotenv.config();

const parsedAddress = parseServerAddress(process.env.MINECRAFT_SERVER);

function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function toList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const config: AppConfig = {
  appName: process.env.APP_NAME || "Minecraft Assistant",
  inGameLabel: process.env.INGAME_LABEL || "TigerBaby",
  host:
    parsedAddress?.host ||
    process.env.MINECRAFT_HOST ||
    "fullcrewserver.aternos.me",
  port: parsedAddress?.port || toNumber(process.env.MINECRAFT_PORT, 25172),
  username: process.env.BOT_USERNAME || "TigerBaby",
  auth: process.env.MINECRAFT_AUTH || "offline",
  version: process.env.MINECRAFT_VERSION || false,
  followDistance: toNumber(process.env.FOLLOW_DISTANCE, 2),
  farmScanRadius: toNumber(process.env.FARM_SCAN_RADIUS, 32),
  farmScanMaxBlocks: toNumber(process.env.FARM_SCAN_MAX_BLOCKS, 256),
  farmBatchSize: toNumber(process.env.FARM_BATCH_SIZE, 64),
  autoFarmIntervalMs: toNumber(process.env.AUTOFARM_INTERVAL_MS, 5 * 60 * 1000),
  movementTimeoutMs: toNumber(process.env.MOVEMENT_TIMEOUT_MS, 20 * 1000),
  chestPosition: parseCoordinateTriplet(process.env.CHEST_POS),
  chestSearchRadius: toNumber(process.env.CHEST_SEARCH_RADIUS, 24),
  inventoryDepositThreshold: toNumber(
    process.env.INVENTORY_DEPOSIT_THRESHOLD,
    30,
  ),
  reserve: {
    wheat_seeds: toNumber(process.env.RESERVE_WHEAT_SEEDS, 64),
    carrot: toNumber(process.env.RESERVE_CARROTS, 64),
    potato: toNumber(process.env.RESERVE_POTATOES, 64),
  },
  afkPosition: parseCoordinateTriplet(process.env.AFK_POS),
  afkJumpIntervalMs: toNumber(process.env.AFK_JUMP_INTERVAL_MS, 20 * 1000),
  reconnectBaseDelayMs: toNumber(process.env.RECONNECT_BASE_DELAY_MS, 5000),
  reconnectMaxDelayMs: toNumber(process.env.RECONNECT_MAX_DELAY_MS, 60 * 1000),
  trustedPlayers: toList(process.env.TRUSTED_PLAYERS),
  commandPrefix: process.env.COMMAND_PREFIX || "",
};

export default config;
