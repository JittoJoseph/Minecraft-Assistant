import type { CommandHandler } from "../types";

const follow: CommandHandler = {
  name: "follow",
  match: (msg) => msg === "follow me",
  async execute(ctx) {
    ctx.services.afk.stopAfk();
    ctx.services.follow.startFollow(ctx.username);
    ctx.bot.chat(`Following ${ctx.username}.`);
  },
};

export default follow;
