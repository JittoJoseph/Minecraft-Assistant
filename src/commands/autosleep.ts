import type { CommandHandler } from "../types";

const autosleep: CommandHandler = {
  name: "autosleep",
  match: (msg) => msg === "autosleep on" || msg === "autosleep off",
  async execute(ctx) {
    if (ctx.message === "autosleep on") {
      const changed = ctx.services.sleep.setAutoSleepEnabled(true);
      ctx.bot.chat(
        changed ? "Autosleep enabled." : "Autosleep already enabled.",
      );
      await ctx.services.sleep.maybeAutoSleep();
      return;
    }

    const changed = ctx.services.sleep.setAutoSleepEnabled(false);
    ctx.bot.chat(
      changed ? "Autosleep disabled." : "Autosleep already disabled.",
    );
  },
};

export default autosleep;
