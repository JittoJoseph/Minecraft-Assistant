import { Vec3 } from "vec3";
import type { CommandHandler } from "../types";
import { loadSpawnBedPosition } from "../services/spawnPointStore";

function isBedBlock(block: any): boolean {
  return Boolean(block?.name && block.name.endsWith("_bed"));
}

const sleep: CommandHandler = {
  name: "sleep",
  match: (msg) => msg === "sleep",
  async execute(ctx) {
    ctx.services.follow.stopFollow();
    ctx.services.afk.stopAfk();
    ctx.services.farm.stopAutoFarm();
    ctx.services.farm.interruptCurrentCycle();
    ctx.services.movement.stop();

    const spawnBed = await loadSpawnBedPosition();
    if (!spawnBed) {
      ctx.bot.chat("No saved spawn bed. Use setspawnpoint first.");
      return;
    }

    const bedPos = new Vec3(spawnBed.x, spawnBed.y, spawnBed.z);
    const bedBlock = ctx.bot.blockAt(bedPos);
    if (!isBedBlock(bedBlock)) {
      ctx.bot.chat("Saved spawn bed not found. Use setspawnpoint again.");
      return;
    }

    await ctx.services.movement.goNear(bedBlock.position, 1, ctx.config.movementTimeoutMs * 2);
    await ctx.bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5), true);

    if (ctx.bot.isSleeping) {
      ctx.bot.chat("Already sleeping.");
      return;
    }

    try {
      await ctx.bot.sleep(bedBlock);
      ctx.bot.chat("Sleeping at saved spawn bed.");
    } catch (error) {
      ctx.bot.chat(
        `Could not sleep now: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export default sleep;
