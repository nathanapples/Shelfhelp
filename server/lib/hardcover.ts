import { HardcoverClient, type CachedContributor, type CachedFeaturedSeries, type CachedImage } from "@hardcover/sdk";
import { config } from "./config.js";
import { getSettings } from "./settings.js";
import { seriesNumber } from "./normalize.js";
import { oauthUserId, sessionFor } from "./hcauth.js";

const clients = new Map<string, HardcoverClient>();

/**
 * A Hardcover client. With no token, the server's own key from Settings (shared
 * data only). A reader's token is either a pasted key or `oauth:<userId>` for
 * someone who signed in with Hardcover, whose tokens refresh themselves.
 */
export function hardcover(token = getSettings().hardcoverToken): HardcoverClient {
  if (!token) throw new Error("Hardcover isn't set up yet. Add the server's Hardcover key in Settings.");
  const userId = oauthUserId(token);
  const key = userId != null ? `${token}|${getSettings().hardcoverClientId}` : token;
  const hit = clients.get(key);
  if (hit) return hit;
  const client = new HardcoverClient({
    ...(userId != null ? { auth: sessionFor(userId) } : { token }),
    ...(process.env.HARDCOVER_ENDPOINT ? { endpoint: process.env.HARDCOVER_ENDPOINT } : {}),
    userAgent: `shelfhelp/${config.version}`,
    onWarning: (m) => console.warn(`[hardcover] ${m}`),
  });
  clients.set(key, client);
  return client;
}

/** Forgets cached clients and checks for a token, after someone signs in again or disconnects. */
export function forgetToken(token: string) {
  for (const k of [...clients.keys()]) if (k === token || k.startsWith(`${token}|`)) clients.delete(k);
  checks.delete(token);
}

export interface ListBook {
  id: number;
  position: number;
  slug: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  releaseYear: number | null;
  audioSeconds: number | null;
}

export interface ListInfo {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  booksCount: number;
  owner: string | null;
  coverUrls: string[];
}

interface BookLike {
  id: number;
  slug?: string | null;
  title?: string | null;
  subtitle?: string | null;
  releaseYear?: number | null;
  audioSeconds?: number | null;
  cachedImage?: CachedImage | null;
  cachedContributors?: CachedContributor[] | null;
  cachedFeaturedSeries?: CachedFeaturedSeries | null;
}

export function authorsOf(contributors: CachedContributor[] | null | undefined): string[] {
  const list = Array.isArray(contributors) ? contributors : [];
  const writers = list.filter((c) => !c.contribution || /author|writer/i.test(c.contribution));
  return [...new Set((writers.length ? writers : list).map((c) => c.author?.name).filter((n): n is string => !!n))];
}

export function toListBook(b: BookLike, position: number): ListBook {
  const fs = b.cachedFeaturedSeries && "series" in b.cachedFeaturedSeries ? b.cachedFeaturedSeries : null;
  return {
    id: b.id,
    position,
    slug: b.slug ?? null,
    title: b.title ?? "Untitled",
    subtitle: b.subtitle ?? null,
    authors: authorsOf(b.cachedContributors),
    seriesName: fs?.series?.name ?? null,
    seriesPosition: seriesNumber(fs?.position ?? fs?.details ?? null),
    coverUrl: b.cachedImage?.url ?? null,
    releaseYear: b.releaseYear ?? null,
    audioSeconds: b.audioSeconds ?? null,
  };
}

/** Every book on a list, in list order. `token` reads a private list as its owner (default: the server's key). */
export async function fetchList(listId: number, token?: string): Promise<{ info: ListInfo; books: ListBook[] }> {
  const hc = token ? hardcover(token) : hardcover();
  const books: ListBook[] = [];
  let info: ListInfo | null = null;
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const list = await hc.lists.get(listId, { limit: pageSize, offset });
    if (!list) throw new Error(`Hardcover list ${listId} wasn't found, or your token can't see it.`);
    if (!info) {
      info = {
        id: list.id,
        slug: list.slug ?? null,
        name: list.name ?? `List ${listId}`,
        description: list.description ?? null,
        booksCount: list.booksCount ?? 0,
        owner: null,
        coverUrls: [],
      };
    }
    const rows = list.listBooks ?? [];
    for (const row of rows) {
      if (!row.book) continue;
      books.push(toListBook(row.book as BookLike, books.length));
    }
    if (rows.length < pageSize) break;
  }
  info!.coverUrls = books.slice(0, 6).map((b) => b.coverUrl).filter((u): u is string => !!u);
  return { info: info!, books };
}

