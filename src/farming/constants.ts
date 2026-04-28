import type { CropType } from "../types";

export const CROP_BLOCK_TO_TYPE: Record<string, CropType> = {
  wheat: "wheat",
  carrots: "carrot",
  potatoes: "potato",
};

export const CROP_REPLANT_ITEM: Record<CropType, string> = {
  wheat: "wheat_seeds",
  carrot: "carrot",
  potato: "potato",
};

export const DEPOSITABLE_CROP_ITEMS = new Set([
  "wheat",
  "wheat_seeds",
  "carrot",
  "potato",
  "poisonous_potato",
]);
