import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { AppConfig, Logger, MovementService } from "../types";
import { CROP_REPLANT_ITEM, DEPOSITABLE_CROP_ITEMS } from "./constants";

const STORAGE_SCAN_CACHE_TTL_MS = 45 * 1000;
const DEPOSIT_POINT_REACH_RANGE = 2;
const STORAGE_REACH_RANGE = 2;
const STORAGE_MOVE_TIMEOUT_CAP_MS = 7 * 1000;
const STORAGE_OPEN_TIMEOUT_MS = 3500;
const WHEAT_SEEDS_ITEM_NAME = "wheat_seeds";
const RESERVED_SEED_ITEMS = new Set(Object.values(CROP_REPLANT_ITEM));

type StorageContainerKind = "chest" | "barrel";

interface StorageScanCache {
  depositPointKey: string;
  radius: number;
  chestKeys: string[];
  barrelKeys: string[];
  scannedAt: number;
}

interface StorageScanResult {
  chestKeys: string[];
  barrelKeys: string[];
}

interface DepositPlan {
  itemName: string;
  itemType: number;
  metadata: number;
  remaining: number;
}

const storageScanCacheByBot = new WeakMap<Bot, StorageScanCache>();

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
  if (!RESERVED_SEED_ITEMS.has(itemName)) return 0;
  return config.reserve[itemName] || 0;
}

function isChestBlock(block: any): boolean {
  return block?.name === "chest" || block?.name === "trapped_chest";
}

function isBarrelBlock(block: any): boolean {
  return block?.name === "barrel";
}

function toKey(position: { x: number; y: number; z: number }): string {
  return `${position.x},${position.y},${position.z}`;
}

