import type { CommandHandler } from "../types";

const afk: CommandHandler = {
  name: "afk",
  match: (msg) => msg === "afk",
  async execute(ctx) {
    ctx.services.follow.stopFollow();
    await ctx.services.afk.startAfk();
    ctx.bot.chat("AFK mode enabled.");
  },
};

export default afk;
