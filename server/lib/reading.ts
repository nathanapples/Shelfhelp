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
export type SyncStatus = "synced" | "pending" | "skipped" | "error" | "none";

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

/** Pull progress, match, then (once approved) send changes to Hardcover. */
export async function syncReading(reason: string) {
  const settings = getSettings();
  if (running || !settings.readingEnabled) return;
  if (!isConfigured().hardcover || !isConfigured().abs) return;
  running = true;
  try {
    const progress = await new Abs().myProgress();
    const libraries = await new Abs().libraries();
    for (const lib of libraries) await refreshLibrary(lib.id);
    const items = getItems([...new Set(progress.map((p) => p.libraryItemId))]);
    const now = new Date().toISOString();

    for (const p of progress) {
      const item = items.get(p.libraryItemId);
      if (!item) continue; // a podcast or an item that's gone
      upsertProgress(p, item.libraryId, now);
    }
    db.prepare("DELETE FROM reading WHERE seen_at <> ?").run(now);

    await matchAll();
    await fillBookDetails();
    const summary = await planAndPush(settings.readingApproved);
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

function rows(): ReadingRow[] {
  return db.prepare("SELECT * FROM reading").all() as unknown as ReadingRow[];
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
    const key = `${item.title}|${item.authors.join(",")}|${item.asin ?? ""}|${item.isbn ?? ""}|${strictness}`;
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

interface Plan {
  kind: "add" | "status" | "progress" | "skip" | "none";
  status?: number;
  description: string;
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

export function planFor(r: ReadingRow, entry: Entry | undefined): Plan {
  const status = entry?.statusId ?? null;
  const pct = percent(r);
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
  if (current !== null && Math.abs(current - pct) < 1) return { kind: "none", description: `Currently Reading at ${pct}%` };
  return { kind: "progress", description: `Progress ${current ?? 0}% → ${pct}%` };
}

function currentProgress(entry: Entry): number | null {
  const reads = (entry as unknown as { userBookReads?: { startedAt: string | null; finishedAt: string | null; progress: number | null }[] })
    .userBookReads;
  const open = reads?.find((x) => x.startedAt && !x.finishedAt);
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
  return out;
}

async function planAndPush(approved: boolean): Promise<string> {
  const matched = rows().filter((r) => r.match_status === "matched" && r.hc_book_id);
  const changed = matched.filter((r) => r.synced_key !== stateKey(r) || r.sync_status === "pending" || r.sync_status === "error");
  db.prepare("UPDATE reading SET sync_status = 'none', sync_action = NULL WHERE match_status <> 'matched'").run();
  if (!changed.length) return `${matched.length} matched, nothing new to send`;

  const library = await hardcoverLibrary();
  let sent = 0;
  let pending = 0;
  let skipped = 0;
  let errors = 0;
  const hc = hardcover();
  const items = getItems(changed.map((r) => r.abs_item_id));

  for (const r of changed) {
    const entry = library.get(r.hc_book_id!);
    const plan = planFor(r, entry);
    const hcStatus = entry?.statusId ?? null;
    if (plan.kind === "skip" || plan.kind === "none") {
      mark(r, plan.kind === "skip" ? "skipped" : "synced", plan.description, hcStatus, currentOr(entry), true);
      if (plan.kind === "skip") skipped++;
      continue;
    }
    if (!approved) {
      mark(r, "pending", plan.description, hcStatus, currentOr(entry), false);
      pending++;
      continue;
    }
    try {
      await push(hc, r, plan, entry, items.get(r.abs_item_id)?.asin ?? null);
      mark(r, "synced", plan.description, plan.status ?? hcStatus, percent(r), true);
      sent++;
    } catch (err) {
      mark(r, "error", `${plan.description}: ${(err as Error).message}`, hcStatus, currentOr(entry), false);
      errors++;
    }
  }
  if (!approved) return `preview: ${pending} change${pending === 1 ? "" : "s"} waiting for your approval`;
  return [`sent ${sent}`, skipped && `skipped ${skipped}`, errors && `${errors} failed`].filter(Boolean).join(", ");
}

function currentOr(entry: Entry | undefined) {
  return entry ? currentProgress(entry) : null;
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
      log("warn", `Progress for "${(json<HcBookView | null>(r.hc_book, null))?.title ?? bookId}" not sent: ${(err as Error).message}`);
    }
  }
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
        candidates: json<HcCandidate[]>(r.candidates, []),
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
    approved: getSettings().readingApproved,
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
    },
    books,
  };
}
