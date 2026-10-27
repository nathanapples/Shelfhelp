/**
 * Reading progress: Audiobookshelf listening progress sent to Hardcover.
 *
 * Matching runs the other way from collections (library item to Hardcover
 * book) but shares the same decisions. A match you make in a collection is
 * used here, and a match made here is written back for collections.
 *
 * Rules: one way only, Audiobookshelf to Hardcover, and never backward. A book
 * that's Read on Hardcover stays Read. Until the first preview is approved,
 * nothing is written to Hardcover.
 */
import { UserBookStatus, type LibraryListItem } from "@hardcover/sdk";
import { Abs, type AbsProgress } from "./abs.js";
import { db, json, tx } from "./db.js";
import { authorsOf, hardcover, searchBooks } from "./hardcover.js";
import { getItems, refreshLibrary } from "./library.js";
import { judge, scoreCandidate, type HcBook } from "./matcher.js";
import { normalizeAsin, seriesNumber } from "./normalize.js";
import { getSettings, isConfigured } from "./settings.js";
import { log } from "./activity.js";

export type MatchStatus = "matched" | "review" | "missing" | "ignored";
export type SyncStatus = "synced" | "pending" | "skipped" | "error" | "none" | "held";

export interface HcBookView {
  id: number;
  slug: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
  releaseYear: number | null;
}

export interface HcCandidate extends HcBookView {
  score: number;
  titleSim: number;
  authorSim: number | null;
  idVia: string[];
  notes: string[];
}

export interface ReadingRow {
  abs_item_id: string;
  library_id: string;
  progress: number;
  current_time: number | null;
  duration: number | null;
  is_finished: number;
  started_at: number | null;
  finished_at: number | null;
  last_update: number | null;
  match_status: MatchStatus;
  match_source: string | null;
  hc_book_id: number | null;
  hc_book: string | null;
  score: number | null;
  reasons: string;
  candidates: string;
  searched_key: string | null;
  searched_at: string | null;
  hc_status: number | null;
  hc_progress: number | null;
  sync_status: SyncStatus;
  sync_action: string | null;
  synced_key: string | null;
  synced_at: string | null;
  seen_at: string;
}

export const STATUS_NAMES: Record<number, string> = {
  1: "Want to Read",
  2: "Currently Reading",
  3: "Read",
  4: "Paused",
  5: "Did Not Finish",
  6: "Ignored",
};

let running = false;
export const readingRunning = () => running;

const SEARCH_AGAIN_MS = 7 * 24 * 3600_000;

/** Pull progress, match, then work out (and with auto-send, send) changes. */
export async function syncReading(reason: string) {
  const settings = getSettings();
  if (running || !settings.readingEnabled) return;
  if (!isConfigured().hardcover || !isConfigured().abs) return;
  running = true;
  try {
    const progress = await new Abs().myProgress();
    const libraries = await new Abs().selectedLibraries();
    const allowed = new Set(libraries.map((l) => l.id));
    for (const lib of libraries) await refreshLibrary(lib.id);
    const items = getItems([...new Set(progress.map((p) => p.libraryItemId))]);
    const now = new Date().toISOString();

    for (const p of progress) {
      const item = items.get(p.libraryItemId);
      // Podcasts, items that are gone, and libraries you haven't chosen.
      if (!item || !allowed.has(item.libraryId)) continue;
      upsertProgress(p, item.libraryId, now);
    }
    // Forget books whose progress is gone, but keep rows from libraries you've
    // turned off so their history and decisions are there if you turn them back on.
    const stale = db.prepare("SELECT abs_item_id, library_id FROM reading WHERE seen_at <> ?").all(now) as { abs_item_id: string; library_id: string }[];
    for (const r of stale) if (allowed.has(r.library_id)) db.prepare("DELETE FROM reading WHERE abs_item_id = ?").run(r.abs_item_id);

    await matchAll();
    await fillBookDetails();
    const summary = await plan(settings.readingAutoSend);
    log("info", `Reading progress (${reason}): ${summary}`);
  } catch (err) {
    log("error", `Reading progress sync failed: ${(err as Error).message}`);
    throw err;
  } finally {
    running = false;
  }
}

