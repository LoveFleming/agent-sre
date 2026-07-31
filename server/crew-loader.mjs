/**
 * crew-loader.mjs — Load crew definitions from crews/*.json
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const CREWS_DIR = resolve(ROOT, "crews");

const _cache = new Map();

/** Load all crews */
export function loadAllCrews() {
  if (!existsSync(CREWS_DIR)) return [];

  const files = readdirSync(CREWS_DIR).filter(f => f.endsWith(".json"));
  const crews = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(CREWS_DIR, file), "utf-8"));
      crews.push(data);
      _cache.set(data.id || file.replace(".json", ""), data);
    } catch (err) {
      console.error(`[crew-loader] Failed to load ${file}: ${err.message}`);
    }
  }

  return crews;
}

/** Get crew by ID */
export function getCrew(id) {
  if (_cache.size === 0) loadAllCrews();
  return _cache.get(id) || null;
}

/** List crew summaries */
export function listCrews() {
  return loadAllCrews().map(c => ({
    id: c.id,
    title: c.title,
    codename: c.codename,
    emoji: c.emoji,
    description: c.description,
    expertise: c.expertise?.slice(0, 100),
    imageUrl: c.imageUrl,
    greeting: c.chatConfig?.greeting,
  }));
}
