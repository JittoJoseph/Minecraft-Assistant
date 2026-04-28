import type { Position3 } from "../types";

export function toPositionKey(position: Position3): string {
  return `${position.x},${position.y},${position.z}`;
}

export function parseCoordinateTriplet(
  value: string | undefined,
): Position3 | null {
  if (!value) return null;
  const parts = String(value)
    .split(",")
    .map((v) => Number(v.trim()));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

export function parseServerAddress(
  value: string | undefined,
): { host: string; port: number } | null {
  if (!value || !value.includes(":")) return null;
  const [host, portRaw] = value.split(":");
  const port = Number(portRaw);
  if (!host || Number.isNaN(port)) return null;
  return { host, port };
}
