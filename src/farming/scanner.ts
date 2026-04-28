import type { Bot } from "mineflayer";
import type { CropType } from "../types";
import { CROP_BLOCK_TO_TYPE } from "./constants";

export interface HarvestJob {
  position: any;
  blockName: string;
  cropType: CropType;
}

export function isMatureCrop(block: any): boolean {
  if (!block) return false;
  const cropType = CROP_BLOCK_TO_TYPE[block.name];
  if (!cropType) return false;
  const age = block.getProperties?.().age;
  if (typeof age === "number") return age >= 7;
  return block.metadata >= 7;
}

export function scanMatureCrops(
  bot: Bot,
  radius: number,
  maxCount: number,
): HarvestJob[] {
  const positions = bot.findBlocks({
    matching: (block: any) => isMatureCrop(block),
    maxDistance: radius,
    count: maxCount,
  });

  return positions
    .map((pos) => bot.blockAt(pos))
    .filter(Boolean)
    .map((block: any) => ({
      position: block.position.clone(),
      blockName: block.name,
      cropType: CROP_BLOCK_TO_TYPE[block.name],
    }))
    .filter((entry) => Boolean(entry.cropType))
    .sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position),
    );
}
