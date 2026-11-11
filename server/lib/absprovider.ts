/**
 * Shelfhelp as an Audiobookshelf custom metadata provider.
 *
 * Audiobookshelf calls GET <provider url>/search?query=&author=&isbn=&mediaType=book
 * with the provider's key in the Authorization header, and gives it 10 seconds.
 * Quick Match takes the first match, so the most likely audiobook edition goes first.
 *
 * Unlike a book-level provider, each edition on Hardcover becomes its own match,
 * so the publisher, ISBN or ASIN, cover (and for audiobooks the narrator and
 * length) belong to that edition. The title, author, description, series and
 * genres come from the book.
 *
 * There are two providers: one for audiobook libraries (audiobook editions) at
 * /api/abs-provider, and one for ebook libraries (ebook editions, then print)
 * at /api/abs-provider/books. Audiobookshelf can't tell Shelfhelp which kind of
 * library is asking, so each library picks the provider it wants.
 */
import { timingSafeEqual, randomBytes } from "node:crypto";
import { Abs } from "./abs.js";
import { db } from "./db.js";
import { authorsOf, bookEditions, hardcover, searchBooks, type HcEdition } from "./hardcover.js";
import { authorSimilarity, normalizeIsbn, splitAuthors, titleSimilarity, titleVariants } from "./normalize.js";
import { getSettings, internal, type Settings } from "./settings.js";

/** One match in Audiobookshelf's custom provider format. Duration is in minutes, as ABS compares it (its Audible provider does the same). */
export interface AbsMatch {
  title: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  publisher?: string;
  publishedYear?: string;
  description?: string;
  cover?: string;
  isbn?: string;
  asin?: string;
  genres?: string[];
  tags?: string[];
  series?: { series: string; sequence?: string }[];
  language?: string;
  duration?: number;
}

/** Path Audiobookshelf calls, under the address it uses to reach Shelfhelp. */
export const PROVIDER_PATH = "/api/abs-provider";
export type ProviderKind = "audio" | "books";
export const PROVIDER_KINDS: ProviderKind[] = ["audio", "books"];
const KIND_PATH: Record<ProviderKind, string> = { audio: "", books: "/books" };
export const PROVIDER_NAMES: Record<ProviderKind, string> = { audio: "Hardcover audiobooks (Shelfhelp)", books: "Hardcover books (Shelfhelp)" };
/** Audiobookshelf waits 10 seconds; answer with what's ready before then. */
const DEADLINE_MS = 8_000;
const MAX_BOOKS = 4;
const EDITIONS_PER_BOOK = 10;

// ---------------------------------------------------------------------------
// Key

export const providerKey = () => internal("absProviderKey", () => randomBytes(24).toString("base64url"));

export function rotateProviderKey(): string {
  db.prepare("DELETE FROM settings WHERE key = ?").run("_absProviderKey");
  return providerKey();
}