function upsertProgress(p: AbsProgress, libraryId: string, now: string) {
  const progress = p.isFinished ? 1 : Math.max(p.progress || 0, p.ebookProgress || 0);
  db.prepare(
    `INSERT INTO reading (abs_item_id, library_id, progress, current_time, duration, is_finished, started_at, finished_at, last_update, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(abs_item_id) DO UPDATE SET library_id = excluded.library_id, progress = excluded.progress,
       current_time = excluded.current_time, duration = excluded.duration, is_finished = excluded.is_finished,
       started_at = excluded.started_at, finished_at = excluded.finished_at, last_update = excluded.last_update,
       seen_at = excluded.seen_at`,
  ).run(
    p.libraryItemId, libraryId, progress, p.currentTime ?? null, p.duration ?? null, p.isFinished ? 1 : 0,
    p.startedAt ?? null, p.finishedAt ?? null, p.lastUpdate ?? null, now,
  );
}

/** Rows from the libraries you've chosen in Settings. */
function rows(): ReadingRow[] {
  const chosen = getSettings().absLibraries;
  const all = db.prepare("SELECT * FROM reading").all() as unknown as ReadingRow[];
  return chosen.length ? all.filter((r) => chosen.includes(r.library_id)) : all;
}

/** Finds the Hardcover book for every item with progress. */
async function matchAll() {
  const all = rows().filter((r) => r.progress > 0 || r.is_finished);
  const items = getItems(all.map((r) => r.abs_item_id));
  const strictness = getSettings().matchStrictness;

  for (const row of all) {
    const item = items.get(row.abs_item_id);
    if (!item) continue;
    const decided = decidedMatch(row.abs_item_id, row.library_id);
    if (decided) {
      saveMatch(row.abs_item_id, decided);
      continue;
    }

    // Keep an earlier automatic result while the item's metadata is unchanged.
    const key = `${item.title}|${item.authors.join(",")}|${item.asin ?? ""}|${item.isbn ?? ""}|${strictness}|rules2`;
    const fresh = row.searched_key === key && row.searched_at && Date.now() - Date.parse(row.searched_at) < SEARCH_AGAIN_MS;
    if (fresh && row.match_source === "auto") continue;

    const candidates = await findCandidates(item);
    const ranked = candidates
      .map((c) => ({ c, s: scoreCandidate(toHcBook(c), item, c.idVia) }))
      .map(({ c, s }) => ({ ...c, score: s.score, titleSim: s.titleSim, authorSim: s.authorSim, notes: s.notes }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const { status, reasons } = judge(ranked, strictness, "on Hardcover");
    const best = ranked[0];
    db.prepare(
      `UPDATE reading SET match_status = ?, match_source = 'auto', hc_book_id = ?, hc_book = ?, score = ?, reasons = ?,
       candidates = ?, searched_key = ?, searched_at = datetime('now') WHERE abs_item_id = ?`,
    ).run(
      status, status === "missing" ? null : (best?.id ?? null), best && status !== "missing" ? JSON.stringify(view(best)) : null,
      best?.score ?? 0, JSON.stringify(reasons), JSON.stringify(ranked), key, row.abs_item_id,
    );
  }
}

/** Looks up Hardcover details for matched books that don't have them yet. */
async function fillBookDetails() {
  const missing = db.prepare("SELECT abs_item_id, hc_book_id FROM reading WHERE hc_book_id IS NOT NULL AND hc_book IS NULL").all() as {
    abs_item_id: string;
    hc_book_id: number;
  }[];
  if (!missing.length) return;
  const books = await hardcover().books.getMany([...new Set(missing.map((m) => m.hc_book_id))]);
  const byId = new Map(books.map((b) => [b.id, b]));
  for (const m of missing) {
    const b = byId.get(m.hc_book_id);
    if (!b) continue;
    const fs = b.cachedFeaturedSeries && "series" in b.cachedFeaturedSeries ? b.cachedFeaturedSeries : null;
    rememberBook(m.abs_item_id, {
      id: b.id, slug: b.slug ?? null, title: b.title ?? "Untitled", authors: authorsOf(b.cachedContributors),
      coverUrl: b.cachedImage?.url ?? null, seriesName: fs?.series?.name ?? null,
      seriesPosition: seriesNumber(fs?.position ?? null), releaseYear: b.releaseYear ?? null,
    });
  }
}

interface Decided {
  status: MatchStatus;
  source: string;
  hcBookId: number | null;
  reason: string;
}

/**
 * A match someone already settled: on the Reading side, or in a collection
 * (by hand or confidently by the matcher).
 */
function decidedMatch(itemId: string, libraryId: string): Decided | null {
  const own = db.prepare("SELECT action, hc_book_id FROM item_overrides WHERE abs_item_id = ?").get(itemId) as
    | { action: string; hc_book_id: number | null }
    | undefined;
  if (own?.action === "match" && own.hc_book_id) return { status: "matched", source: "manual", hcBookId: own.hc_book_id, reason: "matched by you" };
  if (own?.action === "ignore") return { status: "ignored", source: "manual", hcBookId: null, reason: "ignored by you" };
  if (own?.action === "missing") return { status: "missing", source: "manual", hcBookId: null, reason: "marked not on Hardcover by you" };

  const fromCollection = db
    .prepare("SELECT hc_book_id FROM overrides WHERE abs_item_id = ? AND library_id = ? AND action = 'match'")
    .get(itemId, libraryId) as { hc_book_id: number } | undefined;
  if (fromCollection) return { status: "matched", source: "manual", hcBookId: fromCollection.hc_book_id, reason: "matched by you in a collection" };

  const listed = db
    .prepare(
      `SELECT b.hc_book_id FROM list_books b JOIN lists l ON l.id = b.list_id
       WHERE b.abs_item_id = ? AND l.abs_library_id = ? AND b.status = 'matched' LIMIT 1`,
    )
    .get(itemId, libraryId) as { hc_book_id: number } | undefined;
  if (listed) return { status: "matched", source: "collection", hcBookId: listed.hc_book_id, reason: "matched in one of your collections" };
  return null;
}

function saveMatch(itemId: string, d: Decided) {
  const current = db.prepare("SELECT hc_book_id, hc_book FROM reading WHERE abs_item_id = ?").get(itemId) as
    | { hc_book_id: number | null; hc_book: string | null }
    | undefined;
  let keepBook = current?.hc_book_id === d.hcBookId ? current?.hc_book : null;
  if (!keepBook && d.hcBookId) {
    // A collection already has this book's details.
    const lb = db
      .prepare("SELECT hc_book_id, slug, title, authors, cover_url, series_name, series_position, release_year FROM list_books WHERE hc_book_id = ? LIMIT 1")
      .get(d.hcBookId) as Record<string, unknown> | undefined;
    if (lb) {
      keepBook = JSON.stringify({
        id: lb.hc_book_id, slug: lb.slug, title: lb.title, authors: json<string[]>(lb.authors as string, []), coverUrl: lb.cover_url,
        seriesName: lb.series_name, seriesPosition: lb.series_position, releaseYear: lb.release_year,
      });
    }
  }
  db.prepare(
    `UPDATE reading SET match_status = ?, match_source = ?, hc_book_id = ?, hc_book = ?, reasons = ?, score = NULL WHERE abs_item_id = ?`,
  ).run(d.status, d.source, d.hcBookId, keepBook, JSON.stringify([d.reason]), itemId);
}

type Candidate = HcBookView & { idVia: string[] };

/** Hardcover books this item might be: by its ASIN/ISBN, then by searching. */
async function findCandidates(item: { id: string; title: string; authors: string[]; asin?: string | null }): Promise<Candidate[]> {
  const linked = db.prepare("SELECT hc_book_id, via FROM id_links WHERE abs_item_id = ?").all(item.id) as { hc_book_id: number; via: string }[];
  const byId = new Map<number, string[]>();
  for (const l of linked) byId.set(l.hc_book_id, [...(byId.get(l.hc_book_id) ?? []), l.via]);

  const out = new Map<number, Candidate>();
  if (byId.size) {
    const books = await hardcover().books.getMany([...byId.keys()]);
    for (const b of books) {
      const fs = b.cachedFeaturedSeries && "series" in b.cachedFeaturedSeries ? b.cachedFeaturedSeries : null;
      out.set(b.id, {
        id: b.id,
        slug: b.slug ?? null,
        title: b.title ?? "Untitled",
        authors: authorsOf(b.cachedContributors),
        coverUrl: b.cachedImage?.url ?? null,
        seriesName: fs?.series?.name ?? null,
        seriesPosition: seriesNumber(fs?.position ?? null),
        releaseYear: b.releaseYear ?? null,
        idVia: byId.get(b.id) ?? [],
      });
    }
  }

  const query = `${item.title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")} ${item.authors[0] ?? ""}`.replace(/\s+/g, " ").trim();
  try {
    for (const h of await searchBooks(query, 8)) {
      if (out.has(h.id)) continue;
      out.set(h.id, {
        id: h.id,
        slug: h.slug,
        title: h.title,
        authors: h.authors,
        coverUrl: h.coverUrl,
        seriesName: h.seriesName,
        seriesPosition: h.seriesPosition,
        releaseYear: h.releaseYear,
        idVia: [],
      });
    }
  } catch (err) {
    log("warn", `Hardcover search failed for "${item.title}": ${(err as Error).message}`);
  }
  return [...out.values()];
}

function toHcBook(c: Candidate): HcBook {
  return { id: c.id, title: c.title, authors: c.authors, seriesName: c.seriesName, seriesPosition: c.seriesPosition };
}

function view(c: HcBookView): HcBookView {
  return {
    id: c.id, slug: c.slug, title: c.title, authors: c.authors, coverUrl: c.coverUrl,
    seriesName: c.seriesName, seriesPosition: c.seriesPosition, releaseYear: c.releaseYear,
  };
}

// ---------------------------------------------------------------------------
// Sending to Hardcover

type Entry = LibraryListItem;

export interface Plan {
  kind: "add" | "status" | "progress" | "skip" | "none" | "held";
  status?: number;
  description: string;
}

export interface Rules {
  minProgress: number;
  addNew: boolean;
}

function rules(): Rules {
  const s = getSettings();
  return { minProgress: s.readingMinProgress, addNew: s.readingAddNew };
}

function stateKey(r: ReadingRow) {
  return `${r.hc_book_id}|${r.is_finished}|${Math.round(r.progress * 100)}`;
}

function day(ms: number | null | undefined): string | undefined {
  if (!ms) return undefined;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: process.env.TZ || undefined });
}

