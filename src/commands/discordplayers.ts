import type { CommandHandler } from "../types";

const discordplayers: CommandHandler = {
  name: "discordplayers",
  match: (msg) => msg === "discord players",
  async execute(ctx) {
    const onlinePlayers = Object.values(ctx.bot.players)
      .filter((player) => player?.entity && typeof player.username === "string")
      .map((player) => player.username);
    await ctx.services.discord.sendOnlinePlayers(ctx.username, onlinePlayers);
    ctx.bot.chat("Sent online player list to Discord.");
  },
};

export default discordplayers;