/** Audiobookshelf sends the key as typed in its settings; accept a "Bearer " prefix too. */
export function keyMatches(header: string | undefined): boolean {
  const got = Buffer.from((header ?? "").replace(/^Bearer\s+/i, "").trim());
  const want = Buffer.from(providerKey());
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The URL Audiobookshelf calls, from the address saved in Settings. */
export function providerUrl(s: Settings = getSettings(), kind: ProviderKind = "audio"): string | null {
  const base = s.absProviderAddress.trim().replace(/\/+$/, "");
  return base ? `${base}${PROVIDER_PATH}${KIND_PATH[kind]}` : null;
}

// ---------------------------------------------------------------------------
// Last request, for Settings

export interface ProviderRequest {
  at: number;
  kind: ProviderKind;
  query: string;
  author: string | null;
  matches: number;
  ms: number;
  error: string | null;
}
let last: ProviderRequest | null = null;
export const lastProviderRequest = () => last;

/** The last search turned away, so Test can tell a wrong key from an unreachable address. */
let rejected: { at: number; reason: "key" | "off" } | null = null;
export const noteRejected = (reason: "key" | "off") => {
  rejected = { at: Date.now(), reason };
};

// ---------------------------------------------------------------------------
// Book details

type BookDetail = {
  id: number;
  title?: string | null;
  subtitle?: string | null;
  releaseYear?: number | null;
  rating?: number | null;
  ratingsCount?: number | null;
  usersCount?: number | null;
  description?: string | null;
  cachedImage?: { url?: string | null } | null;
  cachedTags?: unknown;
  cachedContributors?: Parameters<typeof authorsOf>[0];
  cachedFeaturedSeries?: { series?: { name?: string | null } | null; position?: number | string | null } | null;
  contributions?: { contribution?: string | null; author?: { name?: string | null } | null }[] | null;
  bookSeries?: { position?: number | string | null; series?: { name?: string | null } | null }[] | null;
};

const books = new Map<number, { at: number; book: BookDetail | null }>();

async function bookDetail(id: number): Promise<BookDetail | null> {
  const hit = books.get(id);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.book;
  const book = ((await hardcover().books.get(id)) as BookDetail | null) ?? null;
  books.set(id, { at: Date.now(), book });
  return book;
}

/** The book's top tags in one cached_tags category ("Genre", "Mood"). */
function tagNames(cached: unknown, category: string, limit: number): string[] {
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
  const out: string[] = [];
  for (const t of list) {
    const name = (typeof t === "string" ? t : (t as { tag?: string })?.tag)?.trim();
    if (!name || /^[\["']|["'\]]$/.test(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Hardcover descriptions are plain text; Audiobookshelf shows HTML, so keep the paragraphs. */
function describe(text: string | null | undefined): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  if (/<\/?(p|br|i|b|em|strong)\b/i.test(t)) return t;
  return t
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function authorsFor(b: BookDetail): string[] {
  const list = (b.contributions ?? []).filter((c) => !c.contribution || /author|writer/i.test(c.contribution));
  const names = list.map((c) => c.author?.name).filter((n): n is string => !!n);
  return names.length ? [...new Set(names)] : authorsOf(b.cachedContributors);
}

function seriesFor(b: BookDetail): AbsMatch["series"] {
  const seq = (p: number | string | null | undefined) => (p === null || p === undefined || p === "" ? undefined : String(p));
  const out = (b.bookSeries ?? [])
    .filter((s) => s.series?.name)
    .map((s) => ({ series: s.series!.name!, ...(seq(s.position) ? { sequence: seq(s.position) } : {}) }));
  if (!out.length && b.cachedFeaturedSeries?.series?.name) {
    const p = seq(b.cachedFeaturedSeries.position);
    out.push({ series: b.cachedFeaturedSeries.series.name, ...(p ? { sequence: p } : {}) });
  }
  const seen = new Set<string>();
  const unique = out.filter((s) => !seen.has(s.series) && seen.add(s.series));
  return unique.length ? unique : undefined;
}

const clean = (m: AbsMatch): AbsMatch => {
  for (const k of Object.keys(m) as (keyof AbsMatch)[]) {
    const v = m[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) delete m[k];
  }
  return m;
};

/** The book-level fields every match of this book shares. */
function bookFields(b: BookDetail, s: Settings): AbsMatch {
  return {
    title: b.title?.trim() || "Untitled",
    subtitle: b.subtitle?.trim() || undefined,
    author: authorsFor(b).join(", ") || undefined,
    description: describe(b.description),
    cover: b.cachedImage?.url ?? undefined,
    genres: tagNames(b.cachedTags, "Genre", 6),
    tags: s.absProviderMoodTags ? tagNames(b.cachedTags, "Mood", 6) : undefined,
    series: seriesFor(b),
    publishedYear: b.releaseYear ? String(b.releaseYear) : undefined,
  };
}

/** One audiobook edition as a match. */
export function editionMatch(b: BookDetail, e: HcEdition, s: Settings): AbsMatch {
  const base = bookFields(b, s);
  return clean({
    ...base,
    narrator: e.narrators.join(", ") || undefined,
    publisher: e.publisher ?? undefined,
    publishedYear: e.releaseDate?.slice(0, 4) || base.publishedYear,
    cover: e.coverUrl ?? base.cover,
    isbn: e.isbn13 ?? e.isbn10 ?? undefined,
    asin: e.asin ?? undefined,
    language: e.language ?? undefined,
    duration: e.audioSeconds ? Math.round(e.audioSeconds / 60) : undefined,
  });
}

const sameLanguage = (want: string, got: string | null) => !want || !got || got.trim().toLowerCase() === want.trim().toLowerCase();

const BOOK_FORMAT_RANK: Record<HcEdition["format"], number> = { ebook: 0, print: 1, audiobook: 2 };

/** A book's ebook and print editions: ebooks first, then most read. */
export function textEditions(editions: HcEdition[], language: string): HcEdition[] {
  return editions
    .filter((e) => e.format !== "audiobook" && sameLanguage(language, e.language))
    .sort((a, b) => BOOK_FORMAT_RANK[a.format] - BOOK_FORMAT_RANK[b.format] || b.readers - a.readers);
}

/** A match plus what kind of edition it came from, for the Settings preview. */
export interface Found {
  match: AbsMatch;
  edition: string | null;
  /** How popular the book and this edition are on Hardcover. Audiobookshelf has no field for it. */
  popularity: Popularity;
}

export interface Popularity {
  rating: number | null;
  ratings: number | null;
  bookReaders: number | null;
  editionReaders: number | null;
}

const popularity = (b: BookDetail, e?: HcEdition): Popularity => ({
  rating: b.rating ? Math.round(b.rating * 100) / 100 : null,
  ratings: b.ratingsCount ?? null,
  bookReaders: b.usersCount ?? null,
  editionReaders: e ? e.readers : null,
});

const editionLabel = (e: HcEdition) => e.editionFormat?.trim() || { audiobook: "Audiobook", ebook: "Ebook", print: "Print" }[e.format];

/** A book's audiobook editions, most read first (ones with a length ahead on ties). */
export function audioEditions(editions: HcEdition[], language: string): HcEdition[] {
  return editions
    .filter((e) => e.format === "audiobook" && sameLanguage(language, e.language))
    .sort((a, b) => b.readers - a.readers || Number(!!b.audioSeconds) - Number(!!a.audioSeconds));
}

/**
 * Every match for one book: its audiobook editions (audio provider) or its ebook
 * and print editions (books provider), else (if allowed) the book itself.
 */
async function matchesForBook(bookId: number, s: Settings, kind: ProviderKind, firstEdition?: number, forceFirst = false): Promise<Found[]> {
  const [b, editions] = await Promise.all([bookDetail(bookId), bookEditions(bookId).catch(() => [] as HcEdition[])]);
  if (!b) return [];
  let list = kind === "audio" ? audioEditions(editions, s.absProviderLanguage) : textEditions(editions, s.absProviderLanguage);
  if (firstEdition) {
    // A pasted ASIN or ISBN: that edition first, whatever its format.
    // The book's own ISBN only moves its edition up when it's the provider's kind of edition.
    const picked = editions.find((e) => e.id === firstEdition);
    if (picked && (forceFirst || list.includes(picked))) list = [picked, ...list.filter((e) => e.id !== firstEdition)];
  }
  if (list.length) return list.slice(0, EDITIONS_PER_BOOK).map((e) => ({ match: editionMatch(b, e, s), edition: editionLabel(e), popularity: popularity(b, e) }));
  return s.absProviderBookFallback ? [{ match: clean(bookFields(b, s)), edition: null, popularity: popularity(b) }] : [];
}

// ---------------------------------------------------------------------------
// Finding the books

/** Editions with this ASIN or ISBN: [bookId, editionId]. */
async function byCode(codes: string[]): Promise<[number, number][]> {
  if (!codes.length) return [];
  const data = await hardcover().graphql<{ editions: { id: number; book_id: number }[] }>(
    `query ProviderEditionsByCode($codes: [String!]!) {
      editions(where: { _or: [{ asin: { _in: $codes } }, { isbn_13: { _in: $codes } }, { isbn_10: { _in: $codes } }] }, limit: 10) { id book_id }
    }`,
    { codes },
  );
  return data.editions.map((e) => [e.book_id, e.id]);
}

/** The books a title and author most likely mean, best first. */
async function byTitle(query: string, author: string | null): Promise<number[]> {
  const q = query.trim();
  if (!q) return [];
  let hits = await searchBooks(author ? `${q} ${author}` : q, 15);
  if (!hits.length && author) hits = await searchBooks(q, 15);
  const want = titleVariants(q);
  const authors = author ? splitAuthors(author) : [];
  const scored = hits.map((h, i) => {
    const t = titleSimilarity(want, titleVariants(h.title, h.subtitle));
    const a = authors.length ? (authorSimilarity(authors, h.authors) ?? 0.5) : 0.5;
    // Search order breaks ties; it already favors popular books.
    return { id: h.id, score: t * 0.65 + a * 0.35 - i * 0.002, t };
  });
  const good = scored.filter((x) => x.t >= 0.5).sort((a, b) => b.score - a.score);
  // Nothing close is better than a wrong book: Quick Match applies the first match without asking.
  return good.slice(0, MAX_BOOKS).map((x) => x.id);
}

/** Runs `fn` for each id in order, stopping at the deadline with what's done. */
async function untilDeadline<T>(ids: T[], fn: (id: T) => Promise<Found[]>, deadline: number): Promise<Found[]> {
  const pending = ids.map((id) => fn(id).catch(() => [] as Found[]));
  const out: Found[] = [];
  for (const p of pending) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const got = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), left))]);
    if (got === null) break;
    out.push(...got);
  }
  return out;
}