function percent(r: ReadingRow) {
  return Math.min(100, Math.round(r.progress * 1000) / 10);
}

/**
 * What to do for one book. Never moves a book backward on Hardcover: Read and
 * Did Not Finish are left alone, and progress is never lowered.
 */
export function planFor(
  r: ReadingRow,
  entry: Entry | undefined,
  rule: Rules = { minProgress: 5, addNew: true },
): Plan {
  const status = entry?.statusId ?? null;
  const pct = percent(r);
  if (!r.is_finished && pct < rule.minProgress) return { kind: "held", description: `Under ${rule.minProgress}% listened` };
  if (!entry && !rule.addNew) return { kind: "held", description: "Not on your Hardcover shelves (adding new books is off)" };

  if (r.is_finished) {
    const when = day(r.finished_at) ?? day(r.last_update);
    if (status === UserBookStatus.Read) return { kind: "skip", description: "Already Read on Hardcover" };
    if (!entry) return { kind: "add", status: UserBookStatus.Read, description: `Add as Read${when ? ` (finished ${when})` : ""}` };
    return { kind: "status", status: UserBookStatus.Read, description: `${STATUS_NAMES[status!] ?? "Unknown"} → Read${when ? ` (finished ${when})` : ""}` };
  }
  if (status === UserBookStatus.Read) return { kind: "skip", description: "Already Read on Hardcover; a re-listen isn't synced" };
  if (status === UserBookStatus.DidNotFinish) return { kind: "skip", description: "Marked Did Not Finish on Hardcover" };
  if (!entry) return { kind: "add", status: UserBookStatus.CurrentlyReading, description: `Add as Currently Reading at ${pct}%` };
  if (status !== UserBookStatus.CurrentlyReading) {
    return { kind: "status", status: UserBookStatus.CurrentlyReading, description: `${STATUS_NAMES[status!] ?? "Unknown"} → Currently Reading at ${pct}%` };
  }
  const current = currentProgress(entry);
  if (current !== null && current >= pct - 0.5) {
    return { kind: "none", description: current > pct + 1 ? `Hardcover is further along (${current}%), left as is` : `Currently Reading at ${pct}%` };
  }
  return { kind: "progress", description: `Progress ${current ?? 0}% → ${pct}%` };
}

