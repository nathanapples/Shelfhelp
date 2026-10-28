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
  `
  ALTER TABLE abs_items ADD COLUMN num_audio INTEGER;

  -- Every change sent to Hardcover, so it can be undone.
  CREATE TABLE reading_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL DEFAULT (datetime('now')),
    abs_item_id   TEXT NOT NULL,
    hc_book_id    INTEGER NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    kind          TEXT NOT NULL,
    entry_id      INTEGER,
    created_entry INTEGER NOT NULL DEFAULT 0,
    prev_status   INTEGER,
    prev_progress REAL,
    prev_read_ids TEXT,
    undone_at     TEXT,
    undo_note     TEXT
  );
  `,
  `
  -- Your Hardcover shelves, refreshed on each reading sync, so the UI can show
  -- what you already have on Hardcover next to any book.
  CREATE TABLE hc_library (
    book_id      INTEGER PRIMARY KEY,
    entry_id     INTEGER NOT NULL,
    status       INTEGER NOT NULL,
    progress     REAL,
    refreshed_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE reading_history ADD COLUMN prev_dates TEXT;
  `,
  `
  -- Books requested from Chaptarr, one row per book and format.
  CREATE TABLE requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    hc_book_id       INTEGER NOT NULL,
    format           TEXT NOT NULL,
    title            TEXT NOT NULL,
    authors          TEXT,
    slug             TEXT,
    cover_url        TEXT,
    release_year     INTEGER,
    requested_by     TEXT NOT NULL DEFAULT 'admin',
    status           TEXT NOT NULL,
    message          TEXT,
    chaptarr_book_id INTEGER,
    pending_id       INTEGER,
    abs_item_id      TEXT,
    progress         REAL,
    requested_at     TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    checked_at       TEXT,
    UNIQUE (hc_book_id, format)
  );
  `,
  `
  -- When each item was added to Audiobookshelf, for "Recently added".
  ALTER TABLE abs_items ADD COLUMN added_at INTEGER;

  -- Every Audiobookshelf book linked to its Hardcover book, so Shelfhelp can
  -- tell what you already have before you request it.
  CREATE TABLE library_links (
    abs_item_id   TEXT PRIMARY KEY,
    library_id    TEXT NOT NULL,
    status        TEXT NOT NULL,
    source        TEXT,
    hc_book_id    INTEGER,
    hc_book       TEXT,
    score         REAL,
    reasons       TEXT,
    candidates    TEXT,
    searched_key  TEXT,
    searched_at   TEXT,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX library_links_book ON library_links(hc_book_id);
  `,
  `
  -- People. User 1 is the owner: the Audiobookshelf API key's user and the
  -- Hardcover token in Settings. Everything synced before users existed is theirs.
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    abs_user_id          TEXT UNIQUE,
    username             TEXT,
    email                TEXT,
    display_name         TEXT,
    role                 TEXT NOT NULL DEFAULT 'user',
    oidc_sub             TEXT UNIQUE,
    hardcover_token      TEXT,
    reading_enabled      INTEGER NOT NULL DEFAULT 1,
    reading_auto_send    INTEGER NOT NULL DEFAULT 0,
    reading_min_progress REAL NOT NULL DEFAULT 5,
    reading_mark_owned   INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at        TEXT
  );
  INSERT INTO users (id, role, display_name, reading_enabled, reading_auto_send, reading_min_progress, reading_mark_owned) VALUES (
    1, 'admin', NULL,
    COALESCE((SELECT CASE value WHEN 'false' THEN 0 ELSE 1 END FROM settings WHERE key = 'readingEnabled'), 1),
    COALESCE((SELECT CASE value WHEN 'true' THEN 1 ELSE 0 END FROM settings WHERE key = 'readingAutoSend'), 0),
    COALESCE((SELECT CAST(value AS REAL) FROM settings WHERE key = 'readingMinProgress'), 5),
    COALESCE((SELECT CASE value WHEN 'true' THEN 1 ELSE 0 END FROM settings WHERE key = 'readingMarkOwned'), 0)
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    via        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  -- Reading rows, shelves and history belong to a user.
  ALTER TABLE reading RENAME TO reading_old;
  CREATE TABLE reading (
    user_id         INTEGER NOT NULL DEFAULT 1,
    abs_item_id     TEXT NOT NULL,
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
    seen_at         TEXT NOT NULL,
    PRIMARY KEY (user_id, abs_item_id)
  );
  INSERT INTO reading (user_id, abs_item_id, library_id, progress, current_time, duration, is_finished, started_at, finished_at, last_update,
    match_status, match_source, hc_book_id, hc_book, score, reasons, candidates, searched_key, searched_at, hc_status, hc_progress,
    sync_status, sync_action, synced_key, synced_at, seen_at)
  SELECT 1, abs_item_id, library_id, progress, current_time, duration, is_finished, started_at, finished_at, last_update,
    match_status, match_source, hc_book_id, hc_book, score, reasons, candidates, searched_key, searched_at, hc_status, hc_progress,
    sync_status, sync_action, synced_key, synced_at, seen_at FROM reading_old;
  DROP TABLE reading_old;

  ALTER TABLE hc_library RENAME TO hc_library_old;
  CREATE TABLE hc_library (
    user_id      INTEGER NOT NULL DEFAULT 1,
    book_id      INTEGER NOT NULL,
    entry_id     INTEGER NOT NULL,
    status       INTEGER NOT NULL,
    progress     REAL,
    refreshed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, book_id)
  );
  INSERT INTO hc_library (user_id, book_id, entry_id, status, progress, refreshed_at)
    SELECT 1, book_id, entry_id, status, progress, refreshed_at FROM hc_library_old;
  DROP TABLE hc_library_old;

  ALTER TABLE reading_history ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

  -- Everyone who asked for a request, so each person sees their own.
  CREATE TABLE request_users (
    request_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (request_id, user_id)
  );
  INSERT INTO request_users (request_id, user_id) SELECT id, 1 FROM requests;
  `,
  `
  -- When the requester's tag was added to the book in Audiobookshelf.
  ALTER TABLE request_users ADD COLUMN tagged_at TEXT;
  ALTER TABLE request_users ADD COLUMN tag TEXT;
  `,
  `
  -- Pairs you've said are NOT the same book. Every matcher skips them.
  CREATE TABLE link_rejections (
    abs_item_id TEXT NOT NULL,
    hc_book_id  INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (abs_item_id, hc_book_id)
  );

  -- A person's own Discover rows (JSON). Empty uses the defaults.
  ALTER TABLE users ADD COLUMN discover_rows TEXT;
  `,
  `
  -- Problems people report with a book, and the conversation about them.
  CREATE TABLE issues (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    hc_book_id   INTEGER NOT NULL,
    abs_item_id  TEXT,
    title        TEXT NOT NULL,
    authors      TEXT,
    slug         TEXT,
    cover_url    TEXT,
    kind         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
    created_by   INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by  INTEGER,
    resolved_at  TEXT
  );
  CREATE INDEX issues_book ON issues(hc_book_id);
  CREATE TABLE issue_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id   INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    body       TEXT NOT NULL,
    event      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX issue_comments_issue ON issue_comments(issue_id);
  `,
  `
  -- Requesters are tagged in Chaptarr now, not in Audiobookshelf. The old
  -- tagged_at/tag columns mark Audiobookshelf tags still to be taken off.
  ALTER TABLE request_users ADD COLUMN chaptarr_tagged_at TEXT;
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
