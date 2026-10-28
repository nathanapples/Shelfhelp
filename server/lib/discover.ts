/**
 * Rows for the Discover page. Admins set the default rows; anyone can pick
 * their own. A row is either one of the built-in rows below or a Hardcover
 * list. Hardcover answers are cached for a few hours.
 */
import { db, json } from "./db.js";
import { fetchList, hardcover, resolveList, type ListBook } from "./hardcover.js";
import { inLibrary, requestsFor, summarizeBook, type HcSummary } from "./requests.js";
import { myShelfStatus } from "./reading.js";
import { recentlyAdded } from "./linking.js";
import { getSettings, saveSettings } from "./settings.js";
import { getUser, toReader, updateUser } from "./users.js";

export type BuiltinId =
  | "trending"
  | "week"
  | "year"
  | "want"
  | "new"
  | "toprated"
  | "authors"
  | "audio"
  | "added"
  | "soon"
  | "requests"
  | "foryou"
  | "continue"
  | "prompt";

export const BUILTINS: Record<BuiltinId, { title: string; subtitle: string }> = {
  trending: { title: "Trending on Hardcover", subtitle: "Read the most in the last three months" },
  week: { title: "Trending this week", subtitle: "Hardcover's hottest books right now" },
  year: { title: "Popular this year", subtitle: "Trending on Hardcover over the past year" },
  want: { title: "From your Want to Read", subtitle: "On your Hardcover shelf, not in Audiobookshelf yet" },
  new: { title: "Recent releases", subtitle: "Popular books released in the last three months" },
  toprated: { title: "Highest rated new books", subtitle: "Released in the last year, best rated on Hardcover" },
  authors: { title: "New from authors you listen to", subtitle: "Recent and upcoming books by authors in your library" },
  audio: { title: "Popular audiobooks", subtitle: "Most-read books with an audiobook, from the last two years" },
  added: { title: "Recently added", subtitle: "Newest in Audiobookshelf" },
  soon: { title: "Upcoming releases", subtitle: "The most anticipated books releasing soon" },
  requests: { title: "Your recent requests", subtitle: "What you've asked for" },
  foryou: { title: "Top picks for you", subtitle: "From your vibes on Hardcover, not in Audiobookshelf yet" },
  continue: { title: "Pick up where you left off", subtitle: "The next unread book in series you've been reading" },
  prompt: { title: "Featured prompt", subtitle: "Hardcover's featured prompt, most picked books first" },
};

/** Genres to browse. Hardcover's genre tags are matched ignoring case, spaces and dashes. */
export const GENRES: { slug: string; name: string }[] = [
  ["fantasy", "Fantasy"],
  ["science-fiction", "Science Fiction"],
  ["mystery", "Mystery"],
  ["thriller", "Thriller"],
  ["romance", "Romance"],
  ["horror", "Horror"],
  ["historical-fiction", "Historical Fiction"],
  ["literary-fiction", "Literary Fiction"],
  ["young-adult", "Young Adult"],
  ["nonfiction", "Nonfiction"],
  ["biography", "Biography"],
  ["history", "History"],
  ["self-help", "Self Help"],
  ["humor", "Humor"],
  ["classics", "Classics"],
].map(([slug, name]) => ({ slug, name }));
const genreBySlug = new Map(GENRES.map((g) => [g.slug, g]));

export type RowConfig =
  | { key: string; kind: "builtin"; id: BuiltinId }
  | { key: string; kind: "list"; listId: number; title: string; owner?: string | null; slug?: string | null }
  | { key: string; kind: "genre"; genre: string };

const genreRow = (slug: string): RowConfig => ({ key: `genre-${slug}`, kind: "genre", genre: slug });

const builtin = (id: BuiltinId): RowConfig => ({ key: id, kind: "builtin", id });
/** Modeled on Hardcover's own Discover page: picks for you, trending, series to continue, then new and upcoming. */
export const STARTER_ROWS: RowConfig[] = [
  ...(["foryou", "trending", "continue", "want", "new", "soon", "added", "authors", "prompt"] as BuiltinId[]).map(builtin),
  genreRow("fantasy"),
  genreRow("science-fiction"),
  ...(["toprated", "requests"] as BuiltinId[]).map(builtin),
];