/** Hardcover's reading-status shelves. These aren't lists in the API, so they're a separate source. */
export const SHELVES: Record<number, { name: string; slug: string; description: string }> = {
  1: { name: "Want to Read", slug: "want-to-read", description: "Books on your Want to Read shelf." },
  2: { name: "Currently Reading", slug: "currently-reading", description: "Books you're reading now." },
  3: { name: "Read", slug: "read", description: "Books you've finished." },
  4: { name: "Paused", slug: "paused", description: "Books you've paused." },
  5: { name: "Did Not Finish", slug: "did-not-finish", description: "Books you stopped reading." },
};

/** Someone's Hardcover status shelf, read with their own token. */
export async function fetchShelf(statusId: number, token?: string): Promise<{ info: ListInfo; books: ListBook[] }> {
  const shelf = SHELVES[statusId];
  if (!shelf) throw new Error(`Unknown Hardcover shelf ${statusId}`);
  // The server's own key has no shelves worth reading: shelves always need the person's own connection.
  if (!token) throw new Error("This shelf needs its reader's Hardcover connection. Connect Hardcover in My account.");
  const hc = hardcover(token);
  const books: ListBook[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await hc.library.list({ status: statusId as 1, limit: pageSize, offset });
    for (const entry of page.items) {
      if (!entry.book) continue;
      books.push(toListBook(entry.book as BookLike, books.length));
    }
    if (page.items.length < page.limit) break;
  }
  const me = (await hc.me.get()) as { username?: string };
  return {
    info: {
      id: statusId,
      slug: shelf.slug,
      name: shelf.name,
      description: shelf.description,
      booksCount: books.length,
      owner: me.username ?? null,
      coverUrls: books.slice(0, 6).map((b) => b.coverUrl).filter((u): u is string => !!u),
    },
    books,
  };
}

export type SourceType = "hardcover_list" | "hardcover_status";

export function fetchSource(type: string, id: number, token?: string) {
  return type === "hardcover_status" ? fetchShelf(id, token) : fetchList(id, token);
}

/** Your status shelves with counts and a few covers, for the picker. */
/** "Nathan's Want to Read": the default collection name for a shelf. */
export function shelfCollectionName(username: string | null | undefined, shelf: string) {
  if (!username) return shelf;
  const who = username.charAt(0).toUpperCase() + username.slice(1);
  return `${who}${/s$/i.test(who) ? "'" : "'s"} ${shelf}`;
}

export async function myShelves(token: string) {
  const hc = hardcover(token);
  const me = (await hc.me.get()) as { username?: string };
  const out = [];
  for (const id of [1, 2, 3, 5]) {
    const [count, first] = await Promise.all([hc.library.count({ status: id as 1 }), hc.library.list({ status: id as 1, limit: 4 })]);
    out.push({
      id,
      sourceType: "hardcover_status" as const,
      slug: SHELVES[id].slug,
      name: SHELVES[id].name,
      defaultCollectionName: shelfCollectionName(me.username, SHELVES[id].name),
      description: SHELVES[id].description,
      booksCount: count,
      owner: me.username ?? null,
      coverUrls: first.items.map((e) => (e.book as BookLike | null)?.cachedImage?.url).filter((u): u is string => !!u),
    });
  }
  return out;
}

