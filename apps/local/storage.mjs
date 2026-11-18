import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const checkout = fileURLToPath(new URL("../../", import.meta.url));
export const defaultRoot = () =>
  join(
    process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
    "GoblinLedger",
  );

export function migrate(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1)
    throw new Error("This profile needs a newer Goblin Ledger version.");
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      PRAGMA user_version=1;
      COMMIT;`);
  }
}

export function readPreference(db, key, fallback) {
  const row = db.prepare("SELECT json FROM preferences WHERE key=?").get(key);
  return row ? JSON.parse(row.json) : fallback;
}
export function savePreference(db, key, value) {
  db.prepare(
    "INSERT INTO preferences(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json",
  ).run(key, JSON.stringify(value));
}
export function inside(parent, child) {
  const part = relative(parent, child);
  return !part || (!part.startsWith("..") && !isAbsolute(part));
}

export async function openProfiles(root = defaultRoot()) {
  const location = resolve(root);
  if (inside(checkout, location))
    throw new Error("Choose a private data directory outside the checkout.");
  mkdirSync(location, { recursive: true });
  const profiles = {};
  try {
    for (const mode of ["live", "demo"]) {
      const dir = join(location, mode);
      mkdirSync(dir, { recursive: true });
      if (inside(realpathSync(checkout), realpathSync(dir)))
        throw new Error("Data directory resolves into the checkout.");
      const path = join(dir, "ledger.sqlite");
      const existing = existsSync(path);
      const db = new DatabaseSync(path);
      profiles[mode] = { mode, dir, db, region: null };
      db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      if (
        existing &&
        db.prepare("PRAGMA user_version").get().user_version < 1
      ) {
        await backup(db, join(dir, "before-schema-1.sqlite"));
      }
      migrate(db);
      profiles[mode].region = readPreference(db, "region", null);
    }
    return profiles;
  } catch (error) {
    for (const profile of Object.values(profiles)) profile.db.close();
    throw error;
  }
}