function valid(rows: unknown): RowConfig[] | null {
  if (!Array.isArray(rows)) return null;
  const out: RowConfig[] = [];
  const seen = new Set<string>();
  for (const r of rows as RowConfig[]) {
    if (!r || seen.has(r.key)) continue;
    if (r.kind === "builtin" && r.id in BUILTINS) out.push(builtin(r.id));
    else if (r.kind === "list" && Number(r.listId) > 0) {
      out.push({ key: `list-${Number(r.listId)}`, kind: "list", listId: Number(r.listId), title: String(r.title || "Hardcover list"), owner: r.owner ?? null, slug: r.slug ?? null });
    } else if (r.kind === "genre" && genreBySlug.has(r.genre)) out.push(genreRow(r.genre));
    else continue;
    seen.add(out[out.length - 1].key);
  }
  return out;
}

export function defaultRows(): RowConfig[] {
  const saved = valid(getSettings().discoverRows);
  return saved?.length ? saved : STARTER_ROWS;
}

/** The rows someone sees: their own if they've set them, else the defaults. */
export function rowsFor(userId: number) {
  const own = valid(json<unknown>(getUser(userId)?.discover_rows ?? null, null));
  return own?.length ? { rows: own, custom: true } : { rows: defaultRows(), custom: false };
}

export function saveRows(userId: number, rows: unknown, asDefault: boolean) {
  const clean = valid(rows) ?? [];
  if (asDefault) saveSettings({ discoverRows: clean });
  else updateUser(userId, { discover_rows: JSON.stringify(clean) });
  return clean;
}

export function resetRows(userId: number) {
  updateUser(userId, { discover_rows: null });
}

export function rowInfo(r: RowConfig) {
  if (r.kind === "builtin" && r.id === "prompt" && featured.prompt) {
    return { ...r, title: featured.prompt.question, subtitle: "Hardcover's featured prompt, most picked books first" };
  }
  if (r.kind === "builtin") return { ...r, ...BUILTINS[r.id] };
  if (r.kind === "genre") return { ...r, title: `Top ${genreBySlug.get(r.genre)!.name}`, subtitle: `The most-read ${genreBySlug.get(r.genre)!.name.toLowerCase()} books on Hardcover` };
  return { ...r, subtitle: r.owner ? `A Hardcover list by @${r.owner}` : "A Hardcover list" };
}

export const genreRows = () => GENRES.map((g) => rowInfo(genreRow(g.slug)));

/** Title and subtitle for any row key, for its own page. */
export async function rowInfoFor(key: string, userId: number) {
  const mine = rowsFor(userId).rows.find((r) => r.key === key) ?? defaultRows().find((r) => r.key === key);
  if (mine) return rowInfo(mine);
  if (key in BUILTINS) return rowInfo(builtin(key as BuiltinId));
  const g = key.match(/^genre-(.+)$/);
  if (g && genreBySlug.has(g[1])) return rowInfo(genreRow(g[1]));
  const l = key.match(/^list-(\d+)$/);
  if (l) {
    const { info } = await fetchList(Number(l[1]));
    return rowInfo({ key, kind: "list", listId: info.id, title: info.name, slug: info.slug, owner: null });
  }
  throw new Error("No such row");
}

/** Turns a pasted Hardcover list link (or id) into a row. */
export async function listRow(ref: string): Promise<RowConfig> {
  const id = await resolveList(ref);
  const { info } = await fetchList(id);
  const owner = ref.match(/@([^/\s]+)\/lists/)?.[1] ?? null;
  return { key: `list-${id}`, kind: "list", listId: id, title: info.name, owner: owner ? decodeURIComponent(owner) : null, slug: info.slug };
}

// ---------------------------------------------------------------------------

const TTL = 6 * 3600_000;
/** Books in a row on Discover, and on the row's own page. */
export const ROW = 20;
export const PAGE = 60;
const cache = new Map<string, { at: number; books: HcSummary[] }>();
const day = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => day(new Date(Date.now() + n * 86400_000));

async function cached(key: string, load: () => Promise<HcSummary[]>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.books;
  const books = await load();
  cache.set(key, { at: Date.now(), books });
  return books;
}

function annotate(books: HcSummary[], userId: number) {
  const ids = books.map((b) => b.id);
  const lib = inLibrary(ids);
  const req = requestsFor(ids);
  const mine = myShelfStatus(ids, userId);
  return books.map((b) => ({ ...b, absItemId: lib.get(b.id) ?? null, requests: req.get(b.id) ?? {}, mine: mine.get(b.id) ?? null }));
}

