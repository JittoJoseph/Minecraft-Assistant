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
const WEAPON_PRIORITY = [
  "netherite_sword",
  "diamond_sword",
  "iron_sword",
  "stone_sword",
  "golden_sword",
  "wooden_sword",
  "netherite_axe",
  "diamond_axe",
  "iron_axe",
  "stone_axe",
  "golden_axe",
  "wooden_axe",
] as const;
const ARMOR_PRIORITY = {
  head: [
    "netherite_helmet",
    "diamond_helmet",
    "iron_helmet",
    "chainmail_helmet",
    "golden_helmet",
    "leather_helmet",
  ],
  torso: [
    "netherite_chestplate",
    "diamond_chestplate",
    "iron_chestplate",
    "chainmail_chestplate",
    "golden_chestplate",
    "leather_chestplate",
  ],
  legs: [
    "netherite_leggings",
    "diamond_leggings",
    "iron_leggings",
    "chainmail_leggings",
    "golden_leggings",
    "leather_leggings",
  ],
  feet: [
    "netherite_boots",
    "diamond_boots",
    "iron_boots",
    "chainmail_boots",
    "golden_boots",
    "leather_boots",
  ],
} as const;
const EQUIPMENT_SLOT_INDEX = {
  head: 5,
  torso: 6,
  legs: 7,
  feet: 8,
  offhand: 45,
} as const;

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

function buildCountByItem(items: Array<{ name: string; count: number }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.name, (counts.get(item.name) || 0) + item.count);
  }
  return counts;
}

function countEquippedByName(bot: Bot): Map<string, number> {
  const equippedSlots = [
    EQUIPMENT_SLOT_INDEX.head,
    EQUIPMENT_SLOT_INDEX.torso,
    EQUIPMENT_SLOT_INDEX.legs,
    EQUIPMENT_SLOT_INDEX.feet,
    EQUIPMENT_SLOT_INDEX.offhand,
  ];
  const equippedItems = equippedSlots
    .map((slot) => bot.inventory.slots[slot])
    .filter((item) => typeof item?.name === "string")
    .map((item) => ({ name: item.name as string, count: 1 }));
  return buildCountByItem(equippedItems);
}

function pickBestAvailableName(
  allCounts: Map<string, number>,
  priorities: readonly string[],
): string | null {
  for (const name of priorities) {
    if ((allCounts.get(name) || 0) > 0) return name;
  }
  return null;
}

function buildGearReserveByName(bot: Bot): Map<string, number> {
  const inventoryCounts = buildCountByItem(
    bot.inventory.items().map((item) => ({ name: item.name, count: item.count })),
  );
  const equippedCounts = countEquippedByName(bot);
  const allCounts = new Map<string, number>(inventoryCounts);
  for (const [name, count] of equippedCounts.entries()) {
    allCounts.set(name, (allCounts.get(name) || 0) + count);
  }

  const desiredTotals = new Map<string, number>();
  const bestWeapon = pickBestAvailableName(allCounts, WEAPON_PRIORITY);
  if (bestWeapon) desiredTotals.set(bestWeapon, 1);

  for (const priorities of Object.values(ARMOR_PRIORITY)) {
    const best = pickBestAvailableName(allCounts, priorities);
    if (!best) continue;
    desiredTotals.set(best, (desiredTotals.get(best) || 0) + 1);
  }

  if ((allCounts.get("shield") || 0) > 0) {
    desiredTotals.set("shield", (desiredTotals.get("shield") || 0) + 1);
  }

  const keepInInventory = new Map<string, number>();
  for (const [name, desiredTotal] of desiredTotals.entries()) {
    const alreadyEquipped = equippedCounts.get(name) || 0;
    keepInInventory.set(name, Math.max(0, desiredTotal - alreadyEquipped));
  }

  return keepInInventory;
}

function keepCountForItem(
  config: AppConfig,
  itemName: string,
  gearReserveByName: Map<string, number>,
): number {
  const seedKeep = RESERVED_SEED_ITEMS.has(itemName) ? config.reserve[itemName] || 0 : 0;
  const gearKeep = gearReserveByName.get(itemName) || 0;
  return seedKeep + gearKeep;
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

function hasPlansRemaining(plans: DepositPlan[]): boolean {
  return plans.some((plan) => plan.remaining > 0);
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
  const gearReserveByName = keepReserve
    ? buildGearReserveByName(bot)
    : new Map<string, number>();
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
    const keep = keepReserve
      ? keepCountForItem(config, plan.itemName, gearReserveByName)
      : 0;
    const amountToDeposit = Math.max(0, plan.remaining - keep);
    if (amountToDeposit <= 0) continue;
    plans.push({
      ...plan,
      remaining: amountToDeposit,
    });
  }

  return plans.sort((a, b) => b.remaining - a.remaining);
}