function openRead(entry: Entry) {
  const reads = (entry as unknown as { userBookReads?: { id: number; startedAt: string | null; finishedAt: string | null; progress: number | null }[] })
    .userBookReads;
  return reads?.find((x) => x.startedAt && !x.finishedAt) ?? null;
}

function readIds(entry: Entry | undefined): number[] {
  const reads = (entry as unknown as { userBookReads?: { id: number }[] } | undefined)?.userBookReads ?? [];
  return reads.map((r) => r.id);
}

function currentProgress(entry: Entry): number | null {
  const open = openRead(entry);
  return open?.progress != null ? Math.round(open.progress * 10) / 10 : null;
}

/** Your whole Hardcover library, by book id. Paged, about one request per 100 books. */
async function hardcoverLibrary(): Promise<Map<number, Entry>> {
  const hc = hardcover();
  const out = new Map<number, Entry>();
  for (let offset = 0; ; offset += 100) {
    const page = await hc.library.list({ limit: 100, offset });
    for (const e of page.items) out.set(e.bookId, e);
    if (page.items.length < page.limit) break;
  }
  const now = new Date().toISOString();
  tx(() => {
    db.prepare("DELETE FROM hc_library").run();
    const ins = db.prepare("INSERT INTO hc_library (book_id, entry_id, status, progress, refreshed_at) VALUES (?, ?, ?, ?, ?)");
    for (const e of out.values()) ins.run(e.bookId, e.id, e.statusId, currentProgress(e), now);
  });
  return out;
}

