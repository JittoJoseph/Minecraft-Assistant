import dotenv from "dotenv";
import type { AppConfig } from "../types";
import { parseCoordinateTriplet, parseServerAddress } from "../utils/position";

// Minimal env usage: server, username, auth
dotenv.config();

const parsedAddress = parseServerAddress(process.env.MINECRAFT_SERVER);
const DEFAULT_DEPOSIT_POINT = Object.freeze({ x: -106, y: 52, z: 124 });
const DEFAULT_GEAR_CHEST_POINT = Object.freeze({ x: -91, y: 64, z: 134 });

function parseCoordinate(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name}. Expected a number.`);
  }
  return Math.floor(value);
}

function parseBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes")
    return true;
  if (normalized === "0" || normalized === "false" || normalized === "no")
    return false;
  throw new Error(`Invalid ${name}. Expected true/false.`);
}

function parseCommandPrefix(): string {
  const raw = process.env.COMMAND_PREFIX;
  if (!raw || !raw.trim()) return "bot";
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes(" ")) {
    throw new Error("Invalid COMMAND_PREFIX. Prefix cannot contain spaces.");
  }
  return normalized;
}

const spawnBedX = parseCoordinate("SPAWN_BED_X");
const spawnBedY = parseCoordinate("SPAWN_BED_Y");
const spawnBedZ = parseCoordinate("SPAWN_BED_Z");
const spawnBedPosition =
  spawnBedX !== null && spawnBedY !== null && spawnBedZ !== null
    ? { x: spawnBedX, y: spawnBedY, z: spawnBedZ }
    : null;
const parsedDepositPoint = parseCoordinateTriplet(process.env.DEPOSIT_POINT);
const depositPoint = parsedDepositPoint
  ? {
      x: Math.floor(parsedDepositPoint.x),
      y: Math.floor(parsedDepositPoint.y),
      z: Math.floor(parsedDepositPoint.z),
    }
  : DEFAULT_DEPOSIT_POINT;
const parsedGearChestPoint = parseCoordinateTriplet(process.env.GEAR_CHEST_POSITION);
const gearChestPosition = parsedGearChestPoint
  ? {
      x: Math.floor(parsedGearChestPoint.x),
      y: Math.floor(parsedGearChestPoint.y),
      z: Math.floor(parsedGearChestPoint.z),
    }
  : DEFAULT_GEAR_CHEST_POINT;

const config: AppConfig = {
  appName: process.env.APP_NAME || "Minecraft Assistant",
  inGameLabel: process.env.INGAME_LABEL || "TigerBaby",
  host:
    parsedAddress?.host ||
    process.env.MINECRAFT_HOST ||
    "fullcrewserver.aternos.me",
  port: parsedAddress?.port || Number(process.env.MINECRAFT_PORT || 25172),
  username: process.env.BOT_USERNAME || "TigerBaby",
  auth: process.env.MINECRAFT_AUTH || "offline",
  version: process.env.MINECRAFT_VERSION || false,

  // Defaults kept in code (not configurable via env in minimal mode)
  followDistance: 2,
  farmScanRadius: 96,
  farmScanMaxBlocks: 2048,
  farmBatchSize: 64,
  farmBatchSquareRadius: 6,
  farmCycleMaxMs: 4 * 60 * 1000,
  autoFarmIntervalMs: 1500,
  movementTimeoutMs: 20 * 1000,
  depositPoint,
  gearChestPosition,
  depositSearchRadius: 48,
  inventoryDepositThreshold: 18,
  inventoryDepositIntervalMs: 2 * 60 * 1000,
  reserve: { wheat_seeds: 64, carrot: 64, potato: 64 },
  afkPosition: null,
  spawnBedPosition,
  afkJumpIntervalMs: 20 * 1000,
  reconnectBaseDelayMs: 5000,
  reconnectMaxDelayMs: 60 * 1000,
  trustedPlayers: [],
  commandPrefix: parseCommandPrefix(),
  autoFarmOnStart: parseBoolean("AUTOFARM_ON_START", false),
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || "",
};

export default config;