const BOOK_FIELDS = `id slug title subtitle releaseYear: release_year rating ratingsCount: ratings_count usersCount: users_count
  audioSeconds: audio_seconds cachedImage: cached_image cachedContributors: cached_contributors cachedFeaturedSeries: cached_featured_series`;

async function query(name: string, where: string, order: string, vars: Record<string, unknown>, limit = ROW) {
  const data = await hardcover().graphql<{ books: object[] }>(
    `query ${name}(${Object.keys(vars)
      .map((k) => `$${k}: ${Array.isArray(vars[k]) ? "[String!]!" : "date!"}`)
      .join(", ")}) {
       books(where: { ${where}, book_status_id: { _eq: 1 } }, order_by: ${order}, limit: ${limit}) { ${BOOK_FIELDS} }
     }`,
    vars,
  );
  return data.books.map(summarizeBook);
}

/** Authors with the most books in Audiobookshelf. */
function libraryAuthors(limit = 40): string[] {
  const counts = new Map<string, number>();
  for (const r of db.prepare("SELECT authors FROM abs_items").all() as { authors: string }[]) {
    for (const a of json<string[]>(r.authors, [])) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([a]) => a);
}

function fromList(b: ListBook): HcSummary {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    subtitle: b.subtitle,
    authors: b.authors,
    coverUrl: b.coverUrl,
    releaseYear: b.releaseYear,
    seriesName: b.seriesName,
    seriesPosition: b.seriesPosition,
    hasAudiobook: b.audioSeconds ? true : null,
  };
}

/** Hardcover's featured prompt, remembered so the row can be titled with its question. */
const featured: { prompt: { id: number; question: string } | null; at: number } = { prompt: null, at: 0 };

export async function loadFeaturedPrompt() {
  if (featured.prompt && Date.now() - featured.at < TTL) return featured.prompt;
  const page = await hardcover().prompts.list({ featured: true, limit: 1 });
  const p = page.items[0];
  featured.prompt = p ? { id: p.id, question: p.question ?? "Featured prompt" } : null;
  featured.at = Date.now();
  return featured.prompt;
}

/**
 * The next unread book in series you've read lately, like Hardcover's "Pick up
 * where you left off". Uses your Hardcover shelves as last read by Reading.
 */
