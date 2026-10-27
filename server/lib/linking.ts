/**
 * Links every Audiobookshelf book to its Hardcover book, so Shelfhelp can
 * tell what you already have before you request it.
 *
 * Uses the same matching as Reading and Collections: your own decisions
 * first, then ASIN/ISBN links, then a Hardcover search scored by title and
 * author. Searches are paced to stay inside Hardcover's rate limit.
 */
import { Abs } from "./abs.js";
import { db, json } from "./db.js";
import { getItems, idLinks, libraryIndex, libraryItems, refreshLibrary } from "./library.js";
import { judge, matchBook, scoreCandidate, type Status } from "./matcher.js";
import { findCandidates, toHcBook, view, type HcBookView } from "./reading.js";
import { getSettings, isConfigured } from "./settings.js";
import { log } from "./activity.js";
import { currentJob, finishJob, startJob, step } from "./progress.js";

const JOB = "library";
/** Look again after this long, in case Hardcover added or fixed the book. */
const SEARCH_AGAIN_MS = 30 * 24 * 3600_000;
/** Time between Hardcover searches. */
const PACE_MS = Number(process.env.LINK_PACE_MS ?? 1200);

export type LinkStatus = Status | "ignored";

interface LinkRow {
  abs_item_id: string;
  library_id: string;
  status: LinkStatus;
  source: string | null;
  hc_book_id: number | null;
  hc_book: string | null;
  score: number | null;
  reasons: string | null;
  candidates: string | null;
  searched_key: string | null;
  searched_at: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save(itemId: string, libraryId: string, patch: Partial<LinkRow>) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO library_links (abs_item_id, library_id, status, updated_at) VALUES (?, ?, 'missing', ?)
     ON CONFLICT(abs_item_id) DO NOTHING`,
  ).run(itemId, libraryId, now);
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE library_links SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE abs_item_id = ?`).run(
    ...keys.map((k) => (patch as Record<string, string | number | null>)[k]),
    now,
    itemId,
  );
}

/** A match you or another part of Shelfhelp already settled. */
function settled(itemId: string, libraryId: string): { status: LinkStatus; source: string; hcBookId: number | null; reason: string } | null {
  const own = db.prepare("SELECT action, hc_book_id FROM item_overrides WHERE abs_item_id = ?").get(itemId) as
    | { action: string; hc_book_id: number | null }
    | undefined;
  if (own?.action === "match" && own.hc_book_id) return { status: "matched", source: "manual", hcBookId: own.hc_book_id, reason: "matched by you" };
  if (own?.action === "ignore") return { status: "ignored", source: "manual", hcBookId: null, reason: "ignored by you" };
  if (own?.action === "missing") return { status: "missing", source: "manual", hcBookId: null, reason: "marked not on Hardcover by you" };
  const col = db
    .prepare("SELECT hc_book_id FROM overrides WHERE abs_item_id = ? AND library_id = ? AND action = 'match'")
    .get(itemId, libraryId) as { hc_book_id: number } | undefined;
  if (col) return { status: "matched", source: "manual", hcBookId: col.hc_book_id, reason: "matched by you in a collection" };
  const listed = db
    .prepare(
      `SELECT b.hc_book_id FROM list_books b JOIN lists l ON l.id = b.list_id
       WHERE b.abs_item_id = ? AND l.abs_library_id = ? AND b.status = 'matched' LIMIT 1`,
    )
    .get(itemId, libraryId) as { hc_book_id: number } | undefined;
  if (listed) return { status: "matched", source: "collection", hcBookId: listed.hc_book_id, reason: "matched in one of your collections" };
  const reading = db
    .prepare("SELECT hc_book_id, hc_book FROM reading WHERE abs_item_id = ? AND match_status = 'matched' AND hc_book_id IS NOT NULL")
    .get(itemId) as { hc_book_id: number } | undefined;
  if (reading) return { status: "matched", source: "reading", hcBookId: reading.hc_book_id, reason: "matched on the Reading page" };
  return null;
}

/** Book details Shelfhelp already has somewhere, to avoid asking Hardcover. */
function knownBook(hcBookId: number): string | null {
  const r = db.prepare("SELECT hc_book FROM reading WHERE hc_book_id = ? AND hc_book IS NOT NULL LIMIT 1").get(hcBookId) as { hc_book: string } | undefined;
  if (r) return r.hc_book;
  const lb = db
    .prepare("SELECT hc_book_id, slug, title, authors, cover_url, series_name, series_position, release_year FROM list_books WHERE hc_book_id = ? LIMIT 1")
    .get(hcBookId) as Record<string, unknown> | undefined;
  if (!lb) return null;
  return JSON.stringify({
    id: lb.hc_book_id,
    slug: lb.slug,
    title: lb.title,
    authors: json<string[]>(lb.authors as string, []),
    coverUrl: lb.cover_url,
    seriesName: lb.series_name,
    seriesPosition: lb.series_position,
    releaseYear: lb.release_year,
  });
}

export function linkingRunning() {
  return currentJob(JOB) !== null;
}

