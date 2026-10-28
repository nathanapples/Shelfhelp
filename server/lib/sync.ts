import { Abs } from "./abs.js";
import { db, json, tx } from "./db.js";
import { fetchSource, type ListBook } from "./hardcover.js";
import { requestSource } from "./requests.js";
import { idLinks, libraryIndex, refreshLibrary, rejectedPairs } from "./library.js";
import { matchBook, type Candidate } from "./matcher.js";
import { getSettings, isConfigured } from "./settings.js";
import { log } from "./activity.js";
import { finishJob, startJob, step } from "./progress.js";

export interface ListRow {
  id: number;
  source_type: string;
  hc_list_id: number;
  hc_slug: string | null;
  hc_owner: string | null;
  name: string;
  description: string | null;
  abs_library_id: string;
  abs_collection_id: string | null;
  collection_name: string;
  remove_missing: number;
  keep_order: number;
  enabled: number;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
}

export type BookStatus = "matched" | "review" | "missing" | "ignored";

const running = new Set<number>();
export const isRunning = (listId: number) => running.has(listId);
export const runningLists = () => [...running];

export function getList(id: number): ListRow | undefined {
  return db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as ListRow | undefined;
}

interface Override {
  action: "match" | "ignore" | "missing";
  abs_item_id: string | null;
}

function overridesFor(libraryId: string): Map<number, Override> {
  const rows = db.prepare("SELECT hc_book_id, action, abs_item_id FROM overrides WHERE library_id = ?").all(libraryId) as unknown as (Override & {
    hc_book_id: number;
  })[];
  return new Map(rows.map((r) => [r.hc_book_id, r]));
}

/**
 * Full sync: pull the Hardcover list and the library, match, then update the
 * collection. Books waiting for review are never added.
 */
export async function syncList(listId: number, { forceLibrary = false } = {}) {
  if (running.has(listId)) return;
  const list = getList(listId);
  if (!list) throw new Error(`List ${listId} not found`);
  running.add(listId);
  const job = `list:${listId}`;
  startJob(job, list.name);
  try {
    step(job, list.source_type === "requests" ? "Getting requests" : "Getting the list from Hardcover");
    const { info, books } = list.source_type === "requests" ? requestSource(list.hc_list_id) : await fetchSource(list.source_type, list.hc_list_id);
    await refreshLibrary(list.abs_library_id, { force: forceLibrary, job });
    step(job, `Matching ${books.length} books`);
    rematch(list, books);
    step(job, "Updating the Audiobookshelf collection");
    db.prepare("UPDATE lists SET name = ?, hc_slug = ?, description = ?, hc_owner = COALESCE(?, hc_owner) WHERE id = ?").run(
      info.name, info.slug, info.description, info.owner, listId,
    );
    const summary = await pushCollection(listId);
    db.prepare("UPDATE lists SET last_synced_at = datetime('now'), last_status = 'ok', last_error = NULL WHERE id = ?").run(listId);
    log("info", `Synced "${info.name}": ${summary}`, listId);
    finishJob(job, true, summary);
  } catch (err) {
    const message = (err as Error).message;
    db.prepare("UPDATE lists SET last_synced_at = datetime('now'), last_status = 'error', last_error = ? WHERE id = ?").run(message, listId);
    log("error", `Sync failed: ${message}`, listId);
    finishJob(job, false, message);
    throw err;
  } finally {
    running.delete(listId);
  }
}

