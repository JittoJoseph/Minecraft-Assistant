import type { CommandHandler } from "../types";

function isBed(block: any): boolean {
  return Boolean(block?.name && block.name.endsWith("_bed"));
}

function findBedAtPlayer(bot: any, username: string): any | null {
  const player = bot.players[username];
  const base = player?.entity?.position?.floored?.();
  if (!base) return null;

  const checks = [
    base.offset(0, -1, 0),
    base,
    base.offset(1, -1, 0),
    base.offset(-1, -1, 0),
    base.offset(0, -1, 1),
    base.offset(0, -1, -1),
  ];

  for (const pos of checks) {
    const block = bot.blockAt(pos);
    if (isBed(block)) return block;
  }
  return null;
}

const setspawnpoint: CommandHandler = {
  name: "setspawnpoint",
  match: (msg) => msg === "setspawnpoint",
  async execute(ctx) {
    const bedBlock = findBedAtPlayer(ctx.bot, ctx.username);
    if (!bedBlock) {
      throw new Error("Stand on a bed and say setspawnpoint.");
    }

    ctx.services.afk.stopAfk();
    ctx.services.follow.stopFollow();

    await ctx.services.movement.goNear(bedBlock.position, 1);
    await ctx.bot.lookAt(bedBlock.position.offset(0.5, 0.5, 0.5), true);
    await ctx.bot.activateBlock(bedBlock);
    ctx.services.sleep.setSpawnBedPosition({
      x: bedBlock.position.x,
      y: bedBlock.position.y,
      z: bedBlock.position.z,
    });
    ctx.bot.chat(
      `Spawn bed set to x=${bedBlock.position.x} y=${bedBlock.position.y} z=${bedBlock.position.z}.`,
    );
    ctx.bot.chat(
      `Env: SPAWN_BED_X=${bedBlock.position.x} SPAWN_BED_Y=${bedBlock.position.y} SPAWN_BED_Z=${bedBlock.position.z}`,
    );
  },
};

export default setspawnpoint;
