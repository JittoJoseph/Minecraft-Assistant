import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type { AppConfig, GearService, Logger, MovementService } from "../types";

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
  head: ["netherite_helmet", "diamond_helmet", "iron_helmet", "chainmail_helmet", "golden_helmet", "leather_helmet"],
  torso: [
    "netherite_chestplate",
    "diamond_chestplate",
    "iron_chestplate",
    "chainmail_chestplate",
    "golden_chestplate",
    "leather_chestplate",
  ],
  legs: ["netherite_leggings", "diamond_leggings", "iron_leggings", "chainmail_leggings", "golden_leggings", "leather_leggings"],
  feet: ["netherite_boots", "diamond_boots", "iron_boots", "chainmail_boots", "golden_boots", "leather_boots"],
} as const;

const EQUIPMENT_SLOT_INDEX = {
  head: 5,
  torso: 6,
  legs: 7,
  feet: 8,
  offhand: 45,
} as const;

function isChestBlock(block: any): boolean {
  return block?.name === "chest" || block?.name === "trapped_chest";
}

function weaponScore(itemName: string): number {
  const rank = WEAPON_PRIORITY.indexOf(itemName as (typeof WEAPON_PRIORITY)[number]);
  return rank < 0 ? -1 : WEAPON_PRIORITY.length - rank;
}

function bestItemByPriority(items: any[], priorities: readonly string[]): any | null {
  const ranked = items.filter((item) => priorities.includes(item?.name || ""));
  if (!ranked.length) return null;
  ranked.sort(
    (a, b) => priorities.indexOf(a.name) - priorities.indexOf(b.name),
  );
  return ranked[0] || null;
}

export function createGearService(
  bot: Bot,
  config: AppConfig,
  movement: MovementService,
  logger: Logger,
): GearService {
  let acquisitionInProgress = false;

  function hasUsableWeapon(): boolean {
    if (bot.heldItem && weaponScore(bot.heldItem.name) >= 0) return true;
    return bot.inventory.items().some((item) => weaponScore(item.name) >= 0);
  }

  async function equipBestWeapon(): Promise<boolean> {
    const bestWeapon = bot.inventory
      .items()
      .filter((item) => weaponScore(item.name) >= 0)
      .sort((a, b) => weaponScore(b.name) - weaponScore(a.name))[0];
    if (!bestWeapon) return false;
    if (bot.heldItem?.name === bestWeapon.name) return true;
    await bot.equip(bestWeapon, "hand");
    return true;
  }

  async function equipBestArmorAndShield(): Promise<void> {
    const items = bot.inventory.items();
    for (const [destination, priorities] of Object.entries(ARMOR_PRIORITY) as Array<
      [keyof typeof ARMOR_PRIORITY, readonly string[]]
    >) {
      const equipped = bot.inventory.slots[EQUIPMENT_SLOT_INDEX[destination]];
      const equippedScore = equipped
        ? priorities.length - priorities.indexOf(equipped.name)
        : 0;
      const candidate = bestItemByPriority(items, priorities);
      if (!candidate) continue;
      const candidateScore = priorities.length - priorities.indexOf(candidate.name);
      if (equipped && equippedScore >= candidateScore) continue;
      await bot.equip(candidate, destination as "head" | "torso" | "legs" | "feet");
    }

    const offhand = bot.inventory.slots[EQUIPMENT_SLOT_INDEX.offhand];
    const shield = bestItemByPriority(items, ["shield"]);
    if (shield && offhand?.name !== "shield") {
      await bot.equip(shield, "off-hand");
    }
  }

  function hasArmorPiece(destination: keyof typeof ARMOR_PRIORITY): boolean {
    const allowed = ARMOR_PRIORITY[destination] as readonly string[];
    const equipped = bot.inventory.slots[EQUIPMENT_SLOT_INDEX[destination]];
    if (equipped && allowed.includes(equipped.name)) return true;
    return bot.inventory.items().some((item) => allowed.includes(item.name));
  }

  function hasShield(): boolean {
    const offhand = bot.inventory.slots[EQUIPMENT_SLOT_INDEX.offhand];
    if (offhand?.name === "shield") return true;
    return bot.inventory.items().some((item) => item.name === "shield");
  }

  async function acquireFromGearChest(): Promise<void> {
    const chestPos = new Vec3(
      config.gearChestPosition.x,
      config.gearChestPosition.y,
      config.gearChestPosition.z,
    );
    await movement.goNear(chestPos, 2, config.movementTimeoutMs * 2);
    const chestBlock = bot.blockAt(chestPos);
    if (!isChestBlock(chestBlock)) {
      throw new Error("gear_chest_missing");
    }

    const chest = await bot.openChest(chestBlock as any);
    try {
      const containerItems = chest.containerItems() || [];

      if (!hasUsableWeapon()) {
        const weapon = containerItems
          .filter((item: any) => weaponScore(item?.name || "") >= 0)
          .sort((a: any, b: any) => weaponScore(b.name) - weaponScore(a.name))[0];
        if (weapon) {
          await chest.withdraw(weapon.type, weapon.metadata ?? 0, 1);
        }
      }

      for (const destination of Object.keys(ARMOR_PRIORITY) as Array<
        keyof typeof ARMOR_PRIORITY
      >) {
        if (hasArmorPiece(destination)) continue;
        const piece = bestItemByPriority(containerItems, ARMOR_PRIORITY[destination]);
        if (!piece) continue;
        await chest.withdraw(piece.type, piece.metadata ?? 0, 1);
      }

      if (!hasShield()) {
        const shield = bestItemByPriority(containerItems, ["shield"]);
        if (shield) {
          await chest.withdraw(shield.type, shield.metadata ?? 0, 1);
        }
      }
    } finally {
      chest.close();
    }
  }

  async function ensureCombatGear(trigger = "unknown"): Promise<boolean> {
    try {
      if (!hasUsableWeapon() && !acquisitionInProgress) {
        acquisitionInProgress = true;
        try {
          await acquireFromGearChest();
        } catch (error) {
          logger.warn(
            `Gear acquisition skipped (${trigger}).`,
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          acquisitionInProgress = false;
        }
      }

      await equipBestWeapon();
      await equipBestArmorAndShield();
      return hasUsableWeapon();
    } catch (error) {
      logger.warn(
        "Could not equip combat gear.",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  return {
    ensureCombatGear,
    equipBestWeapon,
    hasUsableWeapon,
  };
}
