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
  const requiredPrefix = (config.commandPrefix || "bot").trim().toLowerCase();

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
    const prefixWithSpace = `${requiredPrefix} `;
    if (!content.startsWith(prefixWithSpace)) return;
    const commandText = content.slice(prefixWithSpace.length).trim();
    if (!commandText) return;

    const now = Date.now();
    const last = lastCommandByUser.get(username);
    if (last && last.command === commandText && now - last.at < 1500) return;
    lastCommandByUser.set(username, { command: commandText, at: now });

    const command = commands.find((entry) => entry.match(commandText));
    if (!command) return;

    try {
      services.evade.cancelEvade(false);
      services.patrol.stopPatrol();
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
        message: commandText,
      });
      if (shouldResumePatrol(command.name, commandText, services)) {
        services.patrol.startPatrol();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      logger.warn(`Command '${command.name}' failed`, text);
      if (stateAllowsPatrol(services)) {
        services.patrol.startPatrol();
      }
    }
  }

  function shouldResumePatrol(
    commandName: string,
    content: string,
    servicesRef: Services,
  ): boolean {
    if (!stateAllowsPatrol(servicesRef)) return false;
    if (commandName === "follow" || commandName === "afk" || commandName === "sleep")
      return false;
    if (commandName === "autofarm" && content === "autofarm on") return false;
    return true;
  }

  function stateAllowsPatrol(servicesRef: Services): boolean {
    return !servicesRef.farm.isAutoFarmEnabled() && !servicesRef.evade.isEvading();
  }

  return { handleChat };
}
