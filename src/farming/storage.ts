import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { AppConfig, Logger, MovementService } from "../types";
import { DEPOSITABLE_CROP_ITEMS } from "./constants";

const CHEST_SCAN_CACHE_TTL_MS = 45 * 1000;
const DEPOSIT_POINT_REACH_RANGE = 2;
const CHEST_REACH_RANGE = 2;

interface ChestScanCache {
  depositPointKey: string;
  radius: number;
  chestKeys: string[];
  scannedAt: number;
}

const chestScanCacheByBot = new WeakMap<Bot, ChestScanCache>();

function isInterruptedMovementError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text === "movement_interrupted" ||
    text.includes("The goal was changed before it could be completed!")
  );
}

export function usedInventorySlots(bot: Bot): number {
  const slots = bot.inventory.slots.slice(9, 45);
  return slots.filter(Boolean).length;
}

function shouldDepositItem(itemName: string): boolean {
  return DEPOSITABLE_CROP_ITEMS.has(itemName);
}

function keepCountForItem(config: AppConfig, itemName: string): number {
  return config.reserve[itemName] || 0;
}

function isChestBlock(block: any): boolean {
  return block?.name === "chest" || block?.name === "trapped_chest";
}

function toKey(position: { x: number; y: number; z: number }): string {
  return `${position.x},${position.y},${position.z}`;
}

function parseKey(key: string): Vec3 {
  const [x, y, z] = key.split(",").map((value) => Number(value));
  return new Vec3(x, y, z);
}

function getCanonicalChestKey(bot: Bot, chestBlock: any): string {
  const basePos = chestBlock.position;
  let canonical = toKey(basePos);
  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];

  for (const offset of offsets) {
    const neighbor = bot.blockAt(basePos.plus(offset));
    if (!isChestBlock(neighbor) || neighbor.name !== chestBlock.name) continue;
    const neighborKey = toKey(neighbor.position);
    if (neighborKey < canonical) canonical = neighborKey;
  }

  return canonical;
}

function sortChestKeysByDepositPoint(
  keys: string[],
  depositPoint: Vec3,
): string[] {
  const entries = keys.map((key) => {
    const pos = parseKey(key);
    const dx = pos.x - depositPoint.x;
    const dy = pos.y - depositPoint.y;
    const dz = pos.z - depositPoint.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    return { key, x: pos.x, y: pos.y, z: pos.z, distanceSquared };
  });

  entries.sort((a, b) => {
    if (a.distanceSquared !== b.distanceSquared) {
      return a.distanceSquared - b.distanceSquared;
    }
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.z - b.z;
  });

  return entries.map((entry) => entry.key);
}

function scanStorageChests(bot: Bot, config: AppConfig): string[] {
  const depositPoint = new Vec3(
    config.depositPoint.x,
    config.depositPoint.y,
    config.depositPoint.z,
  );
  const chestPositions = bot.findBlocks({
    point: depositPoint,
    matching: (block: any) => isChestBlock(block),
    maxDistance: config.depositSearchRadius,
    count: 512,
  });

  const canonicalKeys = new Set<string>();
  for (const chestPos of chestPositions) {
    const block = bot.blockAt(chestPos);
    if (!isChestBlock(block)) continue;
    canonicalKeys.add(getCanonicalChestKey(bot, block));
  }

  return sortChestKeysByDepositPoint(Array.from(canonicalKeys), depositPoint);
}

function getStorageChestKeys(
  bot: Bot,
  config: AppConfig,
  forceRefresh = false,
): string[] {
  const depositPointKey = toKey(config.depositPoint);
  const cached = chestScanCacheByBot.get(bot);
  const now = Date.now();
  if (
    !forceRefresh &&
    cached &&
    cached.depositPointKey === depositPointKey &&
    cached.radius === config.depositSearchRadius &&
    now - cached.scannedAt < CHEST_SCAN_CACHE_TTL_MS
  ) {
    return cached.chestKeys;
  }

  const chestKeys = scanStorageChests(bot, config);
  chestScanCacheByBot.set(bot, {
    depositPointKey,
    radius: config.depositSearchRadius,
    chestKeys,
    scannedAt: now,
  });
  return chestKeys;
}

interface DepositPlan {
  itemName: string;
  itemType: number;
  metadata: number;
  remaining: number;
}

function buildDepositPlan(
  bot: Bot,
  config: AppConfig,
  keepReserve: boolean,
  includeAllItems: boolean,
): DepositPlan[] {
  const perItemTotals = new Map<string, DepositPlan>();
  for (const item of bot.inventory.items()) {
    if (!includeAllItems && !shouldDepositItem(item.name)) continue;

    const existing = perItemTotals.get(item.name);
    if (existing) {
      existing.remaining += item.count;
      continue;
    }

    perItemTotals.set(item.name, {
      itemName: item.name,
      itemType: item.type,
      metadata: item.metadata ?? 0,
      remaining: item.count,
    });
  }

  const plans: DepositPlan[] = [];
  for (const plan of perItemTotals.values()) {
    const keep = keepReserve ? keepCountForItem(config, plan.itemName) : 0;
    const amountToDeposit = Math.max(0, plan.remaining - keep);
    if (amountToDeposit <= 0) continue;
    plans.push({
      ...plan,
      remaining: amountToDeposit,
    });
  }

  return plans.sort((a, b) => b.remaining - a.remaining);
}