/** The signed-in user's own lists and the lists they follow. */
export async function myLists(token: string): Promise<(ListInfo & { followed: boolean })[]> {
  const hc = hardcover(token);
  const query = `
    query MyLists($userId: Int!) {
      mine: lists(where: { user_id: { _eq: $userId } }, order_by: { updated_at: desc_nulls_last }, limit: 100) {
        id slug name description books_count
        list_books(order_by: { position: asc }, limit: 4) { book { cached_image } }
      }
      followed: followed_lists(where: { user_id: { _eq: $userId } }, order_by: { created_at: desc }, limit: 100) {
        list {
          id slug name description books_count
          list_books(order_by: { position: asc }, limit: 4) { book { cached_image } }
        }
      }
    }`;
  const userId = await hc.me.id();
  const me = (await hc.me.get()) as { username?: string };
  type Row = {
    id: number;
    slug: string | null;
    name: string;
    description: string | null;
    books_count: number;
    list_books?: { book?: { cached_image?: CachedImage | null } | null }[];
  };
  const data = await hc.graphql<{ mine: Row[]; followed: { list: Row | null }[] }>(query, { userId });
  const shape = (r: Row, followed: boolean) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    booksCount: r.books_count ?? 0,
    owner: followed ? null : (me.username ?? null),
    coverUrls: (r.list_books ?? []).map((lb) => lb.book?.cached_image?.url).filter((u): u is string => !!u),
    followed,
  });
  return [
    ...data.mine.map((r) => shape(r, false)),
    ...data.followed.map((f) => f.list).filter((l): l is Row => !!l).map((r) => shape(r, true)),
  ];
}

