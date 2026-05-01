import type { Bot } from "mineflayer";
import type {
  AfkService,
  AppState,
  CombatService,
  FarmService,
  FollowService,
  GearService,
  Logger,
  MovementService,
  PatrolService,
} from "../types";

const HOSTILE_MOBS = new Set([
  "blaze",
  "bogged",
  "breeze",
  "creeper",
  "drowned",
  "elder_guardian",
  "endermite",
  "evoker",
  "ghast",
  "guardian",
  "husk",
  "illusioner",
  "magma_cube",
  "phantom",
  "piglin_brute",
  "pillager",
  "ravager",
  "shulker",
  "silverfish",
  "skeleton",
  "slime",
  "spider",
  "stray",
  "vex",
  "vindicator",
  "warden",
  "witch",
  "wither_skeleton",
  "zoglin",
  "zombie",
  "zombie_villager",
]);

const ATTACK_RANGE = 3;
const COMBAT_MAX_MS = 45 * 1000;

function isInterruptedMovementError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text === "movement_interrupted" ||
    text.includes("The goal was changed before it could be completed!")
  );
}

function isAliveTarget(entity: any): boolean {
  if (!entity || !entity.position) return false;
  if (entity.isValid === false) return false;
  if (typeof entity.health === "number" && entity.health <= 0) return false;
  return true;
}

