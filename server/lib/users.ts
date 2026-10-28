/**
 * People who use Shelfhelp, and the "current reader" for reading sync.
 *
 * User 1 is the owner: the Audiobookshelf user whose API key Shelfhelp uses
 * and the Hardcover token in Settings. Other users are Audiobookshelf users
 * who signed in (or whom an admin added as readers), each with their own
 * Hardcover token and reading options.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./db.js";
import { getSettings } from "./settings.js";
import { Abs } from "./abs.js";

export const OWNER_ID = 1;

export interface UserRow {
  id: number;
  abs_user_id: string | null;
  username: string | null;
  email: string | null;
  display_name: string | null;
  role: "admin" | "user";
  oidc_sub: string | null;
  hardcover_token: string | null;
  reading_enabled: number;
  reading_auto_send: number;
  reading_min_progress: number;
  reading_mark_owned: number;
  created_at: string;
  last_login_at: string | null;
  discover_rows: string | null;
  want_list_at: string | null;
  shelves_at: string | null;
}

export interface Reader {
  id: number;
  isOwner: boolean;
  name: string;
  absUserId: string | null;
  hardcoverToken: string;
  enabled: boolean;
  autoSend: boolean;
  minProgress: number;
  markOwned: boolean;
}

export function getUser(id: number): UserRow | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined) ?? null;
}

export function allUsers(): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY id").all() as unknown as UserRow[];
}

export function displayName(u: UserRow) {
  return u.display_name || u.username || u.email || (u.id === OWNER_ID ? "Owner" : `User ${u.id}`);
}

export function toReader(u: UserRow): Reader {
  return {
    id: u.id,
    isOwner: u.id === OWNER_ID,
    name: displayName(u),
    absUserId: u.abs_user_id,
    // The owner uses the Hardcover token from Settings unless they set their own.
    hardcoverToken: u.hardcover_token || (u.id === OWNER_ID ? getSettings().hardcoverToken : ""),
    enabled: !!u.reading_enabled,
    autoSend: !!u.reading_auto_send,
    minProgress: u.reading_min_progress,
    markOwned: !!u.reading_mark_owned,
  };
}

/** Users who can have their reading synced: the owner, and anyone with a Hardcover token. */
export function readers(): Reader[] {
  return allUsers()
    .map(toReader)
    .filter((r) => r.isOwner || r.hardcoverToken);
}

const als = new AsyncLocalStorage<Reader>();

/** The reader the current reading work is for. Outside any context, the owner. */
export function reader(): Reader {
  return als.getStore() ?? toReader(getUser(OWNER_ID)!);
}

export function asReader<T>(r: Reader, fn: () => T): T {
  return als.run(r, fn);
}

export function readerById(id: number): Reader | null {
  const u = getUser(id);
  return u ? toReader(u) : null;
}

export function updateUser(id: number, patch: Partial<Omit<UserRow, "id" | "created_at">>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => (patch as Record<string, string | number | null>)[k]),
    id,
  );
}

/** Fills in the owner's Audiobookshelf identity from the API key, once known. */
export async function resolveOwner(): Promise<UserRow> {
  const owner = getUser(OWNER_ID)!;
  if (owner.abs_user_id) return owner;
  try {
    const me = await new Abs().me();
    const u = me as { id: string; username: string; email?: string | null };
    // Another row may already hold this Audiobookshelf user (signed in before the owner was known).
    const clash = db.prepare("SELECT id FROM users WHERE abs_user_id = ? AND id <> ?").get(u.id, OWNER_ID) as { id: number } | undefined;
    if (clash) db.prepare("UPDATE users SET abs_user_id = NULL WHERE id = ?").run(clash.id);
    updateUser(OWNER_ID, { abs_user_id: u.id, username: u.username, email: u.email ?? owner.email });
  } catch {
    /* Audiobookshelf not set up yet */
  }
  return getUser(OWNER_ID)!;
}

export interface AbsUser {
  id: string;
  username: string;
  email: string | null;
  type: string;
  isActive: boolean;
  hasOpenIDLink?: boolean;
}

let absUsersCache: { at: number; users: AbsUser[] } | null = null;

/** Every Audiobookshelf user (needs an admin API key). */
export async function absUsers(fresh = false): Promise<AbsUser[]> {
  if (!fresh && absUsersCache && Date.now() - absUsersCache.at < 60_000) return absUsersCache.users;
  const users = await new Abs().users();
  absUsersCache = { at: Date.now(), users };
  return users;
}

/** The Shelfhelp user for an Audiobookshelf user, created if needed. */
export async function userForAbs(a: AbsUser): Promise<UserRow> {
  const owner = await resolveOwner();
  const role = a.type === "root" || a.type === "admin" ? "admin" : "user";
  if (owner.abs_user_id === a.id) {
    updateUser(OWNER_ID, { username: a.username, email: a.email, role: "admin" });
    return getUser(OWNER_ID)!;
  }
  const found = db.prepare("SELECT * FROM users WHERE abs_user_id = ?").get(a.id) as unknown as UserRow | undefined;
  if (found) {
    updateUser(found.id, { username: a.username, email: a.email, role: found.role === "admin" ? "admin" : role });
    return getUser(found.id)!;
  }
  const r = db
    .prepare("INSERT INTO users (abs_user_id, username, email, role, reading_enabled) VALUES (?, ?, ?, ?, 0)")
    .run(a.id, a.username, a.email, role);
  return getUser(Number(r.lastInsertRowid))!;
}

/**
 * Finds the Audiobookshelf user for a signed-in person, the way Audiobookshelf
 * links OpenID accounts itself: verified email first, then username.
 */
export async function matchAbsUser(claims: { email?: string | null; emailVerified?: boolean; username?: string | null }): Promise<AbsUser | null> {
  const users = (await absUsers(true)).filter((u) => u.isActive !== false);
  const email = claims.email?.trim().toLowerCase();
  if (email && claims.emailVerified !== false) {
    const byEmail = users.find((u) => u.email?.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = claims.username?.trim().toLowerCase();
  if (name) {
    const byName = users.find((u) => u.username.toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

export function userView(u: UserRow) {
  const r = toReader(u);
  return {
    id: u.id,
    name: displayName(u),
    username: u.username,
    email: u.email,
    role: u.role,
    isOwner: u.id === OWNER_ID,
    absUserId: u.abs_user_id,
    hasHardcover: !!r.hardcoverToken,
    ownHardcoverToken: !!u.hardcover_token,
    readingEnabled: r.enabled,
    lastLoginAt: u.last_login_at,
  };
}