/** Accepts a list URL (hardcover.app/@user/lists/slug) or a numeric id. */
export async function resolveList(input: string): Promise<number> {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/@([^/\s]+)\/lists\/([^/?#\s]+)/);
  if (!m) throw new Error("Paste a Hardcover list link, like https://hardcover.app/@you/lists/my-list");
  const [, username, slug] = m;
  const hc = hardcover();
  const users = await hc.graphql<{ users: { id: number }[] }>(
    `query FindUser($username: citext!) { users(where: { username: { _eq: $username } }, limit: 1) { id } }`,
    { username: decodeURIComponent(username) },
  );
  const userId = users.users[0]?.id;
  if (!userId) throw new Error(`Couldn't find the Hardcover user @${username}.`);
  const data = await hc.graphql<{ lists: { id: number }[] }>(
    `query FindList($userId: Int!, $slug: String!) {
       lists(where: { user_id: { _eq: $userId }, slug: { _eq: $slug } }, limit: 1) { id }
     }`,
    { userId, slug: decodeURIComponent(slug) },
  );
  const id = data.lists[0]?.id;
  if (!id) throw new Error(`Couldn't find that list on Hardcover (@${username}/lists/${slug}). Is it private?`);
  return id;
}

/**
 * Which Hardcover books these ASINs and ISBNs belong to: edition ASINs and
 * ISBNs, plus Audible/Amazon ID mappings. Returns [identifier, bookId, via].
 */
export async function lookupIdentifiers(
  asins: string[],
  isbns: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<[string, number, string][]> {
  const hc = hardcover();
  const out: [string, number, string][] = [];
  const chunk = 150;
  const total = Math.max(asins.length, isbns.length);
  for (let i = 0; i < total; i += chunk) {
    onProgress?.(i, total);
    const a = asins.slice(i, i + chunk);
    const n = isbns.slice(i, i + chunk);
    const data = await hc.graphql<{
      byAsin: { asin: string | null; book_id: number }[];
      byIsbn: { isbn_10: string | null; isbn_13: string | null; book_id: number }[];
      audible: { external_id: string; book: { id: number } | null }[];
      amazon: { external_id: string; book: { id: number } | null }[];
    }>(
      `query Identify($asins: [String!]!, $isbns: [String!]!) {
         byAsin: editions(where: { asin: { _in: $asins } }) { asin book_id }
         byIsbn: editions(where: { _or: [{ isbn_13: { _in: $isbns } }, { isbn_10: { _in: $isbns } }] }) { isbn_10 isbn_13 book_id }
         audible: book_mappings(where: { platform_id: { _eq: 32 }, external_id: { _in: $asins } }) { external_id book { id } }
         amazon: book_mappings(where: { platform_id: { _in: [19, 22, 24, 26] }, external_id: { _in: $asins } }) { external_id book { id } }
       }`,
      { asins: a, isbns: n },
    );
    for (const e of data.byAsin) if (e.asin) out.push([`asin:${e.asin.toUpperCase()}`, e.book_id, "asin"]);
    const wanted = new Set(n);
    for (const e of data.byIsbn) {
      for (const code of [e.isbn_13, e.isbn_10]) if (code && wanted.has(code)) out.push([`isbn:${code}`, e.book_id, "isbn"]);
    }
    for (const m of data.audible) if (m.book) out.push([`asin:${m.external_id.toUpperCase()}`, m.book.id, "audible"]);
    for (const m of data.amazon) if (m.book) out.push([`asin:${m.external_id.toUpperCase()}`, m.book.id, "amazon"]);
  }
  return out;
}

export async function searchBooks(q: string, perPage = 24) {
  const res = await hardcover().search.books(q, { perPage });
  return res.hits.map((h) => ({
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
  }));
}

export async function testHardcover(token: string) {
  const me = await hardcover(token).me.get();
  return { username: (me as { username?: string }).username ?? "unknown" };
}

/**
 * Checks the server's own key against what it's used for: catalog data and
 * search, public lists and prompts. It doesn't need to see its own profile,
 * so the username is shown only when the key allows it.
 */
export async function testServerKey(token: string): Promise<{ username: string | null; missing: string[] }> {
  const hc = hardcover(token);
  const missing = new Set<string>();
  const probe = async (fn: () => Promise<unknown>, scopes: string[]) => {
    try {
      await fn();
    } catch (err) {
      const m = missingScopes(err, scopes);
      if (!m) throw err;
      for (const x of m) missing.add(x);
    }
  };
  try {
    await probe(() => hc.books.getMany([1]), ["read:catalog"]);
  } catch (err) {
    throw new Error(
      `Hardcover refused this key outright: "${(err as Error).message}". It isn't a missing permission. Check that the whole key was pasted, that it's an API key from hardcover.app/account/api (not the developer app's client ID or secret), and that it was made while signed in to the account it belongs to.`,
    );
  }
  await probe(() => hc.search.books("dune", { perPage: 1 }), ["read:catalog"]);
  await probe(() => hc.prompts.list({ featured: true, limit: 1 }), ["read:prompts"]);
  // Only a permission error counts here; anything else about this query isn't the key's fault.
  await probe(() => hc.graphql("query ServerKeyLists { lists(limit: 1) { id } }").catch((err) => {
    if (missingScopes(err, ["read:lists"])) throw err;
  }), ["read:lists"]);
  let username: string | null = null;
  try {
    username = ((await hc.me.get()) as { username?: string }).username ?? null;
  } catch {
    /* fine: the server key doesn't need read:me */
  }
  return { username, missing: [...missing] };
}

/**
 * The Hardcover permissions (scopes) a reader's key needs: their shelves and
 * Want to Read, reading progress, Top picks (vibes) and book details.
 */
export const READER_SCOPES = ["read:me:content", "read:library", "write:library", "read:vibes", "read:catalog"] as const;

/** The scopes a Hardcover error says are missing, or null when it isn't a missing-permission error. */
export function missingScopes(err: unknown, fallback: string[]): string[] | null {
  const e = err as { missingScopes?: string[]; message?: string; name?: string } | null;
  if (e?.missingScopes) return e.missingScopes.length ? e.missingScopes : fallback;
  const m = e?.message?.match(/missing scopes?:?\s*([\w:,\s]+)/i);
  if (m) return m[1].split(/[\s,]+/).filter((x) => x.includes(":"));
  if (/insufficient_scope/i.test(e?.message ?? "")) return fallback;
  return null;
}

/**
 * Checks a reader's key: who it belongs to, and which permissions Shelfhelp
 * needs that it doesn't have. Only reads are tried (write:library can't be
 * checked without changing something), so that one is listed as needed.
 */
export async function checkHardcoverToken(token: string): Promise<{ username: string; missing: string[] }> {
  const hc = hardcover(token);
  const { username } = await testHardcover(token);
  const missing = new Set<string>();
  const probe = async (fn: () => Promise<unknown>, scopes: string[]) => {
    try {
      await fn();
    } catch (err) {
      const m = missingScopes(err, scopes);
      if (!m) throw err;
      for (const s of m) missing.add(s);
    }
  };
  await probe(() => hc.library.count({ status: 1 }), ["read:library"]);
  await probe(() => hc.vibes.mine({ limit: 1 }), ["read:vibes"]);
  await probe(() => hc.books.getMany([1]), ["read:catalog"]);
  return { username, missing: [...missing] };
}

const checks = new Map<string, { at: number; problem: string | null }>();

/** What's wrong with a reader's key, if anything, checked at most once an hour. */
export async function hardcoverProblem(token: string): Promise<string | null> {
  const hit = checks.get(token);
  if (hit && Date.now() - hit.at < 3600_000) return hit.problem;
  let problem: string | null = null;
  try {
    const c = await checkHardcoverToken(token);
    if (c.missing.length) problem = scopeHelp(c.missing, oauthUserId(token) != null);
  } catch (err) {
    problem = oauthUserId(token) != null
      ? `Hardcover didn't accept your sign-in: ${(err as Error).message}. Connect Hardcover again in My account.`
      : `Hardcover didn't accept your key: ${(err as Error).message}`;
  }
  checks.set(token, { at: Date.now(), problem });
  return problem;
}

/** One line telling someone how to fix a key that's missing permissions. */
export function scopeHelp(missing: string[], signedIn = false) {
  if (signedIn) {
    return `Your Hardcover sign-in is missing ${missing.length === 1 ? "this permission" : "these permissions"}: ${missing.join(", ")}. Connect Hardcover again in My account and allow everything Shelfhelp asks for.`;
  }
  return `Your Hardcover key is missing ${missing.length === 1 ? "this permission" : "these permissions"}: ${missing.join(", ")}. Make a new key at hardcover.app (Account, API Access) with ${READER_SCOPES.join(", ")}, then paste it here.`;
}

/** One edition of a book, for picking the exact version to request. */
export interface HcEdition {
  id: number;
  format: "audiobook" | "ebook" | "print";
  title: string | null;
  narrators: string[];
  publisher: string | null;
  language: string | null;
  releaseDate: string | null;
  audioSeconds: number | null;
  pages: number | null;
  asin: string | null;
  isbn13: string | null;
  isbn10: string | null;
  editionFormat: string | null;
  coverUrl: string | null;
  readers: number;
}

const editionCache = new Map<number, { at: number; editions: HcEdition[] }>();

/** Every edition of a book on Hardcover, most read first. Cached for an hour. */
export async function bookEditions(bookId: number): Promise<HcEdition[]> {
  const hit = editionCache.get(bookId);
  if (hit && Date.now() - hit.at < 3600_000) return hit.editions;
  type Row = {
    id: number;
    title?: string | null;
    asin?: string | null;
    isbn_13?: string | null;
    isbn_10?: string | null;
    audio_seconds?: number | null;
    pages?: number | null;
    release_date?: string | null;
    edition_format?: string | null;
    reading_format_id?: number | null;
    users_count?: number | null;
    publisher?: { name?: string | null } | null;
    language?: { language?: string | null } | null;
    image?: { url?: string | null } | null;
    contributions?: { contribution?: string | null; author?: { name?: string | null } | null }[] | null;
  };
  const full = `query BookEditions($bookId: Int!) {
    editions(where: { book_id: { _eq: $bookId } }, order_by: { users_count: desc_nulls_last }, limit: 100) {
      id title asin isbn_13 isbn_10 audio_seconds pages release_date edition_format reading_format_id users_count
      publisher { name } language { language } image { url }
      contributions { contribution author { name } }
    }
  }`;
  // If Hardcover ever renames one of the extra fields, fall back to the basics.
  const basic = `query BookEditionsBasic($bookId: Int!) {
    editions(where: { book_id: { _eq: $bookId } }, order_by: { users_count: desc_nulls_last }, limit: 100) {
      id title asin isbn_13 isbn_10 audio_seconds pages release_date edition_format reading_format_id users_count
    }
  }`;
  const hc = hardcover();
  const data = await hc
    .graphql<{ editions: Row[] }>(full, { bookId })
    .catch(() => hc.graphql<{ editions: Row[] }>(basic, { bookId }));
  const editions = (data.editions ?? []).map((e): HcEdition => {
    const fmt = (e.edition_format ?? "").toLowerCase();
    const format: HcEdition["format"] =
      e.reading_format_id === 2 || e.audio_seconds || /audio/.test(fmt)
        ? "audiobook"
        : e.reading_format_id === 4 || /kindle|e-?book|epub|digital/.test(fmt)
          ? "ebook"
          : "print";
    return {
      id: e.id,
      format,
      title: e.title ?? null,
      narrators: [
        ...new Set(
          (e.contributions ?? [])
            .filter((c) => /narrat|read by|reader/i.test(c.contribution ?? ""))
            .map((c) => c.author?.name)
            .filter((n): n is string => !!n),
        ),
      ],
      publisher: e.publisher?.name ?? null,
      language: e.language?.language ?? null,
      releaseDate: e.release_date ?? null,
      audioSeconds: e.audio_seconds ?? null,
      pages: e.pages ?? null,
      asin: e.asin ?? null,
      isbn13: e.isbn_13 ?? null,
      isbn10: e.isbn_10 ?? null,
      editionFormat: e.edition_format ?? null,
      coverUrl: e.image?.url ?? null,
      readers: e.users_count ?? 0,
    };
  });
  editionCache.set(bookId, { at: Date.now(), editions });
  return editions;
}

type TagRef = { slug: string; name: string };
type BookAbout = { description: string | null; genres: TagRef[]; moods: TagRef[] };
const descriptions = new Map<number, { at: number; about: BookAbout }>();

/** The book's top tags in one category of Hardcover's cached_tags ("Genre", "Mood"), most-tagged first. */
function topTags(cached: unknown, category: string, limit = 6): TagRef[] {
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
  const out: TagRef[] = [];
  for (const t of list) {
    const name = (typeof t === "string" ? t : (t as { tag?: string })?.tag)?.trim();
    // Skip stray quoted or bracketed tags.
    if (!name || /^[\["']|["'\]]$/.test(name)) continue;
    const slug = (typeof t === "object" && (t as { tagSlug?: string }).tagSlug) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!out.some((x) => x.slug === slug)) out.push({ slug, name });
    if (out.length >= limit) break;
  }
  return out;
}

/** A book's description, genres and moods from Hardcover. Cached for a day. */
export async function bookDescription(bookId: number): Promise<BookAbout> {
  const hit = descriptions.get(bookId);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.about;
  const book = (await hardcover().books.get(bookId)) as { description?: string | null; cachedTags?: unknown } | null;
  const about = {
    description: book?.description?.trim() || null,
    genres: topTags(book?.cachedTags, "Genre"),
    moods: topTags(book?.cachedTags, "Mood"),
  };
  descriptions.set(bookId, { at: Date.now(), about });
  return about;
}

const SHELF_NAMES: Record<number, string> = { 1: "Want to Read", 2: "Currently Reading", 3: "Read", 4: "Paused", 5: "Did Not Finish" };

/**
 * Adds a book to someone's Want to Read shelf on Hardcover, with their own
 * token. A book already on one of their shelves is left where it is.
 */
export async function addToWantToRead(userId: number, bookId: number) {
  const { readerById } = await import("./users.js");
  const { db } = await import("./db.js");
  const token = readerById(userId)?.hardcoverToken;
  if (!token) throw new Error("Connect Hardcover in My account first.");
  const hc = hardcover(token);
  const existing = (await hc.library.forBook(bookId)) as { id: number; statusId?: number | null } | null;
  let entryId: number;
  let status = 1;
  let added = false;
  if (existing) {
    entryId = existing.id;
    status = existing.statusId ?? 1;
  } else {
    const entry = (await hc.library.add(bookId)) as { id: number };
    entryId = entry.id;
    added = true;
  }
  // Keep Shelfhelp's copy of the shelves current so the book shows its shelf right away.
  db.prepare(
    `INSERT INTO hc_library (user_id, book_id, entry_id, status, progress, refreshed_at) VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(user_id, book_id) DO UPDATE SET entry_id = excluded.entry_id, status = excluded.status, refreshed_at = excluded.refreshed_at`,
  ).run(userId, bookId, entryId, status, new Date().toISOString());
  return { added, status, statusName: SHELF_NAMES[status] ?? "On a shelf" };
}