/** What's on your Hardcover shelves for these books, from the last sync. */
export function myShelfStatus(bookIds: number[]): Map<number, { status: number; statusName: string; progress: number | null }> {
  if (!bookIds.length) return new Map();
  const rows = db
    .prepare(`SELECT book_id, status, progress FROM hc_library WHERE book_id IN (${bookIds.map(() => "?").join(",")})`)
    .all(...bookIds) as { book_id: number; status: number; progress: number | null }[];
  return new Map(rows.map((r) => [r.book_id, { status: r.status, statusName: STATUS_NAMES[r.status] ?? "On a shelf", progress: r.progress }]));
}

/**
 * Works out what each matched book needs. With auto-send on, sends it;
 * otherwise every change waits as "pending" until you send it.
 */
async function plan(autoSend: boolean): Promise<string> {
  db.prepare("UPDATE reading SET sync_status = 'none', sync_action = NULL WHERE match_status <> 'matched'").run();
  const matched = rows().filter((r) => r.match_status === "matched" && r.hc_book_id);
  const rule = rules();
  // Books that changed in Audiobookshelf, plus anything still waiting or held back.
  const todo = matched.filter(
    (r) => r.synced_key !== stateKey(r) || ["pending", "error", "held", "none"].includes(r.sync_status),
  );
  // Always refreshed, so the page shows your current Hardcover shelves.
  const library = await hardcoverLibrary();
  if (!todo.length) return `${matched.length} matched, nothing new`;
  let pending = 0;
  let held = 0;
  for (const r of todo) {
    const entry = library.get(r.hc_book_id!);
    const p = planFor(r, entry, rule);
    const hcStatus = entry?.statusId ?? null;
    const hcProgress = entry ? currentProgress(entry) : null;
    if (p.kind === "skip" || p.kind === "none") mark(r, p.kind === "skip" ? "skipped" : "synced", p.description, hcStatus, hcProgress, true);
    else if (p.kind === "held") {
      mark(r, "held", p.description, hcStatus, hcProgress, false);
      held++;
    } else {
      mark(r, "pending", p.description, hcStatus, hcProgress, false);
      pending++;
    }
  }
  if (autoSend && pending) {
    const result = await send(null, library);
    return `${result.sent} sent automatically${result.failed ? `, ${result.failed} failed` : ""}${held ? `, ${held} held back` : ""}`;
  }
  return `${pending} change${pending === 1 ? "" : "s"} waiting for you${held ? `, ${held} held back` : ""}`;
}

/**
 * Sends waiting changes: the ones listed, or all of them. Each is planned
 * again first; if Hardcover changed since you looked, it isn't sent and goes
 * back to waiting with the new plan.
 */