type SearchInput = { query: string; author?: string | null; isbn?: string | null };

/** What Audiobookshelf gets for a search. */
export async function providerSearch(input: SearchInput, kind: ProviderKind = "audio"): Promise<AbsMatch[]> {
  return (await findMatches(input, kind)).map((f) => f.match);
}

/** The matches for a search, with each one's edition format. */
export async function findMatches(input: SearchInput, kind: ProviderKind = "audio"): Promise<Found[]> {
  const s = getSettings();
  const deadline = Date.now() + DEADLINE_MS;
  const query = (input.query ?? "").trim();
  const author = input.author?.trim() || null;
  // An ASIN or ISBN pasted into the title box answers on its own.
  const typed = (/^B0[A-Z0-9]{8}$/i.test(query) ? query.toUpperCase() : null) ?? normalizeIsbn(/^[\d\s-]+X?$/i.test(query) ? query : null);
  const own = normalizeIsbn(input.isbn);
  const codes = [...new Set([typed, own].filter((c): c is string => !!c))];
  const found = await byCode(codes).catch(() => [] as [number, number][]);
  const seen = new Set<number>();
  const fromCodes = found.filter(([book]) => !seen.has(book) && seen.add(book));
  const out = await untilDeadline(fromCodes, ([book, edition]) => matchesForBook(book, s, kind, edition, !!typed), deadline);
  if (!typed && query) {
    const ids = (await byTitle(query, author)).filter((id) => !seen.has(id));
    out.push(...(await untilDeadline(ids, (id) => matchesForBook(id, s, kind), deadline)));
  }
  return out.slice(0, 30);
}

