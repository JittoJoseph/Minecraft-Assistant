import type { Bot } from "mineflayer";
import commands from "../commands";
import type { AppConfig, Logger, Services } from "../types";

export function createCommandRouter(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  services: Services,
) {
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
    const command = commands.find((entry) => entry.match(content));
    if (!command) return;

    try {
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
      bot.chat(`Command failed: ${command.name}`);
    }
  }

  return { handleChat };
}
