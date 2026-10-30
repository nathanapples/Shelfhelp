/**
 * Rows for the Discover page. Admins set the default rows; anyone can pick
 * their own. A row is either one of the built-in rows below or a Hardcover
 * list. Hardcover answers are cached for a few hours.
 */
import { db, json } from "./db.js";
import { fetchList, hardcover, missingScopes, resolveList, type ListBook } from "./hardcover.js";
import { inLibrary, requestsFor, summarizeBook, type HcSummary } from "./requests.js";
import { myShelfStatus, refreshShelves } from "./reading.js";
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

export type TagKind = "genre" | "mood";
export interface Tag {
  slug: string;
  name: string;
}
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tagList = (names: string[]) => names.map((name) => ({ slug: slugify(name), name }));

/**
 * Hardcover's top 20 genres and moods (the first BROWSE_DEFAULT are the defaults to browse), by
 * number of books (hardcover.app/browse/tags/genre and /mood, 2026-10-28;
 * "General" is skipped as a catch-all). Tags are matched ignoring case,
 * spaces and dashes. Admins and readers can change the chips in Customize.
 */
export const TAGS: Record<TagKind, Tag[]> = {
  genre: tagList([
    "Fiction", "Fantasy", "Young Adult", "Adventure", "Science Fiction", "Comics", "Classics", "History", "Romance", "LGBTQ",
    "War", "Juvenile Fiction", "Biography", "Comics & Graphic Novels", "Mystery", "Religion", "Dystopian", "Nonfiction", "Biography & Autobiography", "Philosophy",
  ]),
  mood: tagList([
    "Adventurous", "Emotional", "Dark", "Mysterious", "Tense", "Funny", "Reflective", "Lighthearted", "Sad", "Hopeful",
    "Challenging", "Inspiring", "Informative", "Relaxing", "Fast-Paced", "Medium-Paced", "Suspenseful", "Slow-Paced", "Humorous", "Thought-Provoking",
  ]),
};
/** How many of the top genres and moods Discover's Browse sections show by default. */
export const BROWSE_DEFAULT = 15;
const defaultTags = (kind: TagKind) => TAGS[kind].slice(0, BROWSE_DEFAULT);
/** A saved chip list that's exactly the old built-in top 20 counts as "the defaults". */
const isOldDefault = (kind: TagKind, list: Tag[] | null) =>
  !!list && list.length === TAGS[kind].length && list.every((t, i) => t.slug === TAGS[kind][i].slug);

/** Which Browse sections show at the bottom of Discover. */
export interface BrowseShow {
  genre: boolean;
  mood: boolean;
}
const SHOW_ALL: BrowseShow = { genre: true, mood: true };
function cleanShow(v: unknown): BrowseShow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<Record<keyof BrowseShow, unknown>>;
  return { genre: o.genre !== false, mood: o.mood !== false };
}

// Genres offered before, still known by name in rows people saved.
const OLD_GENRES = tagList(["Thriller", "Horror", "Historical Fiction", "Literary Fiction", "Self Help", "Humor"]);
const known: Record<TagKind, Map<string, Tag>> = {
  genre: new Map([...TAGS.genre, ...OLD_GENRES].map((g) => [g.slug, g])),
  mood: new Map(TAGS.mood.map((g) => [g.slug, g])),
};

/** A tag's name from its slug: the built-in ones, Hardcover's full list, or a name saved with it. */
function tagName(kind: TagKind, slug: string, saved?: string | null): string | null {
  return known[kind].get(slug)?.name ?? allTagsCache[kind]?.tags.find((t) => t.slug === slug)?.name ?? (saved?.trim() || null);
}

const allTagsCache: Partial<Record<TagKind, { at: number; tags: (Tag & { count: number })[] }>> = {};

/**
 * Every genre or mood on Hardcover with at least a few books, most books
 * first (up to 600). Cached for a day.
 */