/** Runs a search for Audiobookshelf and records it for Settings. */
export async function answerAbs(input: SearchInput, kind: ProviderKind = "audio"): Promise<AbsMatch[]> {
  const started = Date.now();
  try {
    const matches = await providerSearch(input, kind);
    last = { at: Date.now(), kind, query: input.query, author: input.author ?? null, matches: matches.length, ms: Date.now() - started, error: null };
    return matches;
  } catch (err) {
    last = { at: Date.now(), kind, query: input.query, author: input.author ?? null, matches: 0, ms: Date.now() - started, error: (err as Error).message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Adding Shelfhelp to Audiobookshelf

interface AbsProvider {
  id: string;
  name: string;
  mediaType: string;
  url: string;
  authHeaderValue?: string | null;
}

/** Which of Shelfhelp's providers an Audiobookshelf entry is, or null if it isn't Shelfhelp's. */
export function kindOf(p: AbsProvider): ProviderKind | null {
  const m = p.url.trim().match(/\/api\/abs-provider(\/books)?\/?$/);
  return m ? (m[1] ? "books" : "audio") : null;
}

/** Shelfhelp's entries in Audiobookshelf's custom providers. Needs an admin API key. */
export async function registeredProviders(): Promise<AbsProvider[]> {
  const data = await new Abs().request<{ providers: AbsProvider[] }>("GET", "/api/custom-metadata-providers");
  return (data.providers ?? []).filter((p) => kindOf(p) !== null);
}

/** Whether Audiobookshelf's entry sends the current key. If ABS ever hides keys, trust the entry Shelfhelp made with it. */
export const hasCurrentKey = (p: AbsProvider) => (p.authHeaderValue === undefined ? madeWithCurrentKey(p.id) : p.authHeaderValue === providerKey());

/** Whether Audiobookshelf has exactly one current entry for each provider, at this address with this key. */
export function upToDate(ours: AbsProvider[], s: Settings = getSettings()): boolean {
  return PROVIDER_KINDS.every((kind) => {
    const mine = ours.filter((p) => kindOf(p) === kind);
    return mine.length === 1 && mine[0].url.replace(/\/+$/, "") === providerUrl(s, kind) && mine[0].mediaType === "book" && hasCurrentKey(mine[0]);
  });
}

/**
 * Adds both of Shelfhelp's providers to Audiobookshelf, replacing older
 * Shelfhelp entries. Audiobookshelf can't edit a provider, and removing one
 * sends libraries that used it as their default back to Google Books, so those
 * libraries are pointed at the new entry of the same kind again.
 */
export async function registerWithAbs(): Promise<{ providers: AbsProvider[]; added: number; replaced: number; librariesKept: number; unchanged: boolean }> {
  const s = getSettings();
  if (!providerUrl(s)) throw new Error("Enter the address Audiobookshelf uses to reach Shelfhelp first.");
  const abs = new Abs();
  const key = providerKey();
  const ours = await registeredProviders();
  let libs: { id: string; provider?: string }[] | null = null;
  const result = { providers: [] as AbsProvider[], added: 0, replaced: 0, librariesKept: 0, unchanged: false };
  for (const kind of PROVIDER_KINDS) {
    const url = providerUrl(s, kind)!;
    const mine = ours.filter((p) => kindOf(p) === kind);
    const same = mine.find((p) => p.url.replace(/\/+$/, "") === url && p.mediaType === "book" && hasCurrentKey(p));
    if (same && mine.length === 1) {
      result.providers.push(same);
      continue;
    }
    libs ??= (await abs.request<{ libraries: { id: string; provider?: string }[] }>("GET", "/api/libraries")).libraries ?? [];
    const usedBy = libs.filter((l) => mine.some((p) => l.provider === `custom-${p.id}`)).map((l) => l.id);
    // New entry first, then move libraries over, then remove the old one, so a failure never leaves none.
    const { provider } = await abs.request<{ provider: AbsProvider }>("POST", "/api/custom-metadata-providers", {
      name: PROVIDER_NAMES[kind],
      mediaType: "book",
      url,
      authHeaderValue: key,
    });
    markRegistered(provider.id);
    for (const id of usedBy) await abs.request("PATCH", `/api/libraries/${encodeURIComponent(id)}`, { provider: `custom-${provider.id}` }).catch(() => {});
    for (const p of mine) await abs.request("DELETE", `/api/custom-metadata-providers/${encodeURIComponent(p.id)}`);
    result.providers.push(provider);
    result.added++;
    result.replaced += mine.length;
    result.librariesKept += usedBy.length;
  }
  result.unchanged = result.added === 0;
  return result;
}

/** Removes Shelfhelp from Audiobookshelf's custom providers. */
export async function unregisterFromAbs(): Promise<number> {
  const abs = new Abs();
  const ours = await registeredProviders();
  for (const p of ours) await abs.request("DELETE", `/api/custom-metadata-providers/${encodeURIComponent(p.id)}`);
  return ours.length;
}

// Which provider entries Shelfhelp made, and with which key.
function madeIds(): string[] {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("_absProviderRegistered") as { value: string } | undefined;
  if (!row) return [];
  const v = JSON.parse(row.value) as unknown;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
}
function markRegistered(id: string) {
  const ids = [...madeIds().filter((x) => !x.startsWith(`${id}:`)), `${id}:${providerKey().slice(0, 6)}`].slice(-10);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("_absProviderRegistered", JSON.stringify(ids));
}
function madeWithCurrentKey(id: string) {
  return madeIds().includes(`${id}:${providerKey().slice(0, 6)}`);
}

/**
 * Asks Audiobookshelf to search through one of Shelfhelp's providers, the same
 * way Match does. Proves Audiobookshelf can reach Shelfhelp at the saved address with the key.
 */
export async function testThroughAbs(title: string, author: string | null, kind: ProviderKind = "audio") {
  const ours = (await registeredProviders()).filter((p) => kindOf(p) === kind);
  if (!ours.length) throw new Error(`"${PROVIDER_NAMES[kind]}" isn't in Audiobookshelf's custom providers yet. Press Add to Audiobookshelf first.`);
  const before = Date.now() - 1;
  const q = new URLSearchParams({ provider: `custom-${ours[0].id}`, title, ...(author ? { author } : {}) });
  const results = await new Abs().request<AbsMatch[]>("GET", `/api/search/books?${q}`);
  const reached = (last?.at ?? 0) > before && last?.kind === kind;
  if (!reached && rejected && rejected.at > before) {
    throw new Error(
      rejected.reason === "off"
        ? "Audiobookshelf reached Shelfhelp, but the provider is turned off. Turn it on and save."
        : "Audiobookshelf reached Shelfhelp, but with an old key. Press Add again to update it.",
    );
  }
  if (!reached) {
    throw new Error(
      `Audiobookshelf couldn't reach Shelfhelp at ${ours[0].url}. Check the address: it has to work from inside Audiobookshelf's container, and not go through a login page like Cloudflare Access.`,
    );
  }
  if (last?.error) throw new Error(`Audiobookshelf reached Shelfhelp, but the search failed: ${last.error}`);
  return { results: Array.isArray(results) ? results : [], url: ours[0].url };
}
