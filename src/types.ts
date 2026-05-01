import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

export type CropType = "wheat" | "carrot" | "potato";

export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export interface AppConfig {
  appName: string;
  inGameLabel: string;
  host: string;
  port: number;
  username: string;
  auth: string;
  version: string | false;
  followDistance: number;
  farmScanRadius: number;
  farmScanMaxBlocks: number;
  farmBatchSize: number;
  farmBatchSquareRadius: number;
  farmCycleMaxMs: number;
  autoFarmIntervalMs: number;
  movementTimeoutMs: number;
  depositPoint: Position3;
  depositSearchRadius: number;
  inventoryDepositThreshold: number;
  inventoryDepositIntervalMs: number;
  gearChestPosition: Position3;
  reserve: Record<string, number>;
  afkPosition: Position3 | null;
  spawnBedPosition: Position3 | null;
  afkJumpIntervalMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  trustedPlayers: string[];
  commandPrefix: string;
  autoFarmOnStart: boolean;
  discordWebhookUrl: string;
}

export interface AppState {
  mode: "patrolling" | "follow" | "afk" | "farming" | "sleeping" | "combat";
  followTarget: string | null;
  afkPosition: Position3 | null;
  spawnBedPosition: Position3 | null;
  isFarming: boolean;
  cropMemory: Map<string, CropType>;
}

export interface Logger {
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  debug: (message: string, data?: unknown) => void;
}

export interface MovementService {
  goNear: (
    position: Position3 | Vec3,
    range?: number,
    timeoutMs?: number,
  ) => Promise<void>;
  goBlock: (position: Position3 | Vec3, timeoutMs?: number) => Promise<void>;
  stop: () => void;
}

export interface FollowService {
  startFollow: (username: string) => void;
  stopFollow: () => void;
}

export interface AfkService {
  startAfk: (position?: Position3) => Promise<void>;
  stopAfk: () => void;
}

export interface FarmStats {
  harvested: number;
  replanted: number;
  cycles: number;
}

export interface FarmService {
  runFarmCycle: (triggeredBy?: string) => Promise<number>;
  startAutoFarm: () => boolean;
  stopAutoFarm: () => boolean;
  isAutoFarmEnabled: () => boolean;
  interruptCurrentCycle: () => void;
  unloadToChest: () => Promise<boolean>;
  getStats: () => FarmStats;
}

export interface SleepService {
  sleepAtSpawnBed: (triggeredBy?: "manual" | "auto") => Promise<boolean>;
  setSpawnBedPosition: (position: Position3) => void;
  getSpawnBedPosition: () => Position3 | null;
  setAutoSleepEnabled: (enabled: boolean) => boolean;
  isAutoSleepEnabled: () => boolean;
  maybeAutoSleep: () => Promise<void>;
}

export interface GearService {
  ensureCombatGear: (trigger?: string) => Promise<boolean>;
  equipBestWeapon: () => Promise<boolean>;
  stowWeaponFromHand: () => Promise<void>;
  hasUsableWeapon: () => boolean;
}

export interface CombatService {
  startRetaliationFromAttacker: (attacker: any, reason?: string) => boolean;
  retaliateFromDamageEvent: (source?: any, reason?: string) => boolean;
  cancelCombat: (resumePrevious?: boolean) => boolean;
  isInCombat: () => boolean;
}

export interface PatrolService {
  startPatrol: (anchor?: Position3) => boolean;
  stopPatrol: () => boolean;
  isPatrolling: () => boolean;
}

export interface DiscordService {
  notifyPlayerJoined: (username: string) => Promise<void>;
  notifyPlayerLeft: (username: string) => Promise<void>;
  sendOnlinePlayers: (requestedBy: string, players: string[]) => Promise<void>;
}

export interface Services {
  movement: MovementService;
  follow: FollowService;
  afk: AfkService;
  farm: FarmService;
  sleep: SleepService;
  gear: GearService;
  combat: CombatService;
  patrol: PatrolService;
  discord: DiscordService;
}

export interface CommandContext {
  bot: Bot;
  config: AppConfig;
  services: Services;
  username: string;
  message: string;
}

export interface CommandHandler {
  name: string;
  match: (message: string) => boolean;
  execute: (ctx: CommandContext) => Promise<void>;
}
