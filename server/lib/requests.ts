/** Book requests sent to Chaptarr, and keeping their status current. */
import { db, json } from "./db.js";
import { getSettings, type RequestFormat } from "./settings.js";
import { Chaptarr, ChaptarrError, addBody, chooseFor, errorText, localOf, formatLabel, type ChaptarrBook, type Format } from "./chaptarr.js";
import { hardcover, authorsOf } from "./hardcover.js";
import { log } from "./activity.js";
import { Abs } from "./abs.js";
import { refreshLibrary, libraryIndex, idLinks } from "./library.js";
import { matchBook } from "./matcher.js";

export type RequestStatus = "pending" | "requested" | "downloading" | "downloaded" | "available" | "failed";

export interface RequestRow {
  id: number;
  hc_book_id: number;
  format: Format;
  title: string;
  authors: string | null;
  slug: string | null;
  cover_url: string | null;
  release_year: number | null;
  requested_by: string;
  status: RequestStatus;
  message: string | null;
  chaptarr_book_id: number | null;
  pending_id: number | null;
  abs_item_id: string | null;
  progress: number | null;
  requested_at: string;
  updated_at: string;
  checked_at: string | null;
}

export interface HcSummary {
  id: number;
  slug: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  releaseYear: number | null;
  seriesName: string | null;
  seriesPosition: number | string | null;
  hasAudiobook: boolean | null;
}

const OPEN: RequestStatus[] = ["pending", "requested", "downloading", "downloaded"];

export function requestView(r: RequestRow) {
  return {
    id: r.id,
    hcBookId: r.hc_book_id,
    format: r.format,
    title: r.title,
    authors: json<string[]>(r.authors, []),
    slug: r.slug,
    hcUrl: r.slug ? `https://hardcover.app/books/${r.slug}` : null,
    coverUrl: r.cover_url,
    releaseYear: r.release_year,
    requestedBy: r.requested_by,
    status: r.status,
    message: r.message,
    chaptarrBookId: r.chaptarr_book_id,
    absItemId: r.abs_item_id,
    progress: r.progress,
    requestedAt: r.requested_at,
    updatedAt: r.updated_at,
    checkedAt: r.checked_at,
  };
}

export function listRequests() {
  return (db.prepare("SELECT * FROM requests ORDER BY requested_at DESC").all() as unknown as RequestRow[]).map(requestView);
}

/** Request statuses for some Hardcover books, keyed by book then format. */
export function requestsFor(bookIds: number[]) {
  const out = new Map<number, Partial<Record<Format, { id: number; status: RequestStatus }>>>();
  if (!bookIds.length) return out;
  const rows = db
    .prepare(`SELECT id, hc_book_id, format, status FROM requests WHERE hc_book_id IN (${bookIds.map(() => "?").join(",")})`)
    .all(...bookIds) as { id: number; hc_book_id: number; format: Format; status: RequestStatus }[];
  for (const r of rows) {
    const m = out.get(r.hc_book_id) ?? {};
    m[r.format] = { id: r.id, status: r.status };
    out.set(r.hc_book_id, m);
  }
  return out;
}

/** Which of these Hardcover books Shelfhelp already knows are in Audiobookshelf. */
export function inLibrary(bookIds: number[]): Map<number, string> {
  const known = new Map<number, string>();
  if (!bookIds.length) return known;
  const ph = bookIds.map(() => "?").join(",");
  const queries = [
    `SELECT DISTINCT hc_book_id, abs_item_id FROM id_links WHERE hc_book_id IN (${ph}) AND abs_item_id IN (SELECT id FROM abs_items)`,
    `SELECT hc_book_id, abs_item_id FROM list_books WHERE status = 'matched' AND hc_book_id IN (${ph})`,
    `SELECT hc_book_id, abs_item_id FROM reading WHERE match_status = 'matched' AND hc_book_id IN (${ph})`,
  ];
  for (const q of queries) {
    for (const r of db.prepare(q).all(...bookIds) as { hc_book_id: number; abs_item_id: string | null }[]) {
      if (r.abs_item_id && !known.has(r.hc_book_id)) known.set(r.hc_book_id, r.abs_item_id);
    }
  }
  return known;
}

/**
 * Reads a Hardcover book from whatever you pasted: a hardcover.app link, a
 * slug, a book id, or `hc:123`.
 */