export async function send(ids: string[] | null, library?: Map<number, Entry>) {
  const hc = hardcover();
  const waiting = rows().filter((r) => r.match_status === "matched" && r.sync_status === "pending" && (!ids || ids.includes(r.abs_item_id)));
  if (!waiting.length) return { sent: 0, failed: 0, changed: 0 };
  const lib = library ?? (await hardcoverLibrary());
  const rule = rules();
  const items = getItems(waiting.map((r) => r.abs_item_id));
  let sent = 0;
  let failed = 0;
  let changed = 0;
  for (const r of waiting) {
    const entry = lib.get(r.hc_book_id!);
    const p = planFor(r, entry, rule);
    if (p.description !== r.sync_action || p.kind === "skip" || p.kind === "none" || p.kind === "held") {
      mark(r, p.kind === "skip" ? "skipped" : p.kind === "none" ? "synced" : p.kind === "held" ? "held" : "pending", p.description, entry?.statusId ?? null, entry ? currentProgress(entry) : null, p.kind === "skip" || p.kind === "none");
      changed++;
      continue;
    }
    const title = items.get(r.abs_item_id)?.title ?? json<HcBookView | null>(r.hc_book, null)?.title ?? "Unknown";
    try {
      const entryId = await push(hc, r, p, entry, items.get(r.abs_item_id)?.asin ?? null);
      db.prepare(
        `INSERT INTO reading_history (abs_item_id, hc_book_id, title, description, kind, entry_id, created_entry, prev_status, prev_progress, prev_read_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.abs_item_id, r.hc_book_id!, title, p.description, p.kind, entryId ?? null, p.kind === "add" ? 1 : 0,
        entry?.statusId ?? null, entry ? currentProgress(entry) : null, JSON.stringify(readIds(entry)),
      );
      mark(r, "synced", p.description, p.status ?? entry?.statusId ?? null, r.is_finished ? 100 : percent(r), true);
      sent++;
    } catch (err) {
      mark(r, "error", `${p.description}: ${(err as Error).message}`, entry?.statusId ?? null, entry ? currentProgress(entry) : null, false);
      failed++;
    }
  }
  log("info", `Sent ${sent} reading change${sent === 1 ? "" : "s"} to Hardcover${failed ? `, ${failed} failed` : ""}${changed ? `, ${changed} changed since you looked and went back to waiting` : ""}`);
  return { sent, failed, changed };
}

/** Leaves one change unsent. It comes back only if your progress changes. */
export function skipChange(itemId: string) {
  const r = db.prepare("SELECT * FROM reading WHERE abs_item_id = ?").get(itemId) as ReadingRow | undefined;
  if (!r || r.sync_status !== "pending") return;
  mark(r, "skipped", `Skipped by you: ${r.sync_action}`, r.hc_status, r.hc_progress, true);
}

function mark(r: ReadingRow, status: SyncStatus, action: string, hcStatus: number | null, hcProgress: number | null, done: boolean) {
  db.prepare(
    `UPDATE reading SET sync_status = ?, sync_action = ?, hc_status = ?, hc_progress = ?,
       synced_key = CASE WHEN ? THEN ? ELSE synced_key END, synced_at = CASE WHEN ? THEN datetime('now') ELSE synced_at END
     WHERE abs_item_id = ?`,
  ).run(status, action, hcStatus, hcProgress, done ? 1 : 0, stateKey(r), done ? 1 : 0, r.abs_item_id);
}

/** The audiobook edition to record: the one with this ASIN, else the most-read audio edition. */
async function audioEdition(bookId: number, asin: string | null): Promise<number | undefined> {
  const page = await hardcover().books.editions(bookId, { limit: 50 });
  const audio = page.items.filter((e) => e.readingFormatId === 2);
  const want = normalizeAsin(asin);
  const exact = want ? audio.find((e) => normalizeAsin(e.asin) === want) : undefined;
  return (exact ?? audio.find((e) => e.audioSeconds) ?? audio[0])?.id;
}

async function push(hc: ReturnType<typeof hardcover>, r: ReadingRow, plan: Plan, entry: Entry | undefined, asin: string | null) {
  const bookId = r.hc_book_id!;
  const started = day(r.started_at);
  const finished = day(r.finished_at) ?? day(r.last_update);
  let entryId = entry?.id;
  const needsEdition = !entry?.editionId;
  const editionId = needsEdition && (plan.kind === "add" || plan.kind === "status") ? await audioEdition(bookId, asin) : undefined;

  if (plan.kind === "add") {
    const created = await hc.library.add(bookId, {
      status: plan.status as 1,
      ...(editionId ? { editionId } : {}),
      ...(started ? { startDate: started } : {}),
      ...(plan.status === UserBookStatus.Read && finished ? { date: finished } : {}),
    });
    entryId = created.id;
  } else if (plan.kind === "status") {
    await hc.library.update(entryId!, {
      status: plan.status as 1,
      ...(editionId ? { editionId } : {}),
      ...(plan.status === UserBookStatus.Read && finished ? { date: finished } : {}),
      ...(plan.status === UserBookStatus.CurrentlyReading && started ? { startDate: started } : {}),
    });
  }

  if (!r.is_finished && entryId) {
    try {
      await hc.reads.setProgress(entryId, { percent: percent(r) });
    } catch (err) {
      // Status went through; the edition may have no length to work percent out from.
      log("warn", `Progress for "${json<HcBookView | null>(r.hc_book, null)?.title ?? bookId}" not sent: ${(err as Error).message}`);
    }
  }
  if (getSettings().readingMarkOwned && editionId) {
    await hc.library.markOwned(editionId).catch((err: Error) => log("warn", `Couldn't mark as owned: ${err.message}`));
  }
  return entryId;
}

// ---------------------------------------------------------------------------
// History and undo

export function history() {
  return db.prepare("SELECT * FROM reading_history ORDER BY id DESC LIMIT 500").all() as Record<string, unknown>[];
}

/**
 * Puts Hardcover back the way it was before one change. A book Shelfhelp
 * added is removed; a status change is reverted and the reading session it
 * started is deleted; a progress update goes back to the old percent.
 */
export async function undo(id: number) {
  const h = db.prepare("SELECT * FROM reading_history WHERE id = ?").get(id) as
    | {
        id: number; abs_item_id: string; hc_book_id: number; title: string; kind: string; entry_id: number | null;
        created_entry: number; prev_status: number | null; prev_progress: number | null; prev_read_ids: string | null; undone_at: string | null;
      }
    | undefined;
  if (!h) throw new Error("That change wasn't found.");
  if (h.undone_at) throw new Error("That change was already undone.");
  const hc = hardcover();
  const entry = h.entry_id ? await hc.library.get(h.entry_id) : await hc.library.forBook(h.hc_book_id);
  if (!entry) throw new Error(`"${h.title}" isn't in your Hardcover library anymore.`);
  let note: string;

  if (h.created_entry) {
    await hc.library.remove(entry.id);
    note = "Removed from your Hardcover library";
  } else if (h.kind === "status" && h.prev_status) {
    await hc.library.setStatus(entry.id, h.prev_status as 1);
    const before = h.prev_read_ids ? json<number[]>(h.prev_read_ids, []) : null;
    let removed = 0;
    if (before) {
      for (const read of await hc.reads.list(entry.id)) {
        if (!before.includes(read.id)) {
          await hc.reads.delete(read.id);
          removed++;
        }
      }
    }
    note = `Set back to ${STATUS_NAMES[h.prev_status] ?? "its old status"}${removed ? " and removed the reading session it started" : ""}`;
  } else if (h.kind === "progress") {
    await hc.reads.setProgress(entry.id, { percent: h.prev_progress ?? 0 });
    note = `Progress set back to ${h.prev_progress ?? 0}%`;
  } else {
    throw new Error("This change can't be undone automatically.");
  }

  db.prepare("UPDATE reading_history SET undone_at = datetime('now'), undo_note = ? WHERE id = ?").run(note, h.id);
  // Keep it from being sent again until your progress changes.
  const r = db.prepare("SELECT * FROM reading WHERE abs_item_id = ?").get(h.abs_item_id) as ReadingRow | undefined;
  if (r) mark(r, "skipped", `Undone by you. ${note}`, h.created_entry ? null : h.prev_status, h.prev_progress, true);
  log("info", `Undid "${h.title}": ${note}`);
  return note;
}

/**
 * Changes sent before history existed, rebuilt from what was recorded on the
 * book, so they can still be undone.
 */
export function backfillHistory() {
  const done = db.prepare("SELECT value FROM settings WHERE key = '_historyBackfilled'").get();
  if (done) return;
  const synced = db.prepare("SELECT * FROM reading WHERE sync_status = 'synced' AND sync_action IS NOT NULL").all() as unknown as ReadingRow[];
  const items = getItems(synced.map((r) => r.abs_item_id));
  const byName = Object.fromEntries(Object.entries(STATUS_NAMES).map(([k, v]) => [v, Number(k)]));
  for (const r of synced) {
    const a = r.sync_action!;
    let kind: string | null = null;
    let prevStatus: number | null = null;
    let prevProgress: number | null = null;
    if (a.startsWith("Add as")) kind = "add";
    else if (a.includes(" → ") && !a.startsWith("Progress")) {
      kind = "status";
      prevStatus = byName[a.split(" → ")[0]] ?? null;
    } else if (a.startsWith("Progress")) {
      kind = "progress";
      prevProgress = Number(a.match(/Progress ([\d.]+)%/)?.[1] ?? 0);
    }
    if (!kind || !r.hc_book_id) continue;
    db.prepare(
      `INSERT INTO reading_history (ts, abs_item_id, hc_book_id, title, description, kind, created_entry, prev_status, prev_progress)
       VALUES (COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.synced_at, r.abs_item_id, r.hc_book_id, items.get(r.abs_item_id)?.title ?? "Unknown", a, kind, kind === "add" ? 1 : 0, prevStatus, prevProgress);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('_historyBackfilled', 'true')").run();
}

// ---------------------------------------------------------------------------
// Decisions and views

export function decideItem(itemId: string, action: "match" | "ignore" | "missing" | "reset", hcBookId?: number) {
  const row = db.prepare("SELECT library_id FROM reading WHERE abs_item_id = ?").get(itemId) as { library_id: string } | undefined;
  tx(() => {
    if (action === "reset") {
      db.prepare("DELETE FROM item_overrides WHERE abs_item_id = ?").run(itemId);
      db.prepare("DELETE FROM overrides WHERE abs_item_id = ? AND action = 'match'").run(itemId);
      db.prepare("UPDATE reading SET searched_key = NULL, match_source = NULL WHERE abs_item_id = ?").run(itemId);
    } else {
      if (action === "match" && !hcBookId) throw new Error("Pick a Hardcover book to match.");
      db.prepare(
        `INSERT INTO item_overrides (abs_item_id, action, hc_book_id) VALUES (?, ?, ?)
         ON CONFLICT(abs_item_id) DO UPDATE SET action = excluded.action, hc_book_id = excluded.hc_book_id, created_at = datetime('now')`,
      ).run(itemId, action, action === "match" ? hcBookId! : null);
    }
  });
  return row?.library_id ?? null;
}

/** Stores a picked book's details so the card can show it before the next sync. */
export function rememberBook(itemId: string, book: HcBookView | null) {
  if (book) db.prepare("UPDATE reading SET hc_book = ? WHERE abs_item_id = ?").run(JSON.stringify(view(book)), itemId);
}

export function readingView() {
  const all = rows().filter((r) => r.progress > 0 || r.is_finished);
  const items = getItems(all.map((r) => r.abs_item_id));
  const ids = new Set<number>();
  for (const r of all) {
    if (r.hc_book_id) ids.add(r.hc_book_id);
    for (const c of json<HcCandidate[]>(r.candidates, [])) ids.add(c.id);
  }
  const shelves = myShelfStatus([...ids]);
  const books = all
    .map((r) => {
      const item = items.get(r.abs_item_id);
      return {
        absItemId: r.abs_item_id,
        libraryId: r.library_id,
        title: item?.title ?? "Unknown",
        subtitle: item?.subtitle ?? null,
        authors: item?.authors ?? [],
        narrators: item?.narrators ?? [],
        series: item?.series ?? [],
        asin: item?.asin ?? null,
        isbn: item?.isbn ?? null,
        coverUrl: `/api/abs/cover/${r.abs_item_id}`,
        progress: percent(r),
        isFinished: !!r.is_finished,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        lastUpdate: r.last_update,
        duration: r.duration,
        matchStatus: r.match_status,
        matchSource: r.match_source,
        hcBookId: r.hc_book_id,
        hcBook: json<HcBookView | null>(r.hc_book, null),
        score: r.score,
        reasons: json<string[]>(r.reasons, []),
        candidates: json<HcCandidate[]>(r.candidates, []).map((c) => ({ ...c, mine: shelves.get(c.id) ?? null })),
        mine: r.hc_book_id ? (shelves.get(r.hc_book_id) ?? null) : null,
        heldReason: r.sync_status === "held" ? (r.sync_action?.startsWith("Under ") ? "threshold" : "shelves") : null,
        hcStatus: r.hc_status,
        hcStatusName: r.hc_status ? STATUS_NAMES[r.hc_status] : null,
        hcProgress: r.hc_progress,
        syncStatus: r.sync_status,
        syncAction: r.sync_action,
        syncedAt: r.synced_at,
      };
    })
    .sort((a, b) => (b.lastUpdate ?? 0) - (a.lastUpdate ?? 0));

  const count = (f: (b: (typeof books)[number]) => boolean) => books.filter(f).length;
  return {
    enabled: getSettings().readingEnabled,
    autoSend: getSettings().readingAutoSend,
    minProgress: getSettings().readingMinProgress,
    running,
    counts: {
      total: books.length,
      listening: count((b) => !b.isFinished),
      finished: count((b) => b.isFinished),
      matched: count((b) => b.matchStatus === "matched"),
      review: count((b) => b.matchStatus === "review"),
      missing: count((b) => b.matchStatus === "missing"),
      ignored: count((b) => b.matchStatus === "ignored"),
      synced: count((b) => b.matchStatus === "matched" && b.syncStatus === "synced"),
      pending: count((b) => b.matchStatus === "matched" && b.syncStatus === "pending"),
      skipped: count((b) => b.matchStatus === "matched" && b.syncStatus === "skipped"),
      errors: count((b) => b.matchStatus === "matched" && b.syncStatus === "error"),
      held: count((b) => b.matchStatus === "matched" && b.syncStatus === "held"),
    },
    books,
  };
}
