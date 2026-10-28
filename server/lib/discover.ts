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
import { getUser, updateUser } from "./users.js";

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
  | "requests";

export const BUILTINS: Record<BuiltinId, { title: string; subtitle: string }> = {
  trending: { title: "Trending this month", subtitle: "What Hardcover readers are picking up" },
  week: { title: "Trending this week", subtitle: "Hardcover's hottest books right now" },
  year: { title: "Popular this year", subtitle: "Trending on Hardcover over the past year" },
  want: { title: "From your Want to Read", subtitle: "On your Hardcover shelf, not in Audiobookshelf yet" },
  new: { title: "New releases", subtitle: "Out in the last month, most popular first" },
  toprated: { title: "Highest rated new books", subtitle: "Released in the last year, best rated on Hardcover" },
  authors: { title: "New from authors you listen to", subtitle: "Recent and upcoming books by authors in your library" },
  audio: { title: "Popular audiobooks", subtitle: "Most-read books with an audiobook, from the last two years" },
  added: { title: "Recently added", subtitle: "Newest in Audiobookshelf" },
  soon: { title: "Coming soon", subtitle: "Releasing in the next two months" },
  requests: { title: "Your recent requests", subtitle: "What you've asked for" },
};

export type RowConfig =
  | { key: string; kind: "builtin"; id: BuiltinId }
  | { key: string; kind: "list"; listId: number; title: string; owner?: string | null; slug?: string | null };

const builtin = (id: BuiltinId): RowConfig => ({ key: id, kind: "builtin", id });
export const STARTER_ROWS: RowConfig[] = (["trending", "want", "new", "added", "authors", "toprated", "soon", "requests"] as BuiltinId[]).map(builtin);

function valid(rows: unknown): RowConfig[] | null {
  if (!Array.isArray(rows)) return null;
  const out: RowConfig[] = [];
  const seen = new Set<string>();
  for (const r of rows as RowConfig[]) {
    if (!r || seen.has(r.key)) continue;
    if (r.kind === "builtin" && r.id in BUILTINS) out.push(builtin(r.id));
    else if (r.kind === "list" && Number(r.listId) > 0) {
      out.push({ key: `list-${Number(r.listId)}`, kind: "list", listId: Number(r.listId), title: String(r.title || "Hardcover list"), owner: r.owner ?? null, slug: r.slug ?? null });
    } else continue;
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
  if (r.kind === "builtin") return { ...r, ...BUILTINS[r.id] };
  return { ...r, subtitle: r.owner ? `A Hardcover list by @${r.owner}` : "A Hardcover list" };
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

async function query(name: string, where: string, order: string, vars: Record<string, unknown>, limit = 20) {
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

/** One row's books. `key` is a built-in id or list-<id>. */
export async function discoverRow(key: string, userId: number) {
  const hc = () => hardcover();
  const list = key.match(/^list-(\d+)$/);
  if (list) {
    const id = Number(list[1]);
    return annotate(await cached(key, async () => (await fetchList(id)).books.slice(0, 30).map(fromList)), userId);
  }
  switch (key as BuiltinId) {
    case "trending":
      return annotate(await cached(key, async () => (await hc().books.trending({ duration: "month", limit: 20 })).items.map(summarizeBook)), userId);
    case "week":
      return annotate(await cached(key, async () => (await hc().books.trending({ duration: "week", limit: 20 })).items.map(summarizeBook)), userId);
    case "year":
      return annotate(await cached(key, async () => (await hc().books.trending({ duration: "one_year", limit: 20 })).items.map(summarizeBook)), userId);
    case "new":
      return annotate(await cached(key, async () => (await hc().books.released({ from: daysFromNow(-30), to: daysFromNow(0), limit: 20 })).items.map(summarizeBook)), userId);
    case "soon":
      return annotate(await cached(key, async () => (await hc().books.released({ from: daysFromNow(1), to: daysFromNow(60), limit: 20 })).items.map(summarizeBook)), userId);
    case "toprated":
      return annotate(
        await cached(key, () =>
          query(
            "DiscoverTopRated",
            "release_date: { _gte: $from, _lte: $to }, ratings_count: { _gte: 25 }",
            "[{ rating: desc_nulls_last }, { ratings_count: desc }]",
            { from: daysFromNow(-365), to: daysFromNow(0) },
          ),
        ),
        userId,
      );
    case "audio":
      return annotate(
        await cached(key, () =>
          query("DiscoverAudio", "release_date: { _gte: $from }, audio_seconds: { _gt: 0 }", "[{ users_count: desc_nulls_last }]", { from: daysFromNow(-730) }),
        ),
        userId,
      );
    case "authors": {
      const names = libraryAuthors();
      if (!names.length) return [];
      const books = await cached(`authors:${names.join("|")}`, () =>
        query(
          "DiscoverAuthors",
          "release_date: { _gte: $from, _lte: $to }, contributions: { author: { name: { _in: $names } } }",
          "[{ release_date: desc }]",
          { from: daysFromNow(-365), to: daysFromNow(180), names },
          40,
        ),
      );
      // Only books you don't already have.
      return annotate(books, userId)
        .filter((b) => !b.absItemId)
        .slice(0, 20);
    }
    case "want": {
      const ids = (
        db.prepare("SELECT book_id FROM hc_library WHERE user_id = ? AND status = 1 ORDER BY refreshed_at DESC").all(userId) as { book_id: number }[]
      ).map((r) => r.book_id);
      const have = inLibrary(ids);
      const missing = ids.filter((i) => !have.has(i)).slice(0, 40);
      if (!missing.length) return [];
      const books = await cached(`want:${missing.join(",")}`, async () => (await hc().books.getMany(missing)).map(summarizeBook));
      return annotate(books, userId).slice(0, 20);
    }
    case "added":
      return recentlyAdded(20).map((r) => ({
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
           JOIN request_users ru ON ru.request_id = r.id WHERE ru.user_id = ? GROUP BY r.hc_book_id ORDER BY at DESC LIMIT 20`,
        )
        .all(userId) as { hc_book_id: number; title: string; authors: string; slug: string | null; cover_url: string | null; release_year: number | null }[];
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