async function continueSeries(userId: number, limit: number): Promise<HcSummary[]> {
  const shelf = db.prepare("SELECT book_id, status FROM hc_library WHERE user_id = ? ORDER BY entry_id DESC").all(userId) as { book_id: number; status: number }[];
  if (!shelf.length) return [];
  // Read, reading and did-not-finish books aren't suggested.
  const done = new Set(shelf.filter((r) => [2, 3, 5].includes(r.status)).map((r) => r.book_id));
  const recent = shelf.filter((r) => r.status === 3 || r.status === 2).slice(0, 60).map((r) => r.book_id);
  if (!recent.length) return [];
  const hc = hardcover();
  const books = await hc.books.getMany(recent);
  const order = new Map(recent.map((id, i) => [id, i]));
  const series = new Map<number, { at: number; maxPos: number }>();
  for (const b of books as unknown as { id: number; cachedFeaturedSeries?: { series?: { id?: number }; position?: number | string | null } | null }[]) {
    const fs = b.cachedFeaturedSeries;
    const id = fs?.series?.id;
    const pos = Number(fs?.position);
    if (!id || !Number.isFinite(pos)) continue;
    const cur = series.get(id);
    const at = order.get(b.id) ?? 999;
    series.set(id, { at: Math.min(cur?.at ?? at, at), maxPos: Math.max(cur?.maxPos ?? pos, pos) });
  }
  const picks = [...series.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, Math.min(limit, 24));
  const out = await Promise.all(
    picks.map(async ([id, { maxPos }]) => {
      const entries = (await hc.series.books(id, { limit: 50 }).catch(() => null))?.items ?? [];
      const next = entries.find((e) => {
        const pos = Number(e.position);
        return e.book && Number.isInteger(pos) && pos > maxPos && !e.compilation && !done.has(e.book.id);
      });
      return next?.book ? summarizeBook(next.book) : null;
    }),
  );
  return out.filter((b): b is HcSummary => !!b);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The most-read books Hardcover tags with a genre. Search can only match words, so hits are checked for the exact genre. */
async function genreBooks(name: string, limit: number): Promise<HcSummary[]> {
  const want = norm(name);
  const exact: HcSummary[] = [];
  const loose: HcSummary[] = [];
  const perPage = 50;
  for (let page = 1; page <= 4 && exact.length < limit; page++) {
    const res = await hardcover().search.books(name, { fields: "genres", weights: "1", typos: "0", sort: "users_count:desc", perPage, page });
    for (const h of res.hits) {
      const book: HcSummary = {
        id: Number(h.id),
        slug: h.slug ?? null,
        title: h.title ?? "Untitled",
        subtitle: h.subtitle ?? null,
        authors: h.authorNames ?? [],
        coverUrl: h.image?.url ?? null,
        releaseYear: h.releaseYear ?? null,
        seriesName: h.seriesNames?.[0] ?? null,
        seriesPosition: h.featuredSeriesPosition ?? null,
        hasAudiobook: h.hasAudiobook ?? null,
        rating: h.rating ?? null,
        ratingsCount: h.ratingsCount ?? null,
      };
      ((h.genres ?? []).some((g) => norm(g) === want) ? exact : loose).push(book);
    }
    if (res.hits.length < perPage) break;
  }
  // Older search results may not carry genres; then trust the search.
  return (exact.length >= Math.min(8, limit) ? exact : [...exact, ...loose]).slice(0, limit);
}

/** Books from the reader's Hardcover vibes, taking turns between vibes. Needs their own Hardcover token. */
async function vibeBooks(userId: number, limit: number): Promise<HcSummary[]> {
  const u = getUser(userId);
  const token = u ? toReader(u).hardcoverToken : "";
  if (!token) return [];
  const hc = hardcover(token);
  const vibes = (await hc.vibes.mine({ limit: 10 })).items.slice(0, 6);
  const lists = await Promise.all(vibes.map((v) => hc.vibes.books(v.id, { limit }).then((b) => b.items.map(summarizeBook)).catch(() => [] as HcSummary[])));
  const out: HcSummary[] = [];
  const seen = new Set<number>();
  for (let i = 0; out.length < limit * 2 && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const b = l[i];
      if (b && !seen.has(b.id)) {
        seen.add(b.id);
        out.push(b);
      }
    }
  }
  return out;
}