export function depositLoadStackUnits(
  bot: Bot,
  config: AppConfig,
  options: DepositOptions = {},
): number {
  const plans = buildDepositPlan(
    bot,
    config,
    options.keepReserve !== false,
    options.includeAllItems === true,
  );
  let total = 0;
  for (const plan of plans) {
    total += plan.remaining / 64;
  }
  return total;
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

function isDoubleChestBlock(bot: Bot, block: any): boolean {
  return isChestBlock(block) && getAdjacentChestKeys(bot, block).length > 0;
}

function resolveContainerBlock(
  bot: Bot,
  containerKey: string,
  kind: StorageContainerKind,
): any | null {
  const basePos = parseKey(containerKey);
  const baseBlock = bot.blockAt(basePos);

  if (kind === "barrel") {
    return isBarrelBlock(baseBlock) ? baseBlock : null;
  }

  if (isDoubleChestBlock(bot, baseBlock)) {
    return baseBlock;
  }

  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];
  for (const offset of offsets) {
    const neighbor = bot.blockAt(basePos.plus(offset));
    if (!isDoubleChestBlock(bot, neighbor)) continue;
    const canonical = getCanonicalDoubleChestKey(bot, neighbor);
    if (canonical === containerKey) return neighbor;
  }

  return null;
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
): Promise<{
  depositedAny: boolean;
  openedAnyContainer: boolean;
  successfulContainerIndexes: number[];
}> {
  if (!plans.length || !containerKeys.length) {
    return {
      depositedAny: false,
      openedAnyContainer: false,
      successfulContainerIndexes: [],
    };
  }

  const visitedContainers = new Set<string>();
  let depositedAny = false;
  let openedAnyContainer = false;
  const successfulContainerIndexes: number[] = [];
  const moveTimeout = Math.min(config.movementTimeoutMs, STORAGE_MOVE_TIMEOUT_CAP_MS);
  let consecutiveFailures = 0;

  try {
    await movement.goNear(config.depositPoint, DEPOSIT_POINT_REACH_RANGE, moveTimeout);
  } catch (error) {
    logger.debug(
      "Could not stage at deposit point before storage pass.",
      error instanceof Error ? error.message : String(error),
    );
  }

  for (let index = 0; index < containerKeys.length; index += 1) {
    const containerKey = containerKeys[index];
    if (!hasPlansRemaining(plans)) break;
    if (visitedContainers.has(containerKey)) continue;
    visitedContainers.add(containerKey);

    const block = resolveContainerBlock(bot, containerKey, kind);
    if (!block) continue;

    try {
      await movement.goNear(block.position, STORAGE_REACH_RANGE, moveTimeout);
    } catch (error) {
      consecutiveFailures += 1;
      if (isInterruptedMovementError(error)) continue;
      logger.debug(
        `Could not reach storage ${kind} for deposit.`,
        error instanceof Error ? error.message : String(error),
      );
      if (consecutiveFailures >= 2) {
        try {
          await movement.goNear(
            config.depositPoint,
            DEPOSIT_POINT_REACH_RANGE,
            moveTimeout,
          );
        } catch {
          // best effort recovery
        }
        consecutiveFailures = 0;
      }
      continue;
    }
    consecutiveFailures = 0;

    let container: any;
    try {
      container = await openContainerForDeposit(bot, block, kind);
      openedAnyContainer = true;
    } catch (error) {
      logger.debug(
        `Could not open storage ${kind} for deposit.`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    try {
      const containerDeposited = await depositIntoContainer(container, plans);
      if (containerDeposited) {
        depositedAny = true;
        successfulContainerIndexes.push(index + 1);
      }
    } finally {
      container.close();
    }
  }

  return { depositedAny, openedAnyContainer, successfulContainerIndexes };
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

  const seedPlans = plans.filter((plan) => plan.itemName === WHEAT_SEEDS_ITEM_NAME);
  const generalPlans = plans.filter(
    (plan) => plan.itemName !== WHEAT_SEEDS_ITEM_NAME,
  );

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

  let depositedAny = false;
  let openedAnyContainer = false;
  const successfulChestIndexes = new Set<number>();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const storage = getStorageContainers(bot, config, attempt > 0);
    if (!storage.chestKeys.length && !storage.barrelKeys.length) {
      if (attempt === 0) {
        logger.warn("No storage containers found near deposit point.");
        return { deposited: false, reason: "no_chest" };
      }
      break;
    }

    if (hasPlansRemaining(generalPlans) && storage.chestKeys.length > 0) {
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
      for (const index of chestPass.successfulContainerIndexes) {
        successfulChestIndexes.add(index);
      }
    }

    if (hasPlansRemaining(seedPlans) && storage.barrelKeys.length > 0) {
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

    if (hasPlansRemaining(seedPlans) && storage.chestKeys.length > 0) {
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
      for (const index of seedFallbackChestPass.successfulContainerIndexes) {
        successfulChestIndexes.add(index);
      }
    }

    if (!hasPlansRemaining(plans)) {
      if (successfulChestIndexes.size > 0) {
        logger.info("Deposit completed into storage chests.", {
          chestOrder: Array.from(successfulChestIndexes).sort((a, b) => a - b),
        });
      }
      return { deposited: true };
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

  if (successfulChestIndexes.size > 0) {
    logger.info("Deposit attempted across storage chests.", {
      chestOrder: Array.from(successfulChestIndexes).sort((a, b) => a - b),
      remainingPlans: plans.filter((plan) => plan.remaining > 0).length,
    });
  }

  logger.warn("Storage hall full or unavailable; deposit incomplete.");
  if (!openedAnyContainer) {
    return { deposited: depositedAny, reason: "open_failed" };
  }
  return { deposited: depositedAny, reason: "destination_full" };
}
