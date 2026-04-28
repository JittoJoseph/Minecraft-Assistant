import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { CropType, Logger } from "../types";
import { CROP_REPLANT_ITEM } from "./constants";

export interface ReplantResult {
  success: boolean;
  reason?:
    | "unsupported_crop_type"
    | "no_farmland"
    | "spot_not_empty"
    | "missing_seed"
    | "place_failed";
}

export async function replantCrop(
  bot: Bot,
  logger: Logger,
  position: any,
  cropType: CropType,
): Promise<ReplantResult> {
  const expectedItemName = CROP_REPLANT_ITEM[cropType];
  if (!expectedItemName)
    return { success: false, reason: "unsupported_crop_type" };

  const farmlandBlock = bot.blockAt(position.offset(0, -1, 0));
  if (!farmlandBlock || farmlandBlock.name !== "farmland") {
    return { success: false, reason: "no_farmland" };
  }

  const plantSpot = bot.blockAt(position);
  if (!plantSpot || plantSpot.name !== "air") {
    return { success: false, reason: "spot_not_empty" };
  }

  const item = bot.inventory
    .items()
    .find((invItem) => invItem.name === expectedItemName);
  if (!item) {
    return { success: false, reason: "missing_seed" };
  }

  await bot.equip(item, "hand");
  try {
    await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
    return { success: true };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    logger.warn(`Replant failed for ${cropType} at ${position}`, text);
    return { success: false, reason: "place_failed" };
  }
}
