/** The local snapshot of each Audiobookshelf library and its Hardcover ID links. */
import { Abs, type AbsItemRow } from "./abs.js";
import { db, json, tx } from "./db.js";
import { lookupIdentifiers } from "./hardcover.js";
import { LibraryIndex, type AbsItem } from "./matcher.js";
import { normalizeAsin, normalizeIsbn } from "./normalize.js";
import { log } from "./activity.js";
import { step } from "./progress.js";

const refreshedAt = new Map<string, number>();
const indexes = new Map<string, { builtAt: number; index: LibraryIndex }>();

/** Pulls the library from Audiobookshelf unless it was pulled in the last few minutes. */
export async function refreshLibrary(
  libraryId: string,
  { force = false, maxAgeMs = 5 * 60_000, job }: { force?: boolean; maxAgeMs?: number; job?: string } = {},
) {
  const last = refreshedAt.get(libraryId) ?? 0;
  if (!force && Date.now() - last < maxAgeMs) return;
  step(job, "Reading your Audiobookshelf library");
  const items = await new Abs().items(libraryId);
  step(job, `Saving ${items.length} books from Audiobookshelf`);
  const now = new Date().toISOString();
  tx(() => {
    const upsert = db.prepare(`
      INSERT INTO abs_items (id, library_id, title, subtitle, authors, narrators, series, asin, isbn, duration, published_year, updated_at, seen_at, num_audio, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        library_id = excluded.library_id, title = excluded.title, subtitle = excluded.subtitle,
        authors = excluded.authors, narrators = excluded.narrators, series = excluded.series,
        asin = excluded.asin, isbn = excluded.isbn, duration = excluded.duration,
        published_year = excluded.published_year, updated_at = excluded.updated_at, seen_at = excluded.seen_at,
        num_audio = excluded.num_audio, added_at = excluded.added_at`);
    for (const i of items) {
      upsert.run(
        i.id, i.libraryId, i.title, i.subtitle ?? null, JSON.stringify(i.authors), JSON.stringify(i.narrators),
        JSON.stringify(i.series), i.asin ?? null, i.isbn ?? null, i.duration ?? null, i.publishedYear, i.updatedAt, now, i.numAudio, i.addedAt,
      );
    }
    // Items no longer in the library.
    db.prepare("DELETE FROM abs_items WHERE library_id = ? AND seen_at <> ?").run(libraryId, now);
    db.prepare("DELETE FROM id_links WHERE abs_item_id NOT IN (SELECT id FROM abs_items)").run();
    db.prepare("DELETE FROM library_links WHERE abs_item_id NOT IN (SELECT id FROM abs_items)").run();
  });
  refreshedAt.set(libraryId, Date.now());
  indexes.delete(libraryId);
  await linkIdentifiers(libraryId, job);
}

/** Looks up any ASIN/ISBN in the library that Hardcover hasn't been asked about yet. */
async function linkIdentifiers(libraryId: string, job?: string) {
  const rows = db.prepare("SELECT id, asin, isbn FROM abs_items WHERE library_id = ?").all(libraryId) as {
    id: string;
    asin: string | null;
    isbn: string | null;
  }[];
  // Answers older than a month are asked again: Hardcover merges and fixes books.
  const cutoff = new Date(Date.now() - ID_ANSWER_MAX_AGE_MS).toISOString();
  const seen = new Set(
    (db.prepare("SELECT key FROM id_lookups WHERE looked_up_at > ?").all(cutoff) as { key: string }[]).map((r) => r.key),
  );
  const asins = new Set<string>();
  const isbns = new Set<string>();
  for (const r of rows) {
    const a = normalizeAsin(r.asin);
    const i = normalizeIsbn(r.isbn);
    if (a && !seen.has(`asin:${a}`)) asins.add(a);
    if (i && !seen.has(`isbn:${i}`)) isbns.add(i);
  }
  if (!asins.size && !isbns.size) {
    rebuildLinks(libraryId);
    return;
  }
  log("info", `Looking up ${asins.size} ASINs and ${isbns.size} ISBNs on Hardcover`);
  const found = await lookupIdentifiers([...asins], [...isbns], (done, total) =>
    step(job, "Looking up new ASINs and ISBNs on Hardcover", done, total),
  );
  const now = new Date().toISOString();
  saveAnswers([...asins].map((a) => `asin:${a}`), [...isbns].map((i) => `isbn:${i}`), found, now);
  rebuildLinks(libraryId);
}

const ID_ANSWER_MAX_AGE_MS = 30 * 24 * 3600_000;

function saveAnswers(asinKeys: string[], isbnKeys: string[], found: [string, number, string][], now: string) {
  tx(() => {
    const keys = [...asinKeys, ...isbnKeys];
    const del = db.prepare("DELETE FROM id_cache WHERE key = ?");
    for (const k of keys) del.run(k);
    const ins = db.prepare(
      "INSERT INTO id_lookups (key, looked_up_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET looked_up_at = excluded.looked_up_at",
    );
    for (const k of keys) ins.run(k, now);
    const map = db.prepare("INSERT OR IGNORE INTO id_cache (key, hc_book_id, via) VALUES (?, ?, ?)");
    for (const [key, bookId, via] of found) map.run(key, bookId, via);
  });
}