function canChestAcceptItem(chest: any, plan: DepositPlan): boolean {
  if (typeof chest.firstEmptyContainerSlot === "function") {
    if (chest.firstEmptyContainerSlot() !== null) return true;
  }

  const containerItems = chest.containerItems?.() || [];
  return containerItems.some(
    (item: any) =>
      item?.type === plan.itemType &&
      item?.metadata === plan.metadata &&
      item.count < item.stackSize,
  );
}

async function depositIntoChest(
  chest: any,
  plans: DepositPlan[],
): Promise<{ depositedAny: boolean; chestFull: boolean }> {
  let depositedAny = false;

  for (const plan of plans) {
    if (plan.remaining <= 0) continue;
    if (!canChestAcceptItem(chest, plan)) continue;

    try {
      await chest.deposit(plan.itemType, plan.metadata, plan.remaining);
      depositedAny = true;
      plan.remaining = 0;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.includes("destination full")) {
        return { depositedAny, chestFull: true };
      }
      throw error;
    }
  }

  return { depositedAny, chestFull: false };
}

async function runChestDepositPass(
  bot: Bot,
  config: AppConfig,
  movement: MovementService,
  logger: Logger,
  plans: DepositPlan[],
  chestKeys: string[],
): Promise<{ depositedAny: boolean; openedAnyChest: boolean }> {
  const visitedChests = new Set<string>();
  let depositedAny = false;
  let openedAnyChest = false;

  for (const chestKey of chestKeys) {
    if (plans.every((plan) => plan.remaining <= 0)) break;
    if (visitedChests.has(chestKey)) continue;
    visitedChests.add(chestKey);

    const block = bot.blockAt(parseKey(chestKey));
    if (!isChestBlock(block)) continue;

    try {
      await movement.goNear(
        block.position,
        CHEST_REACH_RANGE,
        config.movementTimeoutMs * 2,
      );
    } catch (error) {
      if (isInterruptedMovementError(error)) continue;
      logger.warn(
        "Could not reach storage chest for deposit.",
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    let chest: any;
    try {
      chest = await bot.openChest(block);
      openedAnyChest = true;
    } catch (error) {
      logger.warn(
        "Could not open storage chest for deposit.",
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    try {
      const result = await depositIntoChest(chest, plans);
      if (result.depositedAny) depositedAny = true;
    } finally {
      chest.close();
    }
  }

  return { depositedAny, openedAnyChest };
}

export interface DepositResult {
  deposited: boolean;
  reason?: "no_chest" | "open_failed" | "destination_full";
}

export interface DepositOptions {
  keepReserve?: boolean;
  includeAllItems?: boolean;
}

export async function depositToChest(
  bot: Bot,
  config: AppConfig,
  movement: MovementService,
  logger: Logger,
  options: DepositOptions = {},
): Promise<DepositResult> {
  const plans = buildDepositPlan(
    bot,
    config,
    options.keepReserve !== false,
    options.includeAllItems === true,
  );
  if (!plans.length) {
    return { deposited: false };
  }

  try {
    await movement.goNear(
      config.depositPoint,
      DEPOSIT_POINT_REACH_RANGE,
      config.movementTimeoutMs * 2,
    );
  } catch (error) {
    logger.warn(
      "Could not reach deposit point.",
      error instanceof Error ? error.message : String(error),
    );
    return { deposited: false, reason: "open_failed" };
  }

  let chestKeys = getStorageChestKeys(bot, config, false);
  if (!chestKeys.length) {
    logger.warn("No storage chests found near deposit point.");
    return { deposited: false, reason: "no_chest" };
  }

  let depositedAny = false;
  let openedAnyChest = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const passResult = await runChestDepositPass(
      bot,
      config,
      movement,
      logger,
      plans,
      chestKeys,
    );
    depositedAny = depositedAny || passResult.depositedAny;
    openedAnyChest = openedAnyChest || passResult.openedAnyChest;

    if (plans.every((plan) => plan.remaining <= 0)) {
      return { deposited: true };
    }

    if (attempt === 0) {
      chestKeys = getStorageChestKeys(bot, config, true);
      if (!chestKeys.length) break;
    }
  }

  try {
    await movement.goNear(
      config.depositPoint,
      DEPOSIT_POINT_REACH_RANGE,
      config.movementTimeoutMs,
    );
  } catch {
    // best-effort fallback position
  }

  logger.warn("Storage hall full or unavailable; deposit incomplete.");
  if (!openedAnyChest) {
    return { deposited: depositedAny, reason: "open_failed" };
  }
  return { deposited: depositedAny, reason: "destination_full" };
}
