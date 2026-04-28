import type { CommandHandler } from "../types";

const help: CommandHandler = {
  name: "help",
  match: (msg) => msg === "help",
  async execute(ctx) {
    ctx.bot.chat(
      "Commands: follow me | come | afk | stop | farm | autofarm on/off",
    );
  },
};

export default help;