/** Asks Hardcover again what one item's ASIN and ISBN belong to. */
export async function relookupItem(itemId: string) {
  const r = db.prepare("SELECT library_id, asin, isbn FROM abs_items WHERE id = ?").get(itemId) as
    | { library_id: string; asin: string | null; isbn: string | null }
    | undefined;
  if (!r) return;
  const a = normalizeAsin(r.asin);
  const i = normalizeIsbn(r.isbn);
  if (!a && !i) return;
  const found = await lookupIdentifiers(a ? [a] : [], i ? [i] : []);
  saveAnswers(a ? [`asin:${a}`] : [], i ? [`isbn:${i}`] : [], found, new Date().toISOString());
  rebuildLinks(r.library_id);
}

/** Re-derives item -> book links from the identifier cache (cheap, local only). */
function rebuildLinks(libraryId: string) {
  tx(() => {
    db.prepare("DELETE FROM id_links WHERE abs_item_id IN (SELECT id FROM abs_items WHERE library_id = ?)").run(libraryId);
    const rows = db.prepare("SELECT id, asin, isbn FROM abs_items WHERE library_id = ?").all(libraryId) as {
      id: string;
      asin: string | null;
      isbn: string | null;
    }[];
    const get = db.prepare("SELECT hc_book_id, via FROM id_cache WHERE key = ?");
    const ins = db.prepare("INSERT OR IGNORE INTO id_links (abs_item_id, hc_book_id, via) VALUES (?, ?, ?)");
    for (const r of rows) {
      const keys = [normalizeAsin(r.asin) && `asin:${normalizeAsin(r.asin)}`, normalizeIsbn(r.isbn) && `isbn:${normalizeIsbn(r.isbn)}`];
      for (const key of keys) {
        if (!key) continue;
        for (const hit of get.all(key) as { hc_book_id: number; via: string }[]) ins.run(r.id, hit.hc_book_id, hit.via);
      }
    }
  });
}

export function libraryItems(libraryId: string): AbsItemRow[] {
  const rows = db.prepare("SELECT * FROM abs_items WHERE library_id = ?").all(libraryId) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export function rowToItem(r: Record<string, unknown>): AbsItemRow {
  return {
    id: r.id as string,
    libraryId: r.library_id as string,
    title: r.title as string,
    subtitle: (r.subtitle as string) ?? null,
    authors: json<string[]>(r.authors as string, []),
    narrators: json<string[]>(r.narrators as string, []),
    series: json<AbsItem["series"]>(r.series as string, []),
    asin: (r.asin as string) ?? null,
    isbn: (r.isbn as string) ?? null,
    duration: (r.duration as number) ?? null,
    publishedYear: (r.published_year as number) ?? null,
    updatedAt: (r.updated_at as number) ?? null,
    addedAt: (r.added_at as number) ?? null,
    numAudio: (r.num_audio as number) ?? null,
  };
}

export function libraryIndex(libraryId: string): LibraryIndex {
  const cached = indexes.get(libraryId);
  if (cached) return cached.index;
  const index = new LibraryIndex(libraryItems(libraryId));
  indexes.set(libraryId, { builtAt: Date.now(), index });
  return index;
}

/** hcBookId -> (absItemId -> [via]) for one library. */
export function idLinks(libraryId: string): Map<number, Map<string, string[]>> {
  const rows = db
    .prepare(
      `SELECT l.hc_book_id, l.abs_item_id, l.via FROM id_links l
       JOIN abs_items i ON i.id = l.abs_item_id WHERE i.library_id = ?`,
    )
    .all(libraryId) as { hc_book_id: number; abs_item_id: string; via: string }[];
  const out = new Map<number, Map<string, string[]>>();
  for (const r of rows) {
    if (!out.has(r.hc_book_id)) out.set(r.hc_book_id, new Map());
    const m = out.get(r.hc_book_id)!;
    m.set(r.abs_item_id, [...(m.get(r.abs_item_id) ?? []), r.via]);
  }
  return out;
}

export function getItems(ids: string[]) {
  if (!ids.length) return new Map<string, AbsItemRow>();
  const rows = db
    .prepare(`SELECT * FROM abs_items WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as Record<string, unknown>[];
  return new Map(rows.map((r) => [r.id as string, rowToItem(r)]));
}

/** Local search of a library snapshot, for picking a match by hand. */
export function searchLibrary(libraryId: string, q: string, limit = 30) {
  const like = `%${q.trim().replace(/[%_]/g, "")}%`;
  const rows = db
    .prepare(
      `SELECT * FROM abs_items WHERE library_id = ? AND (title LIKE ? OR authors LIKE ? OR asin LIKE ? OR isbn LIKE ? OR series LIKE ?)
       ORDER BY title LIMIT ?`,
    )
    .all(libraryId, like, like, like, like, like, limit) as Record<string, unknown>[];
  return rows.map(rowToItem);
}
