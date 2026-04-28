import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Position3 } from "../types";

interface SpawnPointData {
  bed: Position3;
}

const DATA_DIR = path.join(process.cwd(), "data");
const SPAWN_FILE = path.join(DATA_DIR, "spawn-point.json");

export async function saveSpawnBedPosition(position: Position3): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const payload: SpawnPointData = { bed: position };
  await writeFile(SPAWN_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

export async function loadSpawnBedPosition(): Promise<Position3 | null> {
  try {
    const raw = await readFile(SPAWN_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SpawnPointData>;
    if (!parsed.bed) return null;
    const { x, y, z } = parsed.bed;
    if ([x, y, z].some((n) => typeof n !== "number" || Number.isNaN(n))) return null;
    return { x, y, z };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}
