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
    ctx.bot.chat(`Spawn point set at ${ctx.username}'s bed.`);
  },
};

export default setspawnpoint;
