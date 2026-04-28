import type { CommandHandler } from "../types";

const help: CommandHandler = {
  name: "help",
  match: (msg) => msg === "help",
  async execute(ctx) {
    const lines = [
      "=== Minecraft Assistant Help ===",
      "follow me — Bot starts following the player",
      "come — Bot pathfinds to your position once",
      "afk — Bot moves to AFK position and optionally performs small movement",
      "stop — Stops following/movement/farming",
      "farm — Run a single farming cycle (harvest & replant)",
      "autofarm on / autofarm off — Toggle continuous farming",
      "help — Show this help message",
      "Note: No command prefix needed; say the commands plainly in chat."
    ];
    for (const line of lines) ctx.bot.chat(line);
  },
};

export default help;