function parseKey(key: string): Vec3 {
  const [x, y, z] = key.split(",").map((value) => Number(value));
  return new Vec3(x, y, z);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout_${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getAdjacentChestKeys(bot: Bot, chestBlock: any): string[] {
  const basePos = chestBlock.position;
  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];
  const adjacentKeys: string[] = [];

  for (const offset of offsets) {
    const neighbor = bot.blockAt(basePos.plus(offset));
    if (!isChestBlock(neighbor) || neighbor.name !== chestBlock.name) continue;
    adjacentKeys.push(toKey(neighbor.position));
  }

  return adjacentKeys;
}

function getCanonicalDoubleChestKey(bot: Bot, chestBlock: any): string | null {
  const adjacentKeys = getAdjacentChestKeys(bot, chestBlock);
  if (adjacentKeys.length === 0) return null;
  let canonical = toKey(chestBlock.position);
  for (const neighborKey of adjacentKeys) {
    if (neighborKey < canonical) canonical = neighborKey;
  }
  return canonical;
}

function sortStorageKeysByDepositPoint(keys: string[], depositPoint: Vec3): string[] {
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

function scanStorageContainers(bot: Bot, config: AppConfig): StorageScanResult {
  const depositPoint = new Vec3(
    config.depositPoint.x,
    config.depositPoint.y,
    config.depositPoint.z,
  );
  const storagePositions = bot.findBlocks({
    point: depositPoint,
    matching: (block: any) => isChestBlock(block) || isBarrelBlock(block),
    maxDistance: config.depositSearchRadius,
    count: 768,
  });

  const chestKeys = new Set<string>();
  const barrelKeys = new Set<string>();

  for (const storagePos of storagePositions) {
    const block = bot.blockAt(storagePos);
    if (!block) continue;
    if (isChestBlock(block)) {
      const canonicalDoubleChestKey = getCanonicalDoubleChestKey(bot, block);
      if (canonicalDoubleChestKey) {
        chestKeys.add(canonicalDoubleChestKey);
      }
      continue;
    }
    if (isBarrelBlock(block)) {
      barrelKeys.add(toKey(block.position));
    }
  }

  return {
    chestKeys: sortStorageKeysByDepositPoint(Array.from(chestKeys), depositPoint),
    barrelKeys: sortStorageKeysByDepositPoint(
      Array.from(barrelKeys),
      depositPoint,
    ),
  };
}

function getStorageContainers(
  bot: Bot,
  config: AppConfig,
  forceRefresh = false,
): StorageScanResult {
  const depositPointKey = toKey(config.depositPoint);
  const cached = storageScanCacheByBot.get(bot);
  const now = Date.now();
  if (
    !forceRefresh &&
    cached &&
    cached.depositPointKey === depositPointKey &&
    cached.radius === config.depositSearchRadius &&
    now - cached.scannedAt < STORAGE_SCAN_CACHE_TTL_MS
  ) {
    return { chestKeys: cached.chestKeys, barrelKeys: cached.barrelKeys };
  }

  const scanned = scanStorageContainers(bot, config);
  storageScanCacheByBot.set(bot, {
    depositPointKey,
    radius: config.depositSearchRadius,
    chestKeys: scanned.chestKeys,
    barrelKeys: scanned.barrelKeys,
    scannedAt: now,
  });
  return scanned;
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

function canContainerAcceptItem(container: any, plan: DepositPlan): boolean {
  if (typeof container.firstEmptyContainerSlot === "function") {
    if (container.firstEmptyContainerSlot() !== null) return true;
  }

  const containerItems = container.containerItems?.() || [];
  return containerItems.some(
    (item: any) =>
      item?.type === plan.itemType &&
      item?.metadata === plan.metadata &&
      item.count < item.stackSize,
  );
}

async function depositIntoContainer(
  container: any,
  plans: DepositPlan[],
): Promise<boolean> {
  let depositedAny = false;

  for (const plan of plans) {
    if (plan.remaining <= 0) continue;
    if (!canContainerAcceptItem(container, plan)) continue;

    try {
      await container.deposit(plan.itemType, plan.metadata, plan.remaining);
      depositedAny = true;
      plan.remaining = 0;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.includes("destination full")) {
        return depositedAny;
      }
      throw error;
    }
  }

  return depositedAny;
}

function isContainerBlockOfKind(
  bot: Bot,
  block: any,
  kind: StorageContainerKind,
): boolean {
  if (kind === "barrel") return isBarrelBlock(block);
  return isChestBlock(block) && getAdjacentChestKeys(bot, block).length > 0;
}

async function openContainerForDeposit(
  bot: Bot,
  block: any,
  kind: StorageContainerKind,
): Promise<any> {
  const openPromise =
    kind === "chest" ? bot.openChest(block) : bot.openContainer(block);
  return withTimeout(openPromise, STORAGE_OPEN_TIMEOUT_MS);
}

async function runContainerDepositPass(
  bot: Bot,
  config: AppConfig,
  movement: MovementService,
  logger: Logger,
  plans: DepositPlan[],
  containerKeys: string[],
  kind: StorageContainerKind,
): Promise<{ depositedAny: boolean; openedAnyContainer: boolean }> {
  if (!plans.length || !containerKeys.length) {
    return { depositedAny: false, openedAnyContainer: false };
  }

  const visitedContainers = new Set<string>();
  let depositedAny = false;
  let openedAnyContainer = false;
  const moveTimeout = Math.min(config.movementTimeoutMs, STORAGE_MOVE_TIMEOUT_CAP_MS);

  for (const containerKey of containerKeys) {
    if (plans.every((plan) => plan.remaining <= 0)) break;
    if (visitedContainers.has(containerKey)) continue;
    visitedContainers.add(containerKey);

    const block = bot.blockAt(parseKey(containerKey));
    if (!isContainerBlockOfKind(bot, block, kind)) continue;

    try {
      await movement.goNear(block.position, STORAGE_REACH_RANGE, moveTimeout);
    } catch (error) {
      if (isInterruptedMovementError(error)) continue;
      logger.warn(
        `Could not reach storage ${kind} for deposit.`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    let container: any;
    try {
      container = await openContainerForDeposit(bot, block, kind);
      openedAnyContainer = true;
    } catch (error) {
      logger.warn(
        `Could not open storage ${kind} for deposit.`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    try {
      const containerDeposited = await depositIntoContainer(container, plans);
      if (containerDeposited) depositedAny = true;
    } finally {
      container.close();
    }
  }

  return { depositedAny, openedAnyContainer };
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

  let storage = getStorageContainers(bot, config, false);
  if (!storage.chestKeys.length && !storage.barrelKeys.length) {
    logger.warn("No storage containers found near deposit point.");
    return { deposited: false, reason: "no_chest" };
  }

  const seedPlans = plans.filter((plan) => plan.itemName === WHEAT_SEEDS_ITEM_NAME);
  const generalPlans = plans.filter(
    (plan) => plan.itemName !== WHEAT_SEEDS_ITEM_NAME,
  );

  let depositedAny = false;
  let openedAnyContainer = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (generalPlans.length > 0 && storage.chestKeys.length > 0) {
      const chestPass = await runContainerDepositPass(
        bot,
        config,
        movement,
        logger,
        generalPlans,
        storage.chestKeys,
        "chest",
      );
      depositedAny = depositedAny || chestPass.depositedAny;
      openedAnyContainer = openedAnyContainer || chestPass.openedAnyContainer;
    }

    if (seedPlans.length > 0 && storage.barrelKeys.length > 0) {
      const barrelPass = await runContainerDepositPass(
        bot,
        config,
        movement,
        logger,
        seedPlans,
        storage.barrelKeys,
        "barrel",
      );
      depositedAny = depositedAny || barrelPass.depositedAny;
      openedAnyContainer = openedAnyContainer || barrelPass.openedAnyContainer;
    }

    const seedsStillRemaining = seedPlans.some((plan) => plan.remaining > 0);
    if (seedsStillRemaining && storage.chestKeys.length > 0) {
      const seedFallbackChestPass = await runContainerDepositPass(
        bot,
        config,
        movement,
        logger,
        seedPlans,
        storage.chestKeys,
        "chest",
      );
      depositedAny = depositedAny || seedFallbackChestPass.depositedAny;
      openedAnyContainer =
        openedAnyContainer || seedFallbackChestPass.openedAnyContainer;
    }

    if (plans.every((plan) => plan.remaining <= 0)) {
      return { deposited: true };
    }

    if (attempt === 0) {
      storage = getStorageContainers(bot, config, true);
      if (!storage.chestKeys.length && !storage.barrelKeys.length) break;
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
  if (!openedAnyContainer) {
    return { deposited: depositedAny, reason: "open_failed" };
  }
  return { deposited: depositedAny, reason: "destination_full" };
}
