import type { Logger } from "../types";

function log(level: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  if (data === undefined) {
    console.log(`[${ts}] [${level}] ${message}`);
    return;
  }
  console.log(`[${ts}] [${level}] ${message}`, data);
}

const logger: Logger = {
  info: (message, data) => log("INFO", message, data),
  warn: (message, data) => log("WARN", message, data),
  error: (message, data) => log("ERROR", message, data),
  debug: (message, data) => log("DEBUG", message, data),
};

export default logger;
