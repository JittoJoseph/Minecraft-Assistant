import type { CommandHandler } from "../types";

const sleep: CommandHandler = {
  name: "sleep",
  match: (msg) => msg === "sleep",
  async execute(ctx) {
    const slept = await ctx.services.sleep.sleepAtSpawnBed("manual");
    if (slept) {
      ctx.bot.chat("Sleeping at saved spawn bed.");
    }
  },
};

export default sleep;
