import type { CommandHandler } from "../types";

const stop: CommandHandler = {
  name: "stop",
  match: (msg) => msg === "stop",
  async execute(ctx) {
    ctx.services.evade.cancelEvade(false);
    ctx.services.farm.stopAutoFarm();
    ctx.services.farm.interruptCurrentCycle();
    ctx.services.follow.stopFollow();
    ctx.services.afk.stopAfk();
    ctx.services.movement.stop();
    ctx.bot.chat("Stopped current task.");
  },
};

export default stop;
