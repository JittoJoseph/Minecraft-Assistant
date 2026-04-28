import type { CommandHandler } from "../types";

const help: CommandHandler = {
  name: "help",
  match: (msg) => msg === "help",
  async execute(ctx) {
    ctx.bot.chat("Commands: follow me | come | afk | stop | setspawnpoint | farm | autofarm on/off | help");
  }
};

export default help;
