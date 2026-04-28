import { createAssistantBot } from "./bot/createAssistantBot";
import logger from "./utils/logger";

process.on("uncaughtException", (error: Error) => {
  logger.error("uncaughtException", error.message);
});

process.on("unhandledRejection", (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  logger.error("unhandledRejection", text);
});

createAssistantBot();