export function parseHardcoverRef(input: string): { id?: number; slug?: string } | null {
  const s = input.trim();
  if (!s) return null;
  const url = s.match(/hardcover\.app\/books\/([^/?#\s]+)/i);
  if (url) return { slug: decodeURIComponent(url[1]) };
  const id = s.match(/^(?:hc:)?(\d+)$/i);
  if (id) return { id: Number(id[1]) };
  if (/^[a-z0-9][a-z0-9-]*$/i.test(s)) return { slug: s.toLowerCase() };
  return null;
}

type SdkBook = {
  id: number;
  slug?: string | null;
  title?: string | null;
  subtitle?: string | null;
  releaseYear?: number | null;
  cachedImage?: { url?: string | null } | null;
  cachedContributors?: unknown;
  cachedFeaturedSeries?: unknown;
  hasAudiobook?: boolean | null;
  audioSeconds?: number | null;
};

function summarize(b: SdkBook): HcSummary {
  const fs = (b.cachedFeaturedSeries && typeof b.cachedFeaturedSeries === "object" ? b.cachedFeaturedSeries : {}) as {
    series?: { name?: string };
    position?: number | string | null;
  };
  return {
    id: b.id,
    slug: b.slug ?? null,
    title: b.title ?? "Untitled",
    subtitle: b.subtitle ?? null,
    authors: authorsOf(b.cachedContributors as Parameters<typeof authorsOf>[0]),
    coverUrl: b.cachedImage?.url ?? null,
    releaseYear: b.releaseYear ?? null,
    seriesName: fs.series?.name ?? null,
    seriesPosition: fs.position ?? null,
    hasAudiobook: b.hasAudiobook ?? (b.audioSeconds ? true : null),
  };
}

export async function hardcoverBook(ref: { id?: number; slug?: string }): Promise<HcSummary | null> {
  const hc = hardcover();
  if (ref.id) {
    const [b] = await hc.books.getMany([ref.id]);
    return b ? summarize(b as unknown as SdkBook) : null;
  }
  if (ref.slug) {
    const b = await hc.books.getBySlug(ref.slug);
    return b ? summarize(b as unknown as SdkBook) : null;
  }
  return null;
}

export function formatsFor(f: RequestFormat): Format[] {
  return f === "both" ? ["audiobook", "ebook"] : [f];
}

function save(hcBook: HcSummary, format: Format, patch: Partial<RequestRow>, by = "admin"): RequestRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO requests (hc_book_id, format, title, authors, slug, cover_url, release_year, requested_by, status, requested_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
     ON CONFLICT(hc_book_id, format) DO UPDATE SET
       title = excluded.title, authors = excluded.authors, slug = excluded.slug, cover_url = excluded.cover_url,
       release_year = excluded.release_year, requested_by = excluded.requested_by, requested_at = excluded.requested_at,
       updated_at = excluded.updated_at`,
  ).run(hcBook.id, format, hcBook.title, JSON.stringify(hcBook.authors), hcBook.slug, hcBook.coverUrl, hcBook.releaseYear, by, now, now);
  const row = db.prepare("SELECT * FROM requests WHERE hc_book_id = ? AND format = ?").get(hcBook.id, format) as unknown as RequestRow;
  return update(row.id, { message: null, chaptarr_book_id: null, pending_id: null, abs_item_id: null, progress: null, ...patch });
}

function update(id: number, patch: Partial<RequestRow>): RequestRow {
  const keys = Object.keys(patch).filter((k) => k !== "id");
  if (keys.length) {
    const sets = [...keys.map((k) => `${k} = ?`), "updated_at = ?"].join(", ");
    db.prepare(`UPDATE requests SET ${sets} WHERE id = ?`).run(
      ...keys.map((k) => (patch as Record<string, unknown>)[k] as string | number | null),
      new Date().toISOString(),
      id,
    );
  }
  return db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as unknown as RequestRow;
}

/** The lookup result for one format, plus the copy Chaptarr already has, if any. */
async function findIn(c: Chaptarr, hcBookId: number, format: Format) {
  // Ask without a format filter: Chaptarr returns both formats of a book, and a
  // filtered lookup can come back empty for books it only lists one way.
  const results = await c.lookup(`hc:${hcBookId}`);
  const same = (b: ChaptarrBook) => (b.mediaType ?? "").toLowerCase() === format;
  const found = results.find(same) ?? results[0] ?? null;
  const local = results.map((r) => localOf(r, format)).find(Boolean) ?? null;
  return { found, local, results };
}

export interface RequestOutcome {
  format: Format;
  status: RequestStatus;
  message: string;
  request: ReturnType<typeof requestView>;
}

/** Sends one book to Chaptarr in one or both formats. */
export async function requestBook(hcBookId: number, format: RequestFormat, by = "admin"): Promise<RequestOutcome[]> {
  const s = getSettings();
  if (!s.requestsEnabled) throw new Error("Requests are turned off. Turn them on in Settings, Chaptarr.");
  const c = new Chaptarr(undefined, undefined, s);
  const hcBook = await hardcoverBook({ id: hcBookId });
  if (!hcBook) throw new Error(`Hardcover has no book ${hcBookId}.`);
  const [roots, quality, metadata] = await Promise.all([c.rootFolders(), c.qualityProfiles(), c.metadataProfiles()]);
  const out: RequestOutcome[] = [];
  for (const f of formatsFor(format)) {
    let row: RequestRow;
    try {
      row = await requestOne(c, hcBook, f, chooseFor(f, s, roots, quality, metadata), s.requestSearchNow, by);
    } catch (err) {
      const message = (err as Error).message;
      row = save(hcBook, f, { status: "failed", message }, by);
    }
    const label = `${hcBook.title} (${formatLabel(f).toLowerCase()})`;
    log(row.status === "failed" ? "warn" : "info", row.status === "failed" ? `Request for ${label} failed: ${row.message}` : `Requested ${label}: ${row.message}`);
    out.push({ format: f, status: row.status, message: row.message ?? "", request: requestView(row) });
  }
  return out;
}

async function requestOne(
  c: Chaptarr,
  hcBook: HcSummary,
  format: Format,
  choice: ReturnType<typeof chooseFor>,
  searchNow: boolean,
  by: string,
): Promise<RequestRow> {
  const { found, local } = await findIn(c, hcBook.id, format);
  if (local) {
    if (local.hasFiles) {
      return save(hcBook, format, { status: "downloaded", chaptarr_book_id: local.id, message: "Chaptarr already has this." }, by);
    }
    if (!local.monitored) await c.monitor([local.id]);
    if (searchNow) await c.search([local.id]);
    return save(
      hcBook,
      format,
      {
        status: "requested",
        chaptarr_book_id: local.id,
        message: local.monitored ? "Chaptarr already wanted this; searching again." : "Chaptarr had this unmonitored; now monitored and searching.",
      },
      by,
    );
  }
  if (!found) {
    return save(hcBook, format, { status: "failed", message: `Chaptarr couldn't find hc:${hcBook.id} in its metadata.` }, by);
  }
  if (choice.problem) return save(hcBook, format, { status: "failed", message: choice.problem }, by);

  const { status, data } = await c.add(addBody(found, format, choice, searchNow), format);
  if (status === 201 || status === 200) {
    const id = (data as { id?: number } | null)?.id ?? null;
    return save(hcBook, format, { status: "requested", chaptarr_book_id: id, message: searchNow ? "Added to Chaptarr and searching." : "Added to Chaptarr." }, by);
  }
  if (status === 202) {
    const d = data as { pendingId?: number; message?: string } | null;
    return save(
      hcBook,
      format,
      { status: "pending", pending_id: d?.pendingId ?? null, message: d?.message || "Chaptarr is importing the author first; the book follows." },
      by,
    );
  }
  if (status === 409) {
    const d = data as { message?: string; candidates?: { title?: string; authorName?: string }[] } | null;
    const names = (d?.candidates ?? [])
      .map((x) => (x.title && x.authorName && x.title !== x.authorName ? `${x.title} by ${x.authorName}` : (x.title ?? x.authorName ?? "")))
      .filter(Boolean);
    return save(
      hcBook,
      format,
      { status: "failed", message: `${d?.message || "Chaptarr matched more than one book or author."}${names.length ? ` (${names.join("; ")})` : ""}` },
      by,
    );
  }
  throw new ChaptarrError(errorText(data, status), status, data);
}

/** Forgets a request in Shelfhelp. Chaptarr keeps the book. */
export function forgetRequest(id: number) {
  db.prepare("DELETE FROM requests WHERE id = ?").run(id);
}

export async function retryRequest(id: number) {
  const r = db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as unknown as RequestRow | undefined;
  if (!r) throw new Error("That request is gone.");
  return requestBook(r.hc_book_id, r.format, r.requested_by);
}

let refreshing: Promise<void> | null = null;
let lastRefresh = 0;

/** Brings open requests up to date. Skips if it ran in the last `minAgeMs`. */
export function refreshRequests(minAgeMs = 30_000): Promise<void> {
  if (refreshing) return refreshing;
  if (Date.now() - lastRefresh < minAgeMs) return Promise.resolve();
  refreshing = doRefresh()
    .catch((err) => log("warn", `Couldn't check requests: ${(err as Error).message}`))
    .finally(() => {
      lastRefresh = Date.now();
      refreshing = null;
    });
  return refreshing;
}

async function doRefresh() {
  const open = (db.prepare(`SELECT * FROM requests WHERE status IN (${OPEN.map(() => "?").join(",")})`).all(...OPEN) as unknown as RequestRow[]);
  if (!open.length) return;
  const s = getSettings();
  const now = new Date().toISOString();

  if (s.chaptarrUrl && s.chaptarrApiKey) {
    const c = new Chaptarr(undefined, undefined, s);
    const queue = await c.queue().catch(() => [] as Awaited<ReturnType<Chaptarr["queue"]>>);
    const queued = new Map(queue.filter((q) => q.bookId).map((q) => [q.bookId!, q]));
    for (const r of open) {
      if (r.status === "downloaded") continue;
      try {
        let bookId = r.chaptarr_book_id;
        if (!bookId) {
          const { local } = await findIn(c, r.hc_book_id, r.format);
          bookId = local?.id ?? null;
          if (!bookId) {
            update(r.id, { checked_at: now });
            continue;
          }
        }
        let book: ChaptarrBook;
        try {
          book = await c.book(bookId);
        } catch (err) {
          if (err instanceof ChaptarrError && err.status === 404) {
            // The row id changed or the book was removed; look it up again by Hardcover id.
            const { local } = await findIn(c, r.hc_book_id, r.format);
            if (!local) {
              update(r.id, { status: "failed", chaptarr_book_id: null, message: "The book isn't in Chaptarr anymore.", checked_at: now });
              continue;
            }
            book = await c.book(local.id);
          } else throw err;
        }
        const hasFiles = !!book.hasFiles || (book.statistics?.bookFileCount ?? 0) > 0;
        const q = queued.get(book.id);
        if (hasFiles) {
          update(r.id, { status: "downloaded", chaptarr_book_id: book.id, progress: 100, message: "Downloaded by Chaptarr.", checked_at: now });
        } else if (q || book.grabbed) {
          const progress = q?.size ? Math.round(((q.size - (q.sizeleft ?? 0)) / q.size) * 100) : null;
          update(r.id, {
            status: "downloading",
            chaptarr_book_id: book.id,
            progress,
            message: q?.errorMessage || (q?.timeleft ? `Downloading, ${q.timeleft} left.` : "Downloading."),
            checked_at: now,
          });
        } else {
          update(r.id, {
            status: "requested",
            chaptarr_book_id: book.id,
            progress: null,
            message: book.monitored === false ? "In Chaptarr but not monitored." : "Waiting for Chaptarr to find a release.",
            checked_at: now,
          });
        }
      } catch (err) {
        update(r.id, { checked_at: now, message: `Couldn't check Chaptarr: ${(err as Error).message}` });
      }
    }
  }

  await markAvailable(s.absUrl && s.absToken ? true : false);
}

/** Audiobook requests that show up in Audiobookshelf become Available. */
async function markAvailable(absReady: boolean) {
  const waiting = db
    .prepare("SELECT * FROM requests WHERE format = 'audiobook' AND status IN ('requested', 'downloading', 'downloaded')")
    .all() as unknown as RequestRow[];
  if (!waiting.length) return;
  // Pull a fresh copy of the library once something has downloaded.
  if (absReady && waiting.some((r) => r.status === "downloaded")) {
    try {
      for (const lib of await new Abs().selectedLibraries()) await refreshLibrary(lib.id, { maxAgeMs: 10 * 60_000 });
    } catch {
      /* Audiobookshelf unreachable; try again next time */
    }
  }
  const found = inLibrary(waiting.map((r) => r.hc_book_id));
  const libs = (db.prepare("SELECT DISTINCT library_id FROM abs_items").all() as { library_id: string }[]).map((l) => l.library_id);
  for (const r of waiting) {
    let itemId = found.get(r.hc_book_id) ?? null;
    if (!itemId && r.status === "downloaded") {
      // No ASIN/ISBN link yet: fall back to a confident title and author match.
      for (const lib of libs) {
        const m = matchBook({ id: r.hc_book_id, title: r.title, authors: json<string[]>(r.authors, []) }, libraryIndex(lib), idLinks(lib), "strict");
        if (m.status === "matched" && m.absItemId) {
          itemId = m.absItemId;
          break;
        }
      }
    }
    if (itemId) update(r.id, { status: "available", abs_item_id: itemId, progress: 100, message: "In Audiobookshelf." });
  }
}

let timer: NodeJS.Timeout | null = null;

/** Checks open requests every few minutes while there are any. */
export function startRequestWatcher(everyMs = 5 * 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    const open = db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE status IN (${OPEN.map(() => "?").join(",")})`).get(...OPEN) as { n: number };
    if (open.n) refreshRequests(0);
  }, everyMs);
  timer.unref();
}

export function requestCounts() {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM requests GROUP BY status").all() as { status: RequestStatus; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<RequestStatus, number>>;
}