/** Starts linking in the background. */
export function linkLibrary(reason: string, { force = false } = {}): "started" | "running" | "not-configured" {
  const c = isConfigured();
  if (!c.hardcover || !c.abs) return "not-configured";
  if (linkingRunning()) return "running";
  startJob(JOB, "Linking your library");
  run(force)
    .then((msg) => {
      finishJob(JOB, true, msg);
      log("info", `Library linking (${reason}): ${msg}`);
    })
    .catch((err) => {
      finishJob(JOB, false, (err as Error).message);
      log("error", `Library linking failed: ${(err as Error).message}`);
    });
  return "started";
}

async function run(force: boolean): Promise<string> {
  const libs = await new Abs().selectedLibraries();
  const strictness = getSettings().matchStrictness;
  let searched = 0;
  let total = 0;
  for (const lib of libs) {
    await refreshLibrary(lib.id, { job: JOB, maxAgeMs: 30 * 60_000 });
    const items = libraryItems(lib.id);
    const existing = new Map(
      (db.prepare("SELECT * FROM library_links WHERE library_id = ?").all(lib.id) as unknown as LinkRow[]).map((r) => [r.abs_item_id, r]),
    );
    let i = 0;
    for (const item of items) {
      step(JOB, `Linking ${lib.name} to Hardcover`, i++, items.length);
      total++;
      const s = settled(item.id, lib.id);
      if (s) {
        const prev = existing.get(item.id);
        save(item.id, lib.id, {
          status: s.status,
          source: s.source,
          hc_book_id: s.hcBookId,
          hc_book: prev?.hc_book_id === s.hcBookId ? (prev?.hc_book ?? null) : s.hcBookId ? knownBook(s.hcBookId) : null,
          reasons: JSON.stringify([s.reason]),
          score: null,
        });
        continue;
      }
      const key = `${item.title}|${item.authors.join(",")}|${item.asin ?? ""}|${item.isbn ?? ""}|${strictness}`;
      const prev = existing.get(item.id);
      const age = prev?.searched_at ? Date.now() - Date.parse(prev.searched_at) : Infinity;
      if (!force && prev?.searched_key === key && age < SEARCH_AGAIN_MS && prev.source === "auto") continue;

      const candidates = await findCandidates(item);
      searched++;
      const ranked = candidates
        .map((c) => ({ c, s: scoreCandidate(toHcBook(c), item, c.idVia) }))
        .map(({ c, s }) => ({ ...c, score: s.score, titleSim: s.titleSim, authorSim: s.authorSim, notes: s.notes }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const { status, reasons } = judge(ranked, strictness, "on Hardcover");
      const best = status === "missing" ? null : (ranked[0] ?? null);
      save(item.id, lib.id, {
        status,
        source: "auto",
        hc_book_id: best?.id ?? null,
        hc_book: best ? JSON.stringify(view(best)) : null,
        score: best?.score ?? 0,
        reasons: JSON.stringify(reasons),
        candidates: JSON.stringify(ranked),
        searched_key: key,
        searched_at: new Date().toISOString(),
      });
      await sleep(PACE_MS);
    }
  }
  const c = linkCounts();
  return `${total} books checked, ${searched} looked up on Hardcover. ${c.matched} linked, ${c.review} to check, ${c.missing} not found.`;
}

export function linkCounts() {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM library_links WHERE abs_item_id IN (SELECT id FROM abs_items) GROUP BY status")
    .all() as { status: LinkStatus; n: number }[];
  const out = { matched: 0, review: 0, missing: 0, ignored: 0, unchecked: 0 };
  for (const r of rows) out[r.status] = r.n;
  const all = (db.prepare("SELECT COUNT(*) AS n FROM abs_items").get() as { n: number }).n;
  out.unchecked = Math.max(0, all - out.matched - out.review - out.missing - out.ignored);
  return out;
}

/** One page of the Library list. */
export function linkView({ status, q, offset = 0, limit = 60 }: { status?: string; q?: string; offset?: number; limit?: number }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (status === "unchecked") where.push("l.abs_item_id IS NULL");
  else if (status && status !== "all") {
    where.push("l.status = ?");
    args.push(status);
  }
  if (q?.trim()) {
    const like = `%${q.trim().replace(/[%_]/g, "")}%`;
    where.push("(i.title LIKE ? OR i.authors LIKE ? OR l.hc_book LIKE ?)");
    args.push(like, like, like);
  }
  const sql = `FROM abs_items i LEFT JOIN library_links l ON l.abs_item_id = i.id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args) as { n: number }).n;
  const rows = db
    .prepare(`SELECT i.id AS item_id, l.* ${sql} ORDER BY i.title COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as unknown as (LinkRow & { item_id: string })[];
  const items = getItems(rows.map((r) => r.item_id));
  return {
    total,
    counts: linkCounts(),
    rows: rows.map((r) => {
      const item = items.get(r.item_id)!;
      return {
        absItemId: r.item_id,
        item: {
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          authors: item.authors,
          narrators: item.narrators,
          series: item.series,
          asin: item.asin,
          isbn: item.isbn,
          duration: item.duration,
          publishedYear: item.publishedYear,
          coverUrl: `/api/abs/cover/${item.id}`,
        },
        status: (r.status ?? "unchecked") as LinkStatus | "unchecked",
        source: r.source,
        hcBook: json<HcBookView | null>(r.hc_book, null),
        score: r.score,
        reasons: json<string[]>(r.reasons, []),
        candidates: json<(HcBookView & { score: number; titleSim: number; authorSim: number | null; idVia: string[] })[]>(r.candidates, []),
      };
    }),
  };
}

/** Records your decision for one item and updates its link right away. */
export function applyDecision(itemId: string, action: "match" | "ignore" | "missing" | "reset", book?: HcBookView | null) {
  const item = getItems([itemId]).get(itemId);
  if (!item) return;
  if (action === "reset") {
    db.prepare("UPDATE library_links SET searched_key = NULL, source = NULL WHERE abs_item_id = ?").run(itemId);
    return;
  }
  save(itemId, item.libraryId, {
    status: action === "match" ? "matched" : action === "ignore" ? "ignored" : "missing",
    source: "manual",
    hc_book_id: action === "match" ? (book?.id ?? null) : null,
    hc_book: action === "match" && book ? JSON.stringify(view(book)) : null,
    reasons: JSON.stringify([action === "match" ? "matched by you" : action === "ignore" ? "ignored by you" : "marked not on Hardcover by you"]),
  });
}

/**
 * What Audiobookshelf has that looks like this Hardcover book: items linked
 * to it, then close title and author matches.
 */
export function similarInLibrary(book: { id: number; title: string; subtitle?: string | null; authors: string[] }) {
  const linked = db
    .prepare("SELECT abs_item_id, source FROM library_links WHERE hc_book_id = ? AND status = 'matched'")
    .all(book.id) as { abs_item_id: string; source: string }[];
  // ASIN/ISBN links count unless the linker decided that item is a different book.
  const fromIds = db
    .prepare(
      `SELECT DISTINCT i.abs_item_id, i.via FROM id_links i LEFT JOIN library_links l ON l.abs_item_id = i.abs_item_id
       WHERE i.hc_book_id = ? AND (l.abs_item_id IS NULL OR (l.status = 'matched' AND l.hc_book_id = i.hc_book_id))`,
    )
    .all(book.id) as { abs_item_id: string; via: string }[];
  const confirmed = new Map<string, string>();
  for (const l of linked) confirmed.set(l.abs_item_id, l.source === "manual" ? "matched by you" : "linked");
  for (const l of fromIds) if (!confirmed.has(l.abs_item_id)) confirmed.set(l.abs_item_id, `${l.via.toUpperCase()} match`);

  const similar: { absItemId: string; score: number; titleSim: number; authorSim: number | null; notes: string[] }[] = [];
  const libs = (db.prepare("SELECT DISTINCT library_id FROM abs_items").all() as { library_id: string }[]).map((r) => r.library_id);
  for (const lib of libs) {
    const m = matchBook({ id: book.id, title: book.title, subtitle: book.subtitle, authors: book.authors }, libraryIndex(lib), idLinks(lib), "loose");
    for (const c of m.candidates) {
      if (confirmed.has(c.absItemId) || c.score < 35) continue;
      similar.push({ absItemId: c.absItemId, score: c.score, titleSim: c.titleSim, authorSim: c.authorSim, notes: c.notes });
    }
  }
  similar.sort((a, b) => b.score - a.score);
  const items = getItems([...confirmed.keys(), ...similar.map((s) => s.absItemId)]);
  const itemView = (id: string) => {
    const i = items.get(id);
    return i
      ? { id: i.id, title: i.title, subtitle: i.subtitle, authors: i.authors, narrators: i.narrators, series: i.series, duration: i.duration, coverUrl: `/api/abs/cover/${i.id}`, numAudio: i.numAudio }
      : null;
  };
  return {
    confirmed: [...confirmed].map(([id, via]) => ({ via, item: itemView(id) })).filter((x) => x.item),
    similar: similar.slice(0, 5).map((s) => ({ ...s, item: itemView(s.absItemId) })).filter((x) => x.item),
    linkedCount: linkCounts(),
  };
}

/** Recently added Audiobookshelf books, newest first. */
export function recentlyAdded(limit = 20) {
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.authors, i.added_at, l.hc_book_id, l.hc_book FROM abs_items i
       LEFT JOIN library_links l ON l.abs_item_id = i.id AND l.status = 'matched'
       WHERE i.added_at IS NOT NULL ORDER BY i.added_at DESC LIMIT ?`,
    )
    .all(limit) as { id: string; title: string; authors: string; added_at: number; hc_book_id: number | null; hc_book: string | null }[];
  return rows.map((r) => ({
    absItemId: r.id,
    title: r.title,
    authors: json<string[]>(r.authors, []),
    coverUrl: `/api/abs/cover/${r.id}`,
    addedAt: r.added_at,
    hcBook: json<HcBookView | null>(r.hc_book, null),
  }));
}