/** Matches a list's books against the library snapshot and stores the results. */
export function rematch(list: ListRow, books?: ListBook[]) {
  const libraryId = list.abs_library_id;
  const source: ListBook[] =
    books ??
    (db.prepare("SELECT * FROM list_books WHERE list_id = ? ORDER BY position").all(list.id) as Record<string, unknown>[]).map(
      (r) => ({
        id: r.hc_book_id as number,
        position: r.position as number,
        slug: r.slug as string | null,
        title: r.title as string,
        subtitle: r.subtitle as string | null,
        authors: json<string[]>(r.authors as string, []),
        seriesName: r.series_name as string | null,
        seriesPosition: r.series_position as number | null,
        coverUrl: r.cover_url as string | null,
        releaseYear: r.release_year as number | null,
        audioSeconds: r.audio_seconds as number | null,
      }),
    );
  const index = libraryIndex(libraryId);
  const links = idLinks(libraryId);
  const overrides = overridesFor(libraryId);
  const strictness = getSettings().matchStrictness;
  const rejected = rejectedPairs();

  tx(() => {
    db.prepare("DELETE FROM list_books WHERE list_id = ?").run(list.id);
    const ins = db.prepare(`
      INSERT INTO list_books (list_id, hc_book_id, position, slug, title, subtitle, authors, series_name, series_position,
        cover_url, release_year, audio_seconds, status, match_source, abs_item_id, score, reasons, candidates)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const b of source) {
      const result = matchBook(b, index, links, strictness, rejected);
      let status: BookStatus = result.status;
      let source_ = "auto";
      let itemId = result.absItemId;
      let reasons = result.reasons;
      const o = overrides.get(b.id);
      if (o?.action === "match" && o.abs_item_id && index.byId.has(o.abs_item_id)) {
        status = "matched";
        source_ = "manual";
        itemId = o.abs_item_id;
        reasons = ["matched by you"];
      } else if (o?.action === "ignore") {
        status = "ignored";
        source_ = "manual";
        itemId = null;
        reasons = ["ignored by you"];
      } else if (o?.action === "missing") {
        status = "missing";
        source_ = "manual";
        itemId = null;
        reasons = ["marked not in library by you"];
      }
      ins.run(
        list.id, b.id, b.position, b.slug, b.title, b.subtitle, JSON.stringify(b.authors), b.seriesName, b.seriesPosition,
        b.coverUrl, b.releaseYear, b.audioSeconds, status, source_, itemId, result.score, JSON.stringify(reasons),
        JSON.stringify(result.candidates),
      );
    }
  });
}

/** Makes the Audiobookshelf collection match the list's matched books. */
export async function pushCollection(listId: number): Promise<string> {
  const list = getList(listId)!;
  const abs = new Abs();
  const desired = (
    db.prepare("SELECT abs_item_id FROM list_books WHERE list_id = ? AND status = 'matched' AND abs_item_id IS NOT NULL ORDER BY position").all(listId) as {
      abs_item_id: string;
    }[]
  ).map((r) => r.abs_item_id);
  const unique = [...new Set(desired)];
  const counts = statusCounts(listId);
  const tail = `${counts.matched} in collection, ${counts.review} to review, ${counts.missing} not in library`;

  let collection = list.abs_collection_id ? await abs.collection(list.abs_collection_id) : null;
  // Never adopt a collection that's in another library or belongs to another synced list.
  if (collection) {
    const shared = db
      .prepare("SELECT id FROM lists WHERE abs_collection_id = ? AND id < ?")
      .get(collection.id, listId) as { id: number } | undefined;
    if (collection.libraryId !== list.abs_library_id || shared) {
      log("warn", `Collection ${collection.id} isn't this list's; making a new one`, listId);
      db.prepare("UPDATE lists SET abs_collection_id = NULL WHERE id = ?").run(listId);
      collection = null;
    }
  }
  if (!collection) {
    if (!unique.length) return `${tail} (collection not created yet: nothing matched)`;
    collection = await abs.createCollection(list.abs_library_id, list.collection_name, collectionDescription(list), unique);
    db.prepare("UPDATE lists SET abs_collection_id = ? WHERE id = ?").run(collection.id, listId);
    return `created collection "${list.collection_name}"; ${tail}`;
  }

  const current = collection.books.map((b) => b.id);
  const currentSet = new Set(current);
  const wanted = new Set(unique);
  const toAdd = unique.filter((id) => !currentSet.has(id));
  const toRemove = list.remove_missing ? current.filter((id) => !wanted.has(id)) : [];
  if (toAdd.length) await abs.addToCollection(collection.id, toAdd);
  if (toRemove.length) await abs.removeFromCollection(collection.id, toRemove);

  const patch: { name?: string; books?: string[] } = {};
  if (collection.name !== list.collection_name) patch.name = list.collection_name;
  if (list.keep_order && unique.length) {
    const extras = current.filter((id) => !wanted.has(id) && !toRemove.includes(id));
    const order = [...unique, ...extras];
    const after = [...current.filter((id) => !toRemove.includes(id)), ...toAdd];
    if (order.join() !== after.join()) patch.books = order;
  }
  if (patch.name || patch.books) await abs.updateCollection(collection.id, patch);
  const changes = [toAdd.length && `added ${toAdd.length}`, toRemove.length && `removed ${toRemove.length}`].filter(Boolean).join(", ");
  return `${changes || "no changes"}; ${tail}`;
}

export function hardcoverUrl(list: Pick<ListRow, "source_type" | "hc_owner" | "hc_slug">) {
  if (!list.hc_owner || !list.hc_slug) return null;
  return list.source_type === "hardcover_status"
    ? `https://hardcover.app/@${list.hc_owner}/books/${list.hc_slug}`
    : `https://hardcover.app/@${list.hc_owner}/lists/${list.hc_slug}`;
}

function collectionDescription(list: ListRow) {
  if (list.source_type === "requests") return "Requested in Shelfhelp.";
  const url = hardcoverUrl(list);
  const link = url ? ` ${url}` : "";
  return `Synced from Hardcover by Shelfhelp.${link}`;
}

export function statusCounts(listId: number) {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM list_books WHERE list_id = ? GROUP BY status").all(listId) as {
    status: BookStatus;
    n: number;
  }[];
  const out = { matched: 0, review: 0, missing: 0, ignored: 0, total: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.total += r.n;
  }
  return out;
}

/**
 * Records a decision about one Hardcover book in one library, applies it to
 * every list that has the book, and updates those collections.
 */
export async function decide(hcBookId: number, libraryId: string, action: "match" | "ignore" | "missing" | "reset", absItemId?: string) {
  if (action === "reset") {
    db.prepare("DELETE FROM overrides WHERE hc_book_id = ? AND library_id = ?").run(hcBookId, libraryId);
  } else {
    if (action === "match" && !absItemId) throw new Error("Pick an Audiobookshelf item to match.");
    db.prepare(
      `INSERT INTO overrides (hc_book_id, library_id, action, abs_item_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(hc_book_id, library_id) DO UPDATE SET action = excluded.action, abs_item_id = excluded.abs_item_id, created_at = datetime('now')`,
    ).run(hcBookId, libraryId, action, action === "match" ? absItemId! : null);
  }
  const lists = db
    .prepare(
      `SELECT DISTINCT l.* FROM lists l JOIN list_books b ON b.list_id = l.id WHERE b.hc_book_id = ? AND l.abs_library_id = ?`,
    )
    .all(hcBookId, libraryId) as unknown as ListRow[];
  for (const list of lists) {
    rematch(list);
    if (list.enabled) {
      try {
        await pushCollection(list.id);
      } catch (err) {
        log("error", `Couldn't update the collection: ${(err as Error).message}`, list.id);
      }
    }
  }
}

export async function syncAll(reason: string) {
  if (!isConfigured().hardcover || !isConfigured().abs) return;
  const lists = db.prepare("SELECT id FROM lists WHERE enabled = 1 ORDER BY id").all() as { id: number }[];
  if (!lists.length) return;
  log("info", `Syncing ${lists.length} list${lists.length === 1 ? "" : "s"} (${reason})`);
  const libraries = new Set<string>();
  for (const { id } of lists) {
    const list = getList(id)!;
    try {
      // Refresh each library once per run.
      await syncList(id, { forceLibrary: !libraries.has(list.abs_library_id) });
      libraries.add(list.abs_library_id);
    } catch {
      /* logged in syncList */
    }
  }
}

export type CandidateView = Candidate;
