import type { CommandHandler } from "../types";

const help: CommandHandler = {
  name: "help",
  match: (msg) => msg === "help",
  async execute(ctx) {
    const prefix = ctx.config.commandPrefix || "bot";
    ctx.bot.chat(
      `Use prefix '${prefix}'. Commands: follow me | come | afk | stop | setspawnpoint | sleep | farm | autofarm on/off | autosleep on/off | discord players | unloadinventory | listitems | help`,
    );
  },
};

export default help;
