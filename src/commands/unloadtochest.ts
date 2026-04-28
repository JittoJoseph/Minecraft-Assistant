import type { CommandHandler } from "../types";

const unloadtochest: CommandHandler = {
  name: "unloadtochest",
  match: (msg) => msg === "unloadtochest",
  async execute(ctx) {
    ctx.bot.chat("Unloading farm items to chest...");
    const unloaded = await ctx.services.farm.unloadToChest();
    if (unloaded) {
      ctx.bot.chat("Unload complete.");
      return;
    }
    ctx.bot.chat("Unload failed or nothing to unload.");
  },
};

export default unloadtochest;
