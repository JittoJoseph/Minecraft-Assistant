import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { AppConfig, Logger, MovementService } from "../types";
import { DEPOSITABLE_CROP_ITEMS } from "./constants";

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

function collectChestBlocks(bot: Bot, config: AppConfig): any[] {
  const chests: any[] = [];
  const seen = new Set<string>();

  const addChest = (block: any): void => {
    if (!isChestBlock(block)) return;
    const key = `${block.position.x},${block.position.y},${block.position.z}`;
    if (seen.has(key)) return;
    seen.add(key);
    chests.push(block);
  };

  if (config.chestPosition) {
    addChest(
      bot.blockAt(
        new Vec3(
          config.chestPosition.x,
          config.chestPosition.y,
          config.chestPosition.z,
        ),
      ),
    );
  }

  const nearbyChestPositions = bot.findBlocks({
    matching: (block: any) => isChestBlock(block),
    maxDistance: config.chestSearchRadius,
    count: 64,
  });

  for (const pos of nearbyChestPositions) {
    addChest(bot.blockAt(pos));
  }

  return chests.sort(
    (a, b) =>
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position),
  );
}

interface DepositPlan {
  itemName: string;
  itemType: number;
  metadata: number;
  remaining: number;
}

function buildDepositPlan(bot: Bot, config: AppConfig): DepositPlan[] {
  const perItemTotals = new Map<string, DepositPlan>();
  for (const item of bot.inventory.items()) {
    if (!shouldDepositItem(item.name)) continue;

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
    const keep = keepCountForItem(config, plan.itemName);
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

export interface DepositResult {
  deposited: boolean;
  reason?: "no_chest" | "open_failed" | "destination_full";
}

export async function depositToChest(
  bot: Bot,
  config: AppConfig,
  movement: MovementService,
  logger: Logger,
): Promise<DepositResult> {
  const plans = buildDepositPlan(bot, config);
  if (!plans.length) {
    return { deposited: false };
  }

  const chestBlocks = collectChestBlocks(bot, config);
  if (!chestBlocks.length) {
    logger.warn("No chest found for deposit.");
    return { deposited: false, reason: "no_chest" };
  }

  let depositedAny = false;
  let openedAnyChest = false;

  for (const chestBlock of chestBlocks) {
    if (plans.every((plan) => plan.remaining <= 0)) {
      break;
    }

    try {
      await movement.goNear(chestBlock.position, 2, config.movementTimeoutMs * 2);
    } catch (error) {
      logger.warn(
        "Could not reach chest for deposit.",
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    let chest: any;
    try {
      chest = await bot.openChest(chestBlock);
      openedAnyChest = true;
    } catch (error) {
      logger.warn(
        "Could not open chest for deposit.",
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    try {
      const result = await depositIntoChest(chest, plans);
      if (result.depositedAny) {
        depositedAny = true;
      }
      if (!result.chestFull && plans.every((plan) => plan.remaining <= 0)) {
        break;
      }
    } finally {
      chest.close();
    }
  }

  if (plans.some((plan) => plan.remaining > 0)) {
    if (!openedAnyChest) {
      return { deposited: depositedAny, reason: "open_failed" };
    }
    return { deposited: depositedAny, reason: "destination_full" };
  }

  return { deposited: true };
}
