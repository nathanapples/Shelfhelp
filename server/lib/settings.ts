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
  /** Kept for older configs; no longer used. */
  readingApproved: boolean;
  /** Send changes without asking. Off: every change waits for you to send it. */
  readingAutoSend: boolean;
  /** Books under this percent listened aren't synced. */
  readingMinProgress: number;
  /** Mark synced books as Owned on Hardcover. */
  readingMarkOwned: boolean;
  /** Audiobookshelf libraries Shelfhelp uses. Empty means every book library. */
  absLibraries: string[];
  chaptarrUrl: string;
  chaptarrApiKey: string;
  /** Show Request buttons and send requests to Chaptarr. */
  requestsEnabled: boolean;
  /** What a Request button asks for unless you pick otherwise. */
  requestFormat: RequestFormat;
  /** Search for the book as soon as it's added. */
  requestSearchNow: boolean;
  /** Tag requested authors in Chaptarr with who asked, like Seerr does in Sonarr and Radarr. */
  chaptarrTagRequests: boolean;
  /** The Chaptarr tag. {user} is the requester's username. Chaptarr lowercases it. */
  chaptarrTagFormat: string;
  /** Root folder path per format. Empty uses Chaptarr's default for that format. */
  chaptarrAudiobookRoot: string;
  chaptarrEbookRoot: string;
  /** Profile IDs per format. 0 uses the root folder's default. */
  chaptarrAudiobookQuality: number;
  chaptarrEbookQuality: number;
  chaptarrAudiobookMetadata: number;
  chaptarrEbookMetadata: number;
  /** Default Discover rows for everyone. Empty uses Shelfhelp's starter rows. */
  discoverRows: unknown[];
  /** How people sign in: none (shared password or open), oidc (Pocket ID), cloudflare (Cloudflare Access). */
  authMode: AuthMode;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  /** Optional address Shelfhelp itself uses to reach the provider (e.g. inside Docker). */
  oidcInternalUrl: string;
  /** Members of this group are admins, as well as Audiobookshelf admins. */
  oidcAdminGroup: string;
  /** Name on the sign-in button. */
  oidcLabel: string;
  /** Cloudflare Access team domain, e.g. myteam.cloudflareaccess.com */
  cfTeamDomain: string;
  /** The Application Audience (AUD) tag from Cloudflare Access. */
  cfAudience: string;
}

export type AuthMode = "none" | "oidc" | "cloudflare";

export type RequestFormat = "audiobook" | "ebook" | "both";

const defaults: Settings = {
  hardcoverToken: "",
  absUrl: "",
  absToken: "",
  syncIntervalMinutes: 360,
  matchStrictness: "balanced",
  readingEnabled: true,
  readingApproved: false,
  readingAutoSend: false,
  readingMinProgress: 5,
  readingMarkOwned: false,
  absLibraries: [],
  chaptarrUrl: "",
  chaptarrApiKey: "",
  requestsEnabled: false,
  requestFormat: "audiobook",
  requestSearchNow: true,
  chaptarrTagRequests: true,
  chaptarrTagFormat: "{user}",
  chaptarrAudiobookRoot: "",
  chaptarrEbookRoot: "",
  chaptarrAudiobookQuality: 0,
  chaptarrEbookQuality: 0,
  chaptarrAudiobookMetadata: 0,
  chaptarrEbookMetadata: 0,
  discoverRows: [],
  authMode: "none",
  oidcIssuer: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcInternalUrl: "",
  oidcAdminGroup: "",
  oidcLabel: "Pocket ID",
  cfTeamDomain: "",
  cfAudience: "",
};

/** Environment variables win over saved values, so a compose file can pin them. */
const envKeys: Partial<Record<keyof Settings, string>> = {
  hardcoverToken: "HARDCOVER_TOKEN",
  absUrl: "ABS_URL",
  absToken: "ABS_TOKEN",
  syncIntervalMinutes: "SYNC_INTERVAL_MINUTES",
  chaptarrUrl: "CHAPTARR_URL",
  chaptarrApiKey: "CHAPTARR_API_KEY",
  authMode: "AUTH_MODE",
  oidcIssuer: "OIDC_ISSUER",
  oidcClientId: "OIDC_CLIENT_ID",
  oidcClientSecret: "OIDC_CLIENT_SECRET",
  oidcInternalUrl: "OIDC_INTERNAL_URL",
  oidcAdminGroup: "OIDC_ADMIN_GROUP",
  cfTeamDomain: "CF_ACCESS_TEAM_DOMAIN",
  cfAudience: "CF_ACCESS_AUD",
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
  s.chaptarrUrl = s.chaptarrUrl.replace(/\/+$/, "");
  s.oidcIssuer = cleanIssuer(s.oidcIssuer);
  s.oidcInternalUrl = cleanIssuer(s.oidcInternalUrl);
  s.cfTeamDomain = s.cfTeamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!["none", "oidc", "cloudflare"].includes(s.authMode)) s.authMode = "none";
  return s;
}

/** Pocket ID shows its discovery link; people paste that. The issuer is the part before it. */
export function cleanIssuer(url: string) {
  return url
    .trim()
    .replace(/\/\.well-known\/openid-configuration\/?$/i, "")
    .replace(/\/+$/, "");
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
  return { hardcover: !!s.hardcoverToken, abs: !!(s.absUrl && s.absToken), chaptarr: !!(s.chaptarrUrl && s.chaptarrApiKey) };
}
