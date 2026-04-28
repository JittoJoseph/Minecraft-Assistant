import type { CommandHandler } from "../types";

const unloadinventory: CommandHandler = {
  name: "unloadinventory",
  match: (msg) => msg === "unloadinventory",
  async execute(ctx) {
    ctx.bot.chat("Unloading inventory to chests...");
    const unloaded = await ctx.services.farm.unloadToChest();
    if (unloaded) {
      ctx.bot.chat("Inventory unload complete.");
      return;
    }
    ctx.bot.chat("Inventory unload failed or nothing to unload.");
  },
};

export default unloadinventory;
