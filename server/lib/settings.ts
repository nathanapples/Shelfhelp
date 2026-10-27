import { randomBytes } from "node:crypto";
import { db } from "./db.js";

export type Strictness = "strict" | "balanced" | "loose";

export interface Settings {
  hardcoverToken: string;
  absUrl: string;
  absToken: string;
  /** Minutes between automatic syncs. 0 turns the schedule off. */
  syncIntervalMinutes: number;
  matchStrictness: Strictness;
  /** Send Audiobookshelf listening progress to Hardcover. */
  readingEnabled: boolean;
  /** The first reading sync is a preview until this is true. */
  readingApproved: boolean;
}

const defaults: Settings = {
  hardcoverToken: "",
  absUrl: "",
  absToken: "",
  syncIntervalMinutes: 360,
  matchStrictness: "balanced",
  readingEnabled: true,
  readingApproved: false,
};

/** Environment variables win over saved values, so a compose file can pin them. */
const envKeys: Partial<Record<keyof Settings, string>> = {
  hardcoverToken: "HARDCOVER_TOKEN",
  absUrl: "ABS_URL",
  absToken: "ABS_TOKEN",
  syncIntervalMinutes: "SYNC_INTERVAL_MINUTES",
};

export function getSettings(): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const saved: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      saved[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore */
    }
  }
  const out = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (saved[key] !== undefined) out[key] = saved[key];
    const env = envKeys[key];
    if (env && process.env[env]) {
      out[key] = typeof defaults[key] === "number" ? Number(process.env[env]) : process.env[env];
    }
  }
  const s = out as unknown as Settings;
  s.absUrl = s.absUrl.replace(/\/+$/, "");
  return s;
}

export function lockedByEnv(): (keyof Settings)[] {
  return (Object.keys(envKeys) as (keyof Settings)[]).filter((k) => !!process.env[envKeys[k]!]);
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults) || value === undefined) continue;
    stmt.run(key, JSON.stringify(value));
  }
  return getSettings();
}

/** Internal values that aren't user settings (session secret and the like). */
export function internal(key: string, make: () => string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`_${key}`) as { value: string } | undefined;
  if (row) return JSON.parse(row.value);
  const value = make();
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(`_${key}`, JSON.stringify(value));
  return value;
}

export const sessionSecret = () => internal("sessionSecret", () => randomBytes(32).toString("hex"));

export function isConfigured(s = getSettings()) {
  return { hardcover: !!s.hardcoverToken, abs: !!(s.absUrl && s.absToken) };
}
