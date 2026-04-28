import type { Bot } from "mineflayer";
import commands from "../commands";
import type { AppConfig, Logger, Services } from "../types";

export function createCommandRouter(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  services: Services,
) {
  const lastCommandByUser = new Map<string, { command: string; at: number }>();

  function isAuthorized(username: string): boolean {
    if (!config.trustedPlayers.length) return true;
    return config.trustedPlayers.includes(username);
  }

  async function handleChat(
    username: string,
    rawMessage: string,
  ): Promise<void> {
    if (username === bot.username) return;
    if (!isAuthorized(username)) return;

    const content = rawMessage.trim().toLowerCase();

    if (!content) return;

    const now = Date.now();
    const last = lastCommandByUser.get(username);
    if (last && last.command === content && now - last.at < 1500) return;
    lastCommandByUser.set(username, { command: content, at: now });

    const command = commands.find((entry) => entry.match(content));
    if (!command) return;

    try {
      // if bot is AFK and someone issues another command, abandon AFK first
      if (
        command.name !== "afk" &&
        command.name !== "sleep" &&
        command.name !== "autosleep"
      ) {
        services.afk.stopAfk();
      }

      await command.execute({
        bot,
        config,
        services,
        username,
        message: content,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      logger.warn(`Command '${command.name}' failed`, text);
    }
  }

  return { handleChat };
}
