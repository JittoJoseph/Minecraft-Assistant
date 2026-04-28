import type { CommandHandler } from "../types";

const farm: CommandHandler = {
  name: "farm",
  match: (msg) => msg === "farm",
  async execute(ctx) {
    ctx.bot.chat("Starting farm cycle...");
    await ctx.services.farm.runFarmCycle("command");
    const stats = ctx.services.farm.getStats();
    ctx.bot.chat(
      `Farm done. harvested=${stats.harvested} replanted=${stats.replanted} cycles=${stats.cycles}`,
    );
  },
};

export default farm;
