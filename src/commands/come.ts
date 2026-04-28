import type { CommandHandler } from "../types";

const come: CommandHandler = {
  name: "come",
  match: (msg) => msg === "come",
  async execute(ctx) {
    const player = ctx.bot.players[ctx.username];
    if (!player?.entity) {
      throw new Error("I can't find your position right now.");
    }
    ctx.services.afk.stopAfk();
    await ctx.services.movement.goNear(player.entity.position, 1);
    ctx.bot.chat(`I'm here, ${ctx.username}.`);
  },
};

export default come;
