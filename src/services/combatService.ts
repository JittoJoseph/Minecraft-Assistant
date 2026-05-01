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
  Position3,
} from "../types";
import {
  createActivityLifecycle,
  type ActivitySnapshot,
} from "./activityLifecycle";

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
const PURSUIT_RADIUS = 18;
const COMBAT_MAX_MS = 45 * 1000;

function isInterruptedMovementError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text === "movement_interrupted" ||
    text.includes("The goal was changed before it could be completed!")
  );
}

function distance(a: Position3, b: Position3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function currentBlockPosition(bot: Bot): Position3 {
  return {
    x: Math.floor(bot.entity.position.x),
    y: Math.floor(bot.entity.position.y),
    z: Math.floor(bot.entity.position.z),
  };
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
): CombatService {
  let resumeAfterCombat: ActivitySnapshot | null = null;
  let combatTargetId: number | null = null;
  let combatOrigin: Position3 | null = null;
  let combatEndsAt = 0;
  let combatGeneration = 0;
  let targetLostStreak = 0;
  const activity = createActivityLifecycle(
    state,
    logger,
    movement,
    follow,
    afk,
    farm,
    patrol,
  );

  function isHostileMob(attacker: any): boolean {
    if (!attacker || attacker.type !== "mob") return false;
    const name = typeof attacker.name === "string" ? attacker.name : "";
    if (!name || !HOSTILE_MOBS.has(name)) return false;
    return true;
  }

  function resolveTarget(): any | null {
    if (combatTargetId === null) return null;
    return bot.entities[combatTargetId] || null;
  }

  function cleanupCombatState(): void {
    combatTargetId = null;
    combatOrigin = null;
    combatEndsAt = 0;
    targetLostStreak = 0;
  }

  function cancelCombat(resumePrevious = false): boolean {
    if (state.mode !== "combat" && !resumeAfterCombat) return false;
    combatGeneration += 1;
    movement.stop();

    const snapshot = resumeAfterCombat;
    resumeAfterCombat = null;
    cleanupCombatState();
    if (state.mode === "combat") {
      state.mode = "patrolling";
    }

    if (resumePrevious && snapshot) {
      activity
        .resumeActivity(snapshot, {
          farmTrigger: "combat_resume",
          followResumeFailureMessage: "Could not resume follow after combat.",
        })
        .catch((error: unknown) => {
          logger.error(
            "Failed to resume activity after combat.",
            error instanceof Error ? error.message : String(error),
          );
        });
    }
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
      if (!target || !target.position || !isHostileMob(target)) {
        targetLostStreak += 1;
        if (targetLostStreak >= 3) {
          cancelCombat(true);
          return;
        }
        await bot.waitForTicks(10);
        continue;
      }
      targetLostStreak = 0;

      if (
        combatOrigin &&
        distance(combatOrigin, {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z,
        }) > PURSUIT_RADIUS
      ) {
        logger.warn("Ending combat: target moved outside pursuit radius.");
        cancelCombat(true);
        return;
      }

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
    if (!combatOrigin) {
      combatOrigin = currentBlockPosition(bot);
    }

    if (isNewCombat) {
      resumeAfterCombat = activity.snapshotActivity();
      activity.pauseActivity();
      state.mode = "combat";
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

  function isInCombat(): boolean {
    return state.mode === "combat";
  }

  return {
    startRetaliationFromAttacker,
    cancelCombat,
    isInCombat,
  };
}