export async function allTags(kind: TagKind): Promise<(Tag & { count: number })[]> {
  const hit = allTagsCache[kind];
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.tags;
  const out: (Tag & { count: number })[] = [];
  for (let offset = 0; offset < 600; offset += 200) {
    const data = await hardcover().graphql<{ tags: { tag: string; slug: string | null; count: number | null }[] }>(
      `query AllTags($category: String!, $limit: Int!, $offset: Int!) {
         tags(where: { tag_category: { slug: { _eq: $category } }, count: { _gte: 5 } }, order_by: { count: desc }, limit: $limit, offset: $offset) {
           tag slug count
         }
       }`,
      { category: kind, limit: 200, offset },
    );
    for (const t of data.tags) {
      const name = t.tag?.trim();
      // Hardcover's lists hold some stray quoted or bracketed entries; skip those.
      if (!name || /^[\["']|["'\]]$/.test(name)) continue;
      out.push({ slug: t.slug || slugify(name), name, count: t.count ?? 0 });
    }
    if (data.tags.length < 200) break;
  }
  // One entry per slug, keeping the one with the most books.
  const seen = new Set<string>();
  const tags = out.filter((t) => !seen.has(t.slug) && seen.add(t.slug));
  allTagsCache[kind] = { at: Date.now(), tags };
  return tags;
}

/** Cleans a saved list of tags; unknown ones need a name saved with them. */
function cleanTags(kind: TagKind, list: unknown): Tag[] | null {
  if (!Array.isArray(list)) return null;
  const out: Tag[] = [];
  for (const t of list as (Tag | string)[]) {
    const slug = typeof t === "string" ? t : t?.slug;
    if (!slug || out.some((x) => x.slug === slug)) continue;
    const name = tagName(kind, slug, typeof t === "string" ? null : t.name);
    if (name) out.push({ slug, name });
  }
  return out;
}

export type RowConfig =
  | { key: string; kind: "builtin"; id: BuiltinId }
  | { key: string; kind: "list"; listId: number; title: string; owner?: string | null; slug?: string | null }
  | { key: string; kind: TagKind; tag: string; name: string };

const tagRow = (kind: TagKind, slug: string, name: string): RowConfig => ({ key: `${kind}-${slug}`, kind, tag: slug, name });

const builtin = (id: BuiltinId): RowConfig => ({ key: id, kind: "builtin", id });
/** Modeled on Hardcover's own Discover page: picks for you, trending, series to continue, then new and upcoming. */
export const STARTER_ROWS: RowConfig[] = (["foryou", "trending", "continue", "want", "new", "authors", "toprated", "added"] as BuiltinId[]).map(builtin);

function valid(rows: unknown): RowConfig[] | null {
  if (!Array.isArray(rows)) return null;
  const out: RowConfig[] = [];
  const seen = new Set<string>();
  for (const r of rows as RowConfig[]) {
    if (!r || seen.has(r.key)) continue;
    if (r.kind === "builtin" && r.id in BUILTINS) out.push(builtin(r.id));
    else if (r.kind === "list" && Number(r.listId) > 0) {
      out.push({ key: `list-${Number(r.listId)}`, kind: "list", listId: Number(r.listId), title: String(r.title || "Hardcover list"), owner: r.owner ?? null, slug: r.slug ?? null });
    } else if (r.kind === "genre" || r.kind === "mood") {
      // Rows saved before 0.11.0 kept the slug in `genre`.
      const slug = r.tag ?? (r as { genre?: string }).genre ?? "";
      const name = tagName(r.kind, slug, r.name);
      if (!name) continue;
      out.push(tagRow(r.kind, slug, name));
    }
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

export function saveRows(userId: number, rows: unknown, asDefault: boolean, tags?: unknown) {
  const clean = valid(rows) ?? [];
  const t = tags as (Partial<Record<TagKind, unknown>> & { show?: unknown }) | undefined;
  const chips = t
    ? { genre: cleanTags("genre", t.genre) ?? defaultTags("genre"), mood: cleanTags("mood", t.mood) ?? defaultTags("mood"), show: cleanShow(t.show) ?? SHOW_ALL }
    : null;
  if (asDefault) saveSettings({ discoverRows: clean, ...(chips ? { discoverTags: chips } : {}) });
  else updateUser(userId, { discover_rows: JSON.stringify(clean), ...(chips ? { discover_tags: JSON.stringify(chips) } : {}) });
  return clean;
}

export function resetRows(userId: number) {
  updateUser(userId, { discover_rows: null, discover_tags: null });
}

/**
 * The genre and mood chips someone sees in Browse, and which Browse sections
 * show: their own, else the admin's defaults, else the built-in top 15.
 */
export function tagsFor(userId: number): Record<TagKind, Tag[]> & { show: BrowseShow } {
  type Saved = Partial<Record<TagKind, unknown>> & { show?: unknown };
  const own = json<Saved | null>(getUser(userId)?.discover_tags ?? null, null);
  const def = getSettings().discoverTags as Saved | null;
  const saved = (kind: TagKind, v: unknown) => {
    const list = cleanTags(kind, v);
    return isOldDefault(kind, list) ? null : list;
  };
  const pick = (kind: TagKind) => saved(kind, own?.[kind]) ?? saved(kind, def?.[kind]) ?? defaultTags(kind);
  return { genre: pick("genre"), mood: pick("mood"), show: cleanShow(own?.show) ?? cleanShow(def?.show) ?? SHOW_ALL };
}

export function rowInfo(r: RowConfig) {
  if (r.kind === "builtin" && r.id === "prompt" && featured.prompt) {
    return { ...r, title: featured.prompt.question, subtitle: "Hardcover's featured prompt, most picked books first" };
  }
  if (r.kind === "builtin") return { ...r, ...BUILTINS[r.id] };
  if (r.kind === "genre" || r.kind === "mood") {
    const name = r.name;
    const lower = /^[A-Z]+$/.test(name) ? name : name.toLowerCase();
    return {
      ...r,
      title: r.kind === "genre" ? `Top ${name}` : `${name} reads`,
      subtitle: r.kind === "genre" ? `The most-read ${lower} books on Hardcover` : `The most-read books Hardcover readers call ${lower}`,
    };
  }
  const l = r as Extract<RowConfig, { kind: "list" }>;
  return { ...l, subtitle: l.owner ? `A Hardcover list by @${l.owner}` : "A Hardcover list" };
}

export const tagRows = (kind: TagKind, tags: Tag[]) => tags.map((g) => rowInfo(tagRow(kind, g.slug, g.name)));
export const tagRowInfo = (kind: TagKind, slug: string, name: string) => rowInfo(tagRow(kind, slug, name));

/** Title and subtitle for any row key, for its own page. */
export async function rowInfoFor(key: string, userId: number, nameHint?: string | null) {
  const mine = rowsFor(userId).rows.find((r) => r.key === key) ?? defaultRows().find((r) => r.key === key);
  if (mine) return rowInfo(mine);
  if (key in BUILTINS) return rowInfo(builtin(key as BuiltinId));
  const g = key.match(/^(genre|mood)-(.+)$/);
  if (g) {
    const kind = g[1] as TagKind;
    const name = tagName(kind, g[2], nameHint) ?? (await allTags(kind).catch(() => []), tagName(kind, g[2]));
    if (name) return rowInfo(tagRow(kind, g[2], name));
  }
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
  // Empty answers aren't kept, so a row fills in as soon as there's something (new vibes, a connected key).
  if (books.length) cache.set(key, { at: Date.now(), books });
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

/**
 * Authors you listen to most: from your own listening when Shelfhelp has it
 * (reading sync on), else the authors with the most books in Audiobookshelf.
 */
function libraryAuthors(userId: number, limit = 40): string[] {
  const counts = new Map<string, number>();
  const mine = db
    .prepare("SELECT i.authors FROM reading r JOIN abs_items i ON i.id = r.abs_item_id WHERE r.user_id = ?")
    .all(userId) as { authors: string }[];
  const rows = mine.length ? mine : (db.prepare("SELECT authors FROM abs_items").all() as { authors: string }[]);
  for (const r of rows) {
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

/** Rows built from the viewer's own Hardcover account. Hidden until they connect Hardcover. */
export const PERSONAL = new Set(["foryou", "want", "continue"]);
const SHELF_AGE = 6 * 3600_000;

export function hasHardcover(userId: number) {
  const u = getUser(userId);
  return !!(u && toReader(u).hardcoverToken);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Time ranges on genre and mood pages. */
export type TagRange = "all" | "year" | "month";
export const isTagRange = (r: unknown): r is TagRange => r === "all" || r === "year" || r === "month";

/** The tag names in a book's cached_tags for one category ("Genre", "Mood"). */
function tagsOf(cached: unknown, category: string): string[] {
  let v = cached;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  const list = (v as Record<string, unknown> | null)?.[category];
  if (!Array.isArray(list)) return [];
  return list.map((t) => (typeof t === "string" ? t : ((t as { tag?: string })?.tag ?? ""))).filter(Boolean);
}

/**
 * Trending books with a genre or mood, for "This year" and "This month":
 * Hardcover's trending list for that period (up to 500 books), kept in
 * trending order and filtered by the books' genre or mood tags.
 */
async function trendingTagBooks(kind: TagKind, name: string, range: "year" | "month", limit: number): Promise<HcSummary[]> {
  const hc = hardcover();
  const duration = range === "year" ? "one_year" : "month";
  const ids: number[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const r = await hc.graphql<{ books_trending: { ids: (number | null)[] | null } | null }>(
      `query TrendingTagIds($duration: TrendingDuration!, $limit: Int!, $offset: Int!) {
         books_trending(duration: $duration, limit: $limit, offset: $offset) { ids }
       }`,
      { duration, limit: 100, offset },
    );
    const page = (r.books_trending?.ids ?? []).filter((x): x is number => typeof x === "number");
    ids.push(...page);
    if (page.length < 100) break;
  }
  if (!ids.length) return [];
  const data = await hc.graphql<{ books: (object & { id: number; cachedTags?: unknown })[] }>(
    `query TrendingTagBooks($ids: [Int!]!) { books(where: { id: { _in: $ids } }) { ${BOOK_FIELDS} cachedTags: cached_tags } }`,
    { ids },
  );
  const want = norm(name);
  const category = kind === "genre" ? "Genre" : "Mood";
  const order = new Map(ids.map((id, i) => [id, i]));
  return data.books
    .filter((b) => tagsOf(b.cachedTags, category).some((t) => norm(t) === want))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .slice(0, limit)
    .map(summarizeBook);
}

/** The most-read books Hardcover tags with a genre or mood. Search can only match words, so hits are checked for the exact tag. */
async function tagBooks(kind: TagKind, name: string, limit: number): Promise<HcSummary[]> {
  const field = kind === "genre" ? "genres" : "moods";
  const want = norm(name);
  const exact: HcSummary[] = [];
  const loose: HcSummary[] = [];
  const perPage = 50;
  for (let page = 1; page <= 4 && exact.length < limit; page++) {
    const res = await hardcover().search.books(name, { fields: field, weights: "1", typos: "0", sort: "users_count:desc", perPage, page });
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
      ((kind === "genre" ? h.genres : h.moods) ?? []).some((g) => norm(g) === want) ? exact.push(book) : loose.push(book);
    }
    if (res.hits.length < perPage) break;
  }
  // Older search results may not carry the tags; then trust the search.
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

/** One row's books. `key` is a built-in id, list-<id>, genre-<slug> or mood-<slug>. `limit` is bigger on the row's own page. */
export async function discoverRow(key: string, userId: number, limit = ROW, range: TagRange = "month", nameHint?: string | null) {
  // Rows built from your own Hardcover account need your own token.
  if (PERSONAL.has(key) && !hasHardcover(userId)) return [];
  if (!PERSONAL.has(key)) return buildRow(key, userId, limit, range, nameHint);
  try {
    return await buildRow(key, userId, limit, range, nameHint);
  } catch (err) {
    // A key missing permissions: Discover's banner explains it, so the row is just empty.
    if (missingScopes(err, [])) return [];
    throw err;
  }
}

async function buildRow(key: string, userId: number, limit: number, range: TagRange, nameHint?: string | null) {
  const hc = () => hardcover();
  const L = limit;
  const list = key.match(/^list-(\d+)$/);
  if (list) {
    const id = Number(list[1]);
    return annotate(await cached(key, async () => (await fetchList(id)).books.map(fromList)), userId).slice(0, limit === ROW ? 30 : 200);
  }
  const tag = key.match(/^(genre|mood)-(.+)$/);
  if (tag) {
    const kind = tag[1] as TagKind;
    const rowName = rowsFor(userId).rows.find((r) => r.key === key && r.kind !== "builtin" && r.kind !== "list") as { name?: string } | undefined;
    let name = tagName(kind, tag[2], nameHint ?? rowName?.name);
    if (!name) name = (await allTags(kind).catch(() => [])).find((t) => t.slug === tag[2])?.name ?? null;
    if (!name) throw new Error("No such row");
    const g = { name };
    if (range !== "all") {
      const trending = await cached(`${key}:${range}:${L}`, () => trendingTagBooks(kind, g.name, range, L));
      // A Discover row with too little trending falls back to all time; the page shows what it asked for.
      if (trending.length >= 5 || L !== ROW) return annotate(trending, userId);
    }
    return annotate(await cached(`${key}:${L}`, () => tagBooks(kind, g.name, L)), userId);
  }
  switch (key as BuiltinId) {
    case "continue":
      await refreshShelves(userId, SHELF_AGE).catch(() => {});
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
      const names = libraryAuthors(userId);
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
      await refreshShelves(userId, SHELF_AGE).catch(() => {});
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