export function createCombatService(
  bot: Bot,
  logger: Logger,
  state: AppState,
  movement: MovementService,
  follow: FollowService,
  afk: AfkService,
  farm: FarmService,
  patrol: PatrolService,
  gear: GearService,
  resumeAutoFarmByDefault: boolean,
): CombatService {
  let combatTargetId: number | null = null;
  let combatEndsAt = 0;
  let combatGeneration = 0;
  let targetLostStreak = 0;

  function isHostileMob(attacker: any): boolean {
    if (!attacker) return false;
    const entityType = typeof attacker.type === "string" ? attacker.type : "";
    if (
      entityType &&
      entityType !== "mob" &&
      entityType !== "hostile" &&
      entityType !== "monster"
    ) {
      return false;
    }
    const name = typeof attacker.name === "string" ? attacker.name : "";
    if (!name || !HOSTILE_MOBS.has(name)) return false;
    return true;
  }

  function findNearestHostile(maxDistance: number): any | null {
    let nearest: any | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of Object.values(bot.entities) as any[]) {
      if (!isHostileMob(candidate) || !candidate?.position) continue;
      const dist = bot.entity.position.distanceTo(candidate.position);
      if (dist > maxDistance || dist >= nearestDistance) continue;
      nearest = candidate;
      nearestDistance = dist;
    }
    return nearest;
  }

  function resolveTarget(): any | null {
    if (combatTargetId === null) return null;
    return bot.entities[combatTargetId] || null;
  }

  function setAutoEatEnabled(enabled: boolean): void {
    const autoEat = (bot as any).autoEat as
      | {
          enableAuto?: () => void;
          enable?: () => void;
          disableAuto?: () => void;
          disable?: () => void;
        }
      | undefined;
    if (!autoEat) return;
    try {
      if (enabled) {
        if (typeof autoEat.enableAuto === "function") {
          autoEat.enableAuto();
          return;
        }
        if (typeof autoEat.enable === "function") {
          autoEat.enable();
          return;
        }
        return;
      }
      if (typeof autoEat.disableAuto === "function") {
        autoEat.disableAuto();
      } else if (typeof autoEat.disable === "function") {
        autoEat.disable();
      }
      bot.deactivateItem();
    } catch (error) {
      logger.debug(
        "Could not toggle auto-eat state.",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function pauseActivitiesForCombat(): void {
    patrol.stopPatrol();
    follow.stopFollow();
    afk.stopAfk();
    farm.stopAutoFarm();
    farm.interruptCurrentCycle();
    movement.stop();
  }

  function restartDefaultActivitiesAfterCombat(): void {
    movement.stop();
    follow.stopFollow();
    afk.stopAfk();
    patrol.stopPatrol();
    farm.stopAutoFarm();
    farm.interruptCurrentCycle();
    state.mode = "patrolling";
    if (resumeAutoFarmByDefault) {
      farm.startAutoFarm();
      return;
    }
    patrol.startPatrol();
  }

  function cleanupCombatState(): void {
    combatTargetId = null;
    combatEndsAt = 0;
    targetLostStreak = 0;
  }

  function cancelCombat(resumePrevious = false): boolean {
    if (state.mode !== "combat" && combatTargetId === null) return false;
    combatGeneration += 1;
    movement.stop();

    cleanupCombatState();
    if (state.mode === "combat") {
      state.mode = "patrolling";
    }

    if (resumePrevious) restartDefaultActivitiesAfterCombat();
    setAutoEatEnabled(true);
    gear.stowWeaponFromHand().catch(() => undefined);
    return true;
  }

  async function runCombatLoop(generation: number): Promise<void> {
    while (
      state.mode === "combat" &&
      combatGeneration === generation &&
      Date.now() < combatEndsAt
    ) {
      const target = resolveTarget();
      if (!target || !isAliveTarget(target) || !isHostileMob(target)) {
        const nearbyHostile = findNearestHostile(8);
        if (nearbyHostile) {
          combatTargetId =
            typeof nearbyHostile.id === "number" ? Math.floor(nearbyHostile.id) : null;
          targetLostStreak = 0;
          await bot.waitForTicks(2);
          continue;
        }
        targetLostStreak += 1;
        if (targetLostStreak >= 3) {
          cancelCombat(true);
          return;
        }
        await bot.waitForTicks(10);
        continue;
      }
      targetLostStreak = 0;

      await gear.equipBestWeapon().catch(() => undefined);
      const targetDistance = bot.entity.position.distanceTo(target.position);
      if (targetDistance <= ATTACK_RANGE) {
        try {
          await bot.lookAt(target.position.offset(0, Math.min(1.2, target.height || 1), 0), true);
          await bot.attack(target);
        } catch (error) {
          logger.debug(
            "Combat attack attempt failed.",
            error instanceof Error ? error.message : String(error),
          );
        }
      } else {
        try {
          await movement.goNear(target.position, 2, 3500);
        } catch (error) {
          if (!isInterruptedMovementError(error)) {
            logger.debug(
              "Combat move skipped.",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
      await bot.waitForTicks(10);
    }

    if (state.mode === "combat") {
      cancelCombat(true);
    }
  }

  function startRetaliationFromAttacker(attacker: any, reason = "unknown"): boolean {
    if (!attacker || attacker.id === bot.entity.id || !isHostileMob(attacker)) return false;
    const attackerId =
      typeof attacker.id === "number" ? Math.floor(attacker.id) : null;
    if (attackerId === null) return false;

    const isNewCombat = state.mode !== "combat";
    combatTargetId = attackerId;
    combatEndsAt = Date.now() + COMBAT_MAX_MS;

    if (isNewCombat) {
      pauseActivitiesForCombat();
      state.mode = "combat";
      setAutoEatEnabled(false);
      logger.warn(`Retaliating against hostile attacker (${reason}): ${attacker.name || `entity#${attacker.id}`}.`);
      gear.ensureCombatGear("combat_start").catch(() => undefined);
      combatGeneration += 1;
      const generation = combatGeneration;
      setTimeout(() => {
        runCombatLoop(generation).catch((error: unknown) => {
          logger.error(
            "Combat loop failed.",
            error instanceof Error ? error.message : String(error),
          );
          cancelCombat(true);
        });
      }, 0);
    }
    return true;
  }

  function retaliateFromDamageEvent(source?: any, reason = "unknown"): boolean {
    if (source && startRetaliationFromAttacker(source, reason)) return true;
    const nearbyHostile = findNearestHostile(6.5);
    if (!nearbyHostile) return false;
    return startRetaliationFromAttacker(nearbyHostile, `${reason}_nearby`);
  }

  function isInCombat(): boolean {
    return state.mode === "combat";
  }

  return {
    startRetaliationFromAttacker,
    retaliateFromDamageEvent,
    cancelCombat,
    isInCombat,
  };
}
