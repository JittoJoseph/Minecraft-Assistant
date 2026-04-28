import type { CommandHandler } from "../types";

const afk: CommandHandler = {
  name: "afk",
  match: (msg) => msg === "afk",
  async execute(ctx) {
    ctx.services.follow.stopFollow();
    const player = ctx.bot.players[ctx.username];
    let pos = undefined;
    if (player?.entity) pos = { x: Math.floor(player.entity.position.x), y: Math.floor(player.entity.position.y), z: Math.floor(player.entity.position.z) };
    await ctx.services.afk.startAfk(pos);
    ctx.bot.chat("AFK mode enabled at your position.");
  },
};

export default afk;
