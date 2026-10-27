import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

mkdirSync(config.configDir, { recursive: true });

// The app used to be called Shelfhelper: carry its database over on first start.
const dbPath = path.join(config.configDir, "shelfhelp.db");
const oldPath = path.join(config.configDir, "shelfhelper.db");
if (!existsSync(dbPath) && existsSync(oldPath)) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(oldPath + suffix)) renameSync(oldPath + suffix, dbPath + suffix);
  }
}

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

/**
 * Schema migrations. Append new entries; never edit old ones.
 * Tables are shaped so per-user sync and requests can be added later
 * without reshaping what exists.
 */
const migrations: string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- A Hardcover list synced into an Audiobookshelf collection.
  CREATE TABLE lists (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type      TEXT NOT NULL DEFAULT 'hardcover_list',
    hc_list_id       INTEGER NOT NULL,
    hc_slug          TEXT,
    hc_owner         TEXT,
    name             TEXT NOT NULL,
    description      TEXT,
    abs_library_id   TEXT NOT NULL,
    abs_collection_id TEXT,
    collection_name  TEXT NOT NULL,
    remove_missing   INTEGER NOT NULL DEFAULT 1,
    keep_order       INTEGER NOT NULL DEFAULT 1,
    enabled          INTEGER NOT NULL DEFAULT 1,
    last_synced_at   TEXT,
    last_status      TEXT,
    last_error       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every book on a synced list, with its match result.
  CREATE TABLE list_books (
    list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    hc_book_id      INTEGER NOT NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    slug            TEXT,
    title           TEXT NOT NULL,
    subtitle        TEXT,
    authors         TEXT NOT NULL DEFAULT '[]',
    series_name     TEXT,
    series_position REAL,
    cover_url       TEXT,
    release_year    INTEGER,
    audio_seconds   INTEGER,
    status          TEXT NOT NULL DEFAULT 'missing',
    match_source    TEXT,
    abs_item_id     TEXT,
    score           REAL,
    reasons         TEXT NOT NULL DEFAULT '[]',
    candidates      TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (list_id, hc_book_id)
  );
  CREATE INDEX list_books_status ON list_books(status);

  -- Snapshot of the Audiobookshelf library, refreshed on sync.
  CREATE TABLE abs_items (
    id             TEXT PRIMARY KEY,
    library_id     TEXT NOT NULL,
    title          TEXT NOT NULL,
    subtitle       TEXT,
    authors        TEXT NOT NULL DEFAULT '[]',
    narrators      TEXT NOT NULL DEFAULT '[]',
    series         TEXT NOT NULL DEFAULT '[]',
    asin           TEXT,
    isbn           TEXT,
    duration       REAL,
    published_year INTEGER,
    updated_at     INTEGER,
    seen_at        TEXT NOT NULL
  );
  CREATE INDEX abs_items_library ON abs_items(library_id);

  -- Hardcover books that an item's ASIN or ISBN points to.
  CREATE TABLE id_links (
    abs_item_id TEXT NOT NULL,
    hc_book_id  INTEGER NOT NULL,
    via         TEXT NOT NULL,
    PRIMARY KEY (abs_item_id, hc_book_id, via)
  );
  CREATE INDEX id_links_book ON id_links(hc_book_id);

  -- Which identifiers have already been looked up on Hardcover.
  CREATE TABLE id_lookups (
    key          TEXT PRIMARY KEY,
    looked_up_at TEXT NOT NULL
  );

  -- What Hardcover said each identifier ("asin:B0..", "isbn:978..") belongs to.
  CREATE TABLE id_cache (
    key        TEXT NOT NULL,
    hc_book_id INTEGER NOT NULL,
    via        TEXT NOT NULL,
    PRIMARY KEY (key, hc_book_id, via)
  );

  -- Your decisions: a Hardcover book is this item, or should be ignored.
  CREATE TABLE overrides (
    hc_book_id  INTEGER NOT NULL,
    library_id  TEXT NOT NULL,
    action      TEXT NOT NULL,
    abs_item_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (hc_book_id, library_id)
  );

  CREATE TABLE activity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL DEFAULT (datetime('now')),
    level   TEXT NOT NULL,
    list_id INTEGER,
    message TEXT NOT NULL
  );
  `,
  `
  -- Your decisions from the Reading side: this item is this Hardcover book, or skip it.
  CREATE TABLE item_overrides (
    abs_item_id TEXT PRIMARY KEY,
    action      TEXT NOT NULL,
    hc_book_id  INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Audiobookshelf listening progress and where it stands on Hardcover.
  CREATE TABLE reading (
    abs_item_id     TEXT PRIMARY KEY,
    library_id      TEXT NOT NULL,
    progress        REAL NOT NULL DEFAULT 0,
    current_time    REAL,
    duration        REAL,
    is_finished     INTEGER NOT NULL DEFAULT 0,
    started_at      INTEGER,
    finished_at     INTEGER,
    last_update     INTEGER,
    match_status    TEXT NOT NULL DEFAULT 'missing',
    match_source    TEXT,
    hc_book_id      INTEGER,
    hc_book         TEXT,
    score           REAL,
    reasons         TEXT NOT NULL DEFAULT '[]',
    candidates      TEXT NOT NULL DEFAULT '[]',
    searched_key    TEXT,
    searched_at     TEXT,
    hc_status       INTEGER,
    hc_progress     REAL,
    sync_status     TEXT NOT NULL DEFAULT 'none',
    sync_action     TEXT,
    synced_key      TEXT,
    synced_at       TEXT,
    seen_at         TEXT NOT NULL
  );
  `,
];

db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
let version = row?.version ?? 0;
if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
while (version < migrations.length) {
  db.exec("BEGIN");
  try {
    db.exec(migrations[version]);
    version++;
    db.prepare("UPDATE schema_version SET version = ?").run(version);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