/** One row's books. `key` is a built-in id, list-<id> or genre-<slug>. `limit` is bigger on the row's own page. */
export async function discoverRow(key: string, userId: number, limit = ROW) {
  const hc = () => hardcover();
  const L = limit;
  const list = key.match(/^list-(\d+)$/);
  if (list) {
    const id = Number(list[1]);
    return annotate(await cached(key, async () => (await fetchList(id)).books.map(fromList)), userId).slice(0, limit === ROW ? 30 : 200);
  }
  const genre = key.match(/^genre-(.+)$/);
  if (genre) {
    const g = genreBySlug.get(genre[1]);
    if (!g) throw new Error("No such row");
    return annotate(await cached(`${key}:${L}`, () => genreBooks(g.name, L)), userId);
  }
  switch (key as BuiltinId) {
    case "continue":
      return annotate(await cached(`continue:${userId}:${L}`, () => continueSeries(userId, L)), userId);
    case "prompt": {
      const p = await loadFeaturedPrompt();
      if (!p) return [];
      return annotate(await cached(`prompt:${p.id}:${L}`, async () => (await hc().prompts.books(p.id, { limit: L })).items.map((x) => summarizeBook(x.book))), userId);
    }
    case "foryou":
      return annotate(await cached(`foryou:${userId}:${L}`, () => vibeBooks(userId, L)), userId)
        .filter((b) => !b.absItemId)
        .slice(0, L);
    case "trending":
      return annotate(await cached(`${key}:${L}`, async () => (await hc().books.trending({ duration: "three_month", limit: L })).items.map(summarizeBook)), userId);
    case "week":
      return annotate(await cached(`${key}:${L}`, async () => (await hc().books.trending({ duration: "week", limit: L })).items.map(summarizeBook)), userId);
    case "year":
      return annotate(await cached(`${key}:${L}`, async () => (await hc().books.trending({ duration: "one_year", limit: L })).items.map(summarizeBook)), userId);
    case "new":
      return annotate(await cached(`${key}:${L}`, async () => query("DiscoverRecent", "release_date: { _gte: $from, _lte: $to }", "[{ users_count: desc_nulls_last }]", { from: daysFromNow(-90), to: daysFromNow(0) }, L)), userId);
    case "soon":
      return annotate(await cached(`${key}:${L}`, async () => query("DiscoverUpcoming", "release_date: { _gt: $from, _lte: $to }", "[{ users_count: desc_nulls_last }]", { from: daysFromNow(0), to: daysFromNow(365) }, L)), userId);
    case "toprated":
      return annotate(
        await cached(`${key}:${L}`, () =>
          query(
            "DiscoverTopRated",
            "release_date: { _gte: $from, _lte: $to }, ratings_count: { _gte: 25 }",
            "[{ rating: desc_nulls_last }, { ratings_count: desc }]",
            { from: daysFromNow(-365), to: daysFromNow(0) },
            L,
          ),
        ),
        userId,
      );
    case "audio":
      return annotate(
        await cached(`${key}:${L}`, () =>
          query("DiscoverAudio", "release_date: { _gte: $from }, audio_seconds: { _gt: 0 }", "[{ users_count: desc_nulls_last }]", { from: daysFromNow(-730) }, L),
        ),
        userId,
      );
    case "authors": {
      const names = libraryAuthors();
      if (!names.length) return [];
      const books = await cached(`authors:${L}:${names.join("|")}`, () =>
        query(
          "DiscoverAuthors",
          "release_date: { _gte: $from, _lte: $to }, contributions: { author: { name: { _in: $names } } }",
          "[{ release_date: desc }]",
          { from: daysFromNow(-365), to: daysFromNow(180), names },
          L * 2,
        ),
      );
      // Only books you don't already have.
      return annotate(books, userId)
        .filter((b) => !b.absItemId)
        .slice(0, L);
    }
    case "want": {
      const ids = (
        db.prepare("SELECT book_id FROM hc_library WHERE user_id = ? AND status = 1 ORDER BY refreshed_at DESC").all(userId) as { book_id: number }[]
      ).map((r) => r.book_id);
      const have = inLibrary(ids);
      const missing = ids.filter((i) => !have.has(i)).slice(0, L * 2);
      if (!missing.length) return [];
      const books = await cached(`want:${missing.join(",")}`, async () => (await hc().books.getMany(missing)).map(summarizeBook));
      return annotate(books, userId).slice(0, L);
    }
    case "added":
      return recentlyAdded(L).map((r) => ({
        id: r.hcBook?.id ?? 0,
        slug: r.hcBook?.slug ?? null,
        title: r.title,
        subtitle: null,
        authors: r.authors,
        coverUrl: r.coverUrl,
        releaseYear: r.hcBook?.releaseYear ?? null,
        seriesName: r.hcBook?.seriesName ?? null,
        seriesPosition: r.hcBook?.seriesPosition ?? null,
        hasAudiobook: true,
        absItemId: r.absItemId,
        addedAt: r.addedAt,
        requests: {},
        mine: r.hcBook ? (myShelfStatus([r.hcBook.id], userId).get(r.hcBook.id) ?? null) : null,
      }));
    case "requests": {
      const rows = db
        .prepare(
          `SELECT r.hc_book_id, MAX(r.requested_at) AS at, r.title, r.authors, r.slug, r.cover_url, r.release_year FROM requests r
           JOIN request_users ru ON ru.request_id = r.id WHERE ru.user_id = ? GROUP BY r.hc_book_id ORDER BY at DESC LIMIT ?`,
        )
        .all(userId, L) as { hc_book_id: number; title: string; authors: string; slug: string | null; cover_url: string | null; release_year: number | null }[];
      return annotate(
        rows.map((r) => ({
          id: r.hc_book_id,
          slug: r.slug,
          title: r.title,
          subtitle: null,
          authors: json<string[]>(r.authors, []),
          coverUrl: r.cover_url,
          releaseYear: r.release_year,
          seriesName: null,
          seriesPosition: null,
          hasAudiobook: null,
        })),
        userId,
      );
    }
    default:
      throw new Error("No such row");
  }
}
