import type { CommandHandler } from "../types";

const MAX_CHAT_LENGTH = 240;

function pluralizeStack(count: number): string {
  return count === 1 ? "stack" : "stacks";
}

function formatItemSummary(
  itemName: string,
  count: number,
  stackSize: number,
): string {
  const label = itemName.replaceAll("_", " ");
  if (stackSize > 1 && count >= stackSize) {
    const fullStacks = Math.floor(count / stackSize);
    const remainder = count % stackSize;
    if (remainder === 0) {
      return `${label} x ${fullStacks} ${pluralizeStack(fullStacks)}`;
    }
    return `${label} x ${fullStacks} ${pluralizeStack(fullStacks)} + ${remainder}`;
  }
  return `${label} x ${count}`;
}

const listitems: CommandHandler = {
  name: "listitems",
  match: (msg) => msg === "listitems",
  async execute(ctx) {
    const totals = new Map<string, { count: number; stackSize: number }>();

    for (const item of ctx.bot.inventory.items()) {
      const existing = totals.get(item.name);
      if (existing) {
        existing.count += item.count;
        continue;
      }
      totals.set(item.name, {
        count: item.count,
        stackSize: item.stackSize || 64,
      });
    }

    if (!totals.size) {
      ctx.bot.chat("Inventory: empty.");
      return;
    }

    const summaries = Array.from(totals.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, info]) => formatItemSummary(name, info.count, info.stackSize));

    let message = "Inventory: ";
    for (let i = 0; i < summaries.length; i += 1) {
      const part = i === 0 ? summaries[i] : `, ${summaries[i]}`;
      if (message.length + part.length > MAX_CHAT_LENGTH) {
        message += ", ...";
        break;
      }
      message += part;
    }

    ctx.bot.chat(message);
  },
};

export default listitems;
