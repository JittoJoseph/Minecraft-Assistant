import type { DiscordService, Logger } from "../types";

interface DiscordEmbed {
  title: string;
  description: string;
  color?: number;
  timestamp: string;
}

function sanitize(name: string): string {
  return name.trim() || "unknown";
}

export function createDiscordService(
  webhookUrl: string,
  botName: string,
  logger: Logger,
): DiscordService {
  async function sendEmbed(embed: DiscordEmbed): Promise<void> {
    if (!webhookUrl) return;
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: botName,
          embeds: [embed],
        }),
      });
      if (!response.ok) {
        logger.warn(
          "Discord webhook request failed.",
          `${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      logger.warn(
        "Discord webhook request failed.",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function notifyPlayerJoined(username: string): Promise<void> {
    const player = sanitize(username);
    await sendEmbed({
      title: "Minecraft Activity",
      description: `Bot ${botName}\nEvent Player Joined\nPlayer ${player}`,
      color: 0x3b82f6,
      timestamp: new Date().toISOString(),
    });
  }

  async function notifyPlayerLeft(username: string): Promise<void> {
    const player = sanitize(username);
    await sendEmbed({
      title: "Minecraft Activity",
      description: `Bot ${botName}\nEvent Player Left\nPlayer ${player}`,
      color: 0xf97316,
      timestamp: new Date().toISOString(),
    });
  }

  async function sendOnlinePlayers(
    requestedBy: string,
    players: string[],
  ): Promise<void> {
    const uniquePlayers = Array.from(
      new Set(players.map((name) => sanitize(name)).filter(Boolean)),
    );
    const playerLines =
      uniquePlayers.length > 0
        ? uniquePlayers.map((name, index) => `${index + 1}. ${name}`).join("\n")
        : "No online players found";
    await sendEmbed({
      title: "Minecraft Activity",
      description:
        `Bot ${botName}\n` +
        `Event Online Players Requested\n` +
        `Requested By ${sanitize(requestedBy)}\n` +
        `Online Count ${uniquePlayers.length}\n` +
        `Players\n${playerLines}`,
      color: 0x22c55e,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    notifyPlayerJoined,
    notifyPlayerLeft,
    sendOnlinePlayers,
  };
}
