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

function findChestBlock(bot: Bot, config: AppConfig): any {
  if (config.chestPosition) {
    return bot.blockAt(
      new Vec3(
        config.chestPosition.x,
        config.chestPosition.y,
        config.chestPosition.z,
      ),
    );
  }

  return bot.findBlock({
    matching: (block: any) =>
      block?.name === "chest" || block?.name === "trapped_chest",
    maxDistance: config.chestSearchRadius,
  });
}

export async function depositToChest(
  bot: Bot,
  config: AppConfig,
  movement: MovementService,
  logger: Logger,
): Promise<void> {
  const chestBlock = findChestBlock(bot, config);
  if (!chestBlock) {
    logger.warn("No chest found for deposit.");
    return;
  }

  await movement.goNear(chestBlock.position, 2);
  const chest = await bot.openChest(chestBlock);
  try {
    for (const item of bot.inventory.items()) {
      if (!shouldDepositItem(item.name)) continue;
      const keep = keepCountForItem(config, item.name);
      const amount = Math.max(0, item.count - keep);
      if (amount > 0) {
        await chest.deposit(item.type, null, amount);
      }
    }
  } finally {
    chest.close();
  }
}
