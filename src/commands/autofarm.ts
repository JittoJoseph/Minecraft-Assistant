import type { CommandHandler } from "../types";

const autofarm: CommandHandler = {
  name: "autofarm",
  match: (msg) => msg === "autofarm on" || msg === "autofarm off",
  async execute(ctx) {
    if (ctx.message === "autofarm on") {
      const started = ctx.services.farm.startAutoFarm();
      ctx.bot.chat(started ? "Autofarm enabled." : "Autofarm already running.");
      return;
    }
    const stopped = ctx.services.farm.stopAutoFarm();
    ctx.bot.chat(stopped ? "Autofarm disabled." : "Autofarm already stopped.");
  },
};

export default autofarm;
