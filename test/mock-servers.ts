/**
 * Fake Hardcover GraphQL and Audiobookshelf servers for local development.
 *
 *   npx tsx test/mock-servers.ts
 *   HARDCOVER_ENDPOINT=http://localhost:5091/v1/graphql HARDCOVER_TOKEN=x ABS_URL=http://localhost:5092 ABS_TOKEN=x CONFIG_DIR=./config npm run dev:server
 */
import http from "node:http";

const palette = ["#4f46e5", "#9333ea", "#db2777", "#0891b2", "#059669", "#d97706", "#dc2626", "#2563eb", "#7c3aed", "#0d9488"];
function coverSvg(title: string, author: string, n: number, square = false) {
  const w = 300;
  const h = square ? 300 : 450;
  const c = palette[n % palette.length];
  const words = title.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w_ of words) {
    if ((line + " " + w_).trim().length > 14) {
      lines.push(line.trim());
      line = w_;
    } else line += " " + w_;
  }
  lines.push(line.trim());
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w - 60}" cy="70" r="90" fill="#fff" opacity=".08"/>
  ${lines.map((l, i) => `<text x="24" y="${(square ? 110 : 170) + i * 38}" font-family="Georgia,serif" font-size="32" font-weight="bold" fill="#fff">${esc(l)}</text>`).join("")}
  <text x="24" y="${h - 30}" font-family="Helvetica,Arial" font-size="18" fill="#e5e7eb">${esc(author)}</text>
</svg>`;
}

interface MockBook {
  id: number;
  title: string;
  author: string;
  series?: [string, number];
  audioSeconds?: number;
}

const HC = "http://localhost:5091";
const books: MockBook[] = [
  { id: 101, title: "Project Hail Mary", author: "Andy Weir", audioSeconds: 58000 },
  { id: 102, title: "The Final Empire", author: "Brandon Sanderson", series: ["Mistborn", 1] },
  { id: 103, title: "The Well of Ascension", author: "Brandon Sanderson", series: ["Mistborn", 2] },
  { id: 104, title: "Red Rising", author: "Pierce Brown", series: ["Red Rising Saga", 1] },
  { id: 105, title: "Golden Son", author: "Pierce Brown", series: ["Red Rising Saga", 2] },
  { id: 106, title: "Dune", author: "Frank Herbert", series: ["Dune", 1] },
  { id: 107, title: "The Martian", author: "Andy Weir" },
  { id: 108, title: "Children of Time", author: "Adrian Tchaikovsky", series: ["Children of Time", 1] },
  { id: 109, title: "Leviathan Wakes", author: "James S. A. Corey", series: ["The Expanse", 1] },
  { id: 110, title: "The Way of Kings", author: "Brandon Sanderson", series: ["The Stormlight Archive", 1] },
  { id: 111, title: "Hyperion", author: "Dan Simmons", series: ["Hyperion Cantos", 1] },
  { id: 112, title: "A Memory Called Empire", author: "Arkady Martine", series: ["Teixcalaan", 1] },
  { id: 113, title: "Recursion", author: "Blake Crouch" },
  { id: 114, title: "The Three-Body Problem", author: "Cixin Liu", series: ["Remembrance of Earth's Past", 1] },
  { id: 115, title: "Old Man's War", author: "John Scalzi", series: ["Old Man's War", 1] },
  { id: 116, title: "Ender's Game", author: "Orson Scott Card", series: ["Ender's Saga", 1] },
  { id: 117, title: "Dark Matter", author: "Blake Crouch" },
  { id: 118, title: "Klara and the Sun", author: "Kazuo Ishiguro" },
];

// The library: messy titles, a wrong ASIN, a Last, First author, a missing few.
const items = [
  { id: "li_1", title: "Project Hail Mary (Unabridged)", authorName: "Andy Weir", asin: "B08G9PRS1K", duration: 58140 },
  { id: "li_2", title: "Mistborn: The Final Empire", authorName: "Brandon Sanderson", seriesName: "Mistborn #1", asin: "B002UZMLXM" },
  { id: "li_3", title: "The Well of Ascension", authorName: "Brandon Sanderson", seriesName: "Mistborn #2" },
  { id: "li_4", title: "Red Rising", authorName: "Pierce Brown", seriesName: "Red Rising Saga #1", asin: "B00I8QS6UU" },
  { id: "li_5", title: "Morning Star", authorName: "Pierce Brown", seriesName: "Red Rising Saga #3", asin: "GOLDENSON1" },
  { id: "li_6", title: "Dune Messiah", authorName: "Frank Herbert", seriesName: "Dune #2" },
  { id: "li_7", title: "The Martian", authorName: "Weir, Andy" },
  { id: "li_8", title: "Children of Time", authorName: "Adrian Tchaikovsky", seriesName: "Children of Time #1" },
  { id: "li_9", title: "Leviathan Wakes: The Expanse, Book 1", authorName: "James S.A. Corey" },
  { id: "li_10", title: "The Way of Kings", authorName: "Brandon Sanderson", seriesName: "The Stormlight Archive #1" },
  { id: "li_11", title: "Hyperion [Dramatized Adaptation]", authorName: "Dan Simmons" },
  { id: "li_12", title: "Recursion: A Novel", authorName: "Blake Crouch" },
  { id: "li_13", title: "The Three Body Problem", authorName: "Liu Cixin, Ken Liu" },
  { id: "li_14", title: "Ender's Game", authorName: "Orson Scott Card", seriesName: "Ender Quintet #1" },
  { id: "li_15", title: "The Hobbit", authorName: "J.R.R. Tolkien" },
  { id: "li_16", title: "Dark Matter", authorName: "Blake Crouch" },
];

const listBooks = (offset: number, limit: number) =>
  books.slice(offset, offset + limit).map((b, i) => ({
    id: 9000 + b.id,
    listId: 77,
    bookId: b.id,
    editionId: null,
    position: offset + i,
    reason: null,
    dateAdded: "2026-01-01",
    book: {
      id: b.id,
      slug: b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: b.title,
      subtitle: null,
      releaseYear: 2000 + (b.id % 25),
      pages: 300,
      audioSeconds: b.audioSeconds ?? null,
      rating: 4.2,
      ratingsCount: 100,
      usersCount: 1000,
      cachedImage: { url: `${HC}/cover/${b.id}.svg` },
      cachedContributors: [{ author: { name: b.author }, contribution: null }],
      cachedFeaturedSeries: b.series ? { series: { name: b.series[0] }, position: b.series[1] } : {},
    },
  }));

// Hardcover says which book each ASIN belongs to. GOLDENSON1 is the "wrong" ASIN in the library.
const asinMap: Record<string, number> = { B08G9PRS1K: 101, B002UZMLXM: 102, B00I8QS6UU: 104, GOLDENSON1: 105 };

// Your Hardcover library: Red Rising already Read, Project Hail Mary on Want to Read.
interface MockRead { id: number; userBookId: number; editionId: number | null; startedAt: string | null; finishedAt: string | null; progress: number | null; progressSeconds: number | null; edition: unknown }
interface MockEntry { id: number; bookId: number; statusId: number; editionId: number | null; reads: MockRead[] }
const userBooks = new Map<number, MockEntry>();
let nextId = 1;
const edition = (bookId: number) => ({ id: 7000 + bookId, bookId, readingFormatId: 2, audioSeconds: 36000, pages: null, asin: Object.keys(asinMap).find((a) => asinMap[a] === bookId) ?? null, title: null });
function newRead(e: MockEntry, finished: string | null, started: string | null) {
  e.reads.unshift({ id: nextId++, userBookId: e.id, editionId: e.editionId, startedAt: started ?? "2026-10-01", finishedAt: finished, progress: finished ? 100 : 0, progressSeconds: null, edition: { id: e.editionId ?? 7000 + e.bookId, pages: null, audioSeconds: 36000, readingFormatId: 2 } });
}
function setStatus(e: MockEntry, status: number, date?: string, start?: string) {
  const open = e.reads.find((r) => r.startedAt && !r.finishedAt);
  if (status === 2 && !open) newRead(e, null, start ?? null);
  if (status === 3) open ? ((open.finishedAt = date ?? "2026-10-27"), (open.progress = 100)) : newRead(e, date ?? "2026-10-27", start ?? null);
  e.statusId = status;
  console.log(`[hc] book ${e.bookId} -> status ${status}${date ? ` (${date})` : ""}`);
}
for (const [bookId, status] of [[104, 3], [101, 1]] as const) {
  const e: MockEntry = { id: nextId++, bookId, statusId: 1, editionId: null, reads: [] };
  userBooks.set(bookId, e);
  if (status === 3) setStatus(e, 3, "2025-06-01");
}
const entryJson = (e: MockEntry) => ({ id: e.id, bookId: e.bookId, statusId: e.statusId, editionId: e.editionId, userId: 1, userBookReads: e.reads });
const hit = (b: MockBook) => ({ document: { id: String(b.id), title: b.title, slug: b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), author_names: [b.author], image: { url: `${HC}/cover/${b.id}.svg` }, series_names: b.series ? [b.series[0]] : [], featured_series_position: b.series?.[1] ?? null, release_year: 2010 } });

function hardcover(body: { query: string; variables?: Record<string, unknown> }) {
  const q = body.query;
  const v = body.variables ?? {};
  if (q.includes("query GetLibrary") && !(v.statusIds as number[] | undefined)?.length) {
    const all = [...userBooks.values()];
    const offset = Number(v.offset ?? 0);
    return { user_books: all.slice(offset, offset + Number(v.limit ?? 25)).map((e) => ({ ...entryJson(e), book: listBooks(books.findIndex((b) => b.id === e.bookId), 1)[0]?.book ?? null, edition: null })) };
  }
  if (q.includes("mutation AddUserBook")) {
    const o = v.object as Record<string, unknown>;
    const e: MockEntry = { id: nextId++, bookId: o.book_id as number, statusId: 1, editionId: (o.edition_id as number) ?? null, reads: [] };
    userBooks.set(e.bookId, e);
    setStatus(e, o.status_id as number, o.user_date as string, o.user_start_date as string);
    return { insert_user_book: { id: e.id, error: null, userBook: entryJson(e) } };
  }
  if (q.includes("mutation UpdateUserBook(")) {
    const e = [...userBooks.values()].find((x) => x.id === v.id)!;
    const o = v.object as Record<string, unknown>;
    if (o.edition_id) e.editionId = o.edition_id as number;
    if (o.status_id) setStatus(e, o.status_id as number, o.user_date as string, o.user_start_date as string);
    return { update_user_book: { id: e.id, error: null, userBook: entryJson(e) } };
  }
  if (q.includes("query GetUserBook(")) {
    const e = [...userBooks.values()].find((x) => x.id === v.id);
    return { user_books_by_pk: e ? { ...entryJson(e), book: null, edition: null } : null };
  }
  if (q.includes("mutation UpdateUserBookRead")) {
    for (const e of userBooks.values()) {
      const r = e.reads.find((x) => x.id === v.id);
      if (!r) continue;
      const read = v.read as Record<string, number>;
      if (read.progress_seconds != null) {
        r.progressSeconds = read.progress_seconds;
        r.progress = Math.round((read.progress_seconds / 36000) * 1000) / 10;
        console.log(`[hc] book ${e.bookId} progress ${r.progress}%`);
      }
      return { update_user_book_read: { id: r.id, error: null, userBookRead: r } };
    }
  }
  if (q.includes("mutation RemoveUserBook(")) {
    const e = [...userBooks.values()].find((x) => x.id === v.id);
    if (e) userBooks.delete(e.bookId);
    console.log(`[hc] removed book ${e?.bookId}`);
    return { delete_user_book: e ? { id: e.id, bookId: e.bookId, userId: 1 } : null };
  }
  if (q.includes("mutation RemoveUserBookRead")) {
    for (const e of userBooks.values()) e.reads = e.reads.filter((r) => r.id !== v.id);
    console.log(`[hc] removed read ${v.id}`);
    return { delete_user_book_read: { id: v.id, error: null } };
  }
  if (q.includes("query GetUserBookForBook")) {
    const e = userBooks.get(Number(v.bookId));
    return { user_books: e ? [{ ...entryJson(e), edition: null }] : [] };
  }
  if (q.includes("query GetEditionsForBook")) return { editions: [edition(Number(v.bookId))] };
  if (q.includes("query GetBooks")) {
    return { books: (v.ids as number[]).map((id) => listBooks(books.findIndex((b) => b.id === id), 1)[0]?.book).filter(Boolean) };
  }
  if (q.includes("query Search")) {
    const words = String(v.query).toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const found = books.filter((b) => words.some((w) => b.title.toLowerCase().includes(w)));
    return { search: { ids: found.map((b) => b.id), results: { hits: found.map(hit), found: found.length }, query: v.query, queryType: "book", page: 1, perPage: 8, error: null } };
  }
  if (q.includes("query Me")) return { me: [{ id: 1, username: "nathan", name: "Nathan" }] };
  if (q.includes("query GetList")) {
    const offset = Number(v.offset ?? 0);
    const limit = Number(v.limit ?? 50);
    return {
      lists_by_pk: {
        id: 77, slug: "sci-fi-to-listen-to", name: "Sci-Fi to Listen To", description: "The best science fiction audiobooks, in the order I'd recommend them.",
        privacySettingId: 1, ranked: true, defaultView: "grid", booksCount: books.length, likesCount: 3, userId: 1,
        createdAt: "2026-01-01", updatedAt: "2026-01-01", listBooks: listBooks(offset, limit),
      },
    };
  }
  if (q.includes("query CountLibrary") || q.includes("query GetLibrary")) {
    const status = ((v.statusIds as number[]) ?? [1])[0];
    // Want to Read: a few books, two of which are in the library.
    const shelf = status === 1 ? books.filter((b) => [107, 113, 112, 118, 117].includes(b.id)) : status === 3 ? books.slice(0, 3) : [];
    if (q.includes("query CountLibrary")) return { user_books_aggregate: { aggregate: { count: shelf.length } } };
    const offset = Number(v.offset ?? 0);
    const limit = Number(v.limit ?? 25);
    return {
      user_books: shelf.slice(offset, offset + limit).map((b, i) => ({
        id: 5000 + b.id,
        statusId: status,
        book: listBooks(books.indexOf(b), 1)[0].book,
        edition: null,
        position: i,
      })),
    };
  }
  if (q.includes("query MyLists")) {
    const covers = books.slice(0, 4).map((b) => ({ book: { cached_image: { url: `${HC}/cover/${b.id}.svg` } } }));
    return {
      mine: [
        { id: 77, slug: "sci-fi-to-listen-to", name: "Sci-Fi to Listen To", description: null, books_count: books.length, list_books: covers },
        { id: 78, slug: "book-club-2026", name: "Book Club 2026", description: null, books_count: 12, list_books: covers.slice(2) },
      ],
      followed: [{ list: { id: 90, slug: "hugo-winners", name: "Hugo Award Winners", description: null, books_count: 70, list_books: covers.slice(1) } }],
    };
  }
  if (q.includes("query Identify")) {
    const asins = (v.asins as string[]) ?? [];
    return {
      byAsin: asins.filter((a) => asinMap[a]).map((a) => ({ asin: a, book_id: asinMap[a] })),
      byIsbn: [],
      audible: [],
      amazon: [],
    };
  }
  if (q.includes("query FindUser")) return { users: [{ id: 1 }] };
  if (q.includes("query FindList")) return { lists: [{ id: 77 }] };
  return { error: "unhandled" };
}

http
  .createServer((req, res) => {
    const m = req.url?.match(/^\/cover\/(\d+)\.svg/);
    if (m) {
      const b = books.find((x) => x.id === Number(m[1]));
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" });
      return res.end(coverSvg(b?.title ?? "Book", b?.author ?? "", Number(m[1])));
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const out = hardcover(JSON.parse(data || "{}"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: out }));
    });
  })
  .listen(5091, () => console.log("mock Hardcover on :5091"));

// Audiobookshelf
const collections = new Map<string, { id: string; libraryId: string; name: string; description: string | null; books: string[] }>();
const itemJson = (i: (typeof items)[number]) => ({
  id: i.id,
  libraryId: "lib_audio",
  mediaType: "book",
  updatedAt: 1,
  media: {
    duration: i.duration ?? 36000,
    numAudioFiles: i.id === "li_16" ? 0 : 1,
    metadata: { title: i.title, authorName: i.authorName, narratorName: "Ray Porter", seriesName: i.seriesName ?? "", asin: i.asin ?? null, isbn: null, publishedYear: "2015" },
  },
});
const collJson = (c: { id: string; libraryId: string; name: string; description: string | null; books: string[] }) => ({
  ...c,
  books: c.books.map((id) => itemJson(items.find((i) => i.id === id)!)),
});

http
  .createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : {};
      const url = new URL(req.url!, "http://x");
      const send = (code: number, obj?: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      if (req.headers.authorization !== "Bearer x") return send(401, { error: "Unauthorized" });
      const p = url.pathname;
      let m: RegExpMatchArray | null;
      if (p === "/api/me") {
        const now = Date.now();
        const prog = (id: string, progress: number, finished = false, daysAgo = 1) => ({
          id: `mp_${id}`, libraryItemId: id, episodeId: null, duration: 36000, progress, currentTime: progress * 36000,
          isFinished: finished, lastUpdate: now - daysAgo * 86400000, startedAt: now - (daysAgo + 10) * 86400000,
          finishedAt: finished ? now - daysAgo * 86400000 : null,
        });
        return send(200, {
          id: "u1", username: "root", type: "root", permissions: { update: true },
          mediaProgress: [
            prog("li_10", 0.43, false, 0),
            prog("li_1", 1, true, 3),
            prog("li_4", 1, true, 200),
            prog("li_5", 0.2, false, 2),
            prog("li_15", 0.6, false, 5),
            prog("li_12", 1, true, 30),
            prog("li_7", 0.1, false, 1),
            prog("li_3", 0.02, false, 1),
            prog("li_16", 0.3, false, 4),
            { ...prog("pod_1", 0.5), episodeId: "ep_1" },
          ],
        });
      }
      if (p === "/api/libraries") return send(200, { libraries: [{ id: "lib_audio", name: "Audiobooks", mediaType: "book" }, { id: "lib_kids", name: "Kids", mediaType: "book" }, { id: "lib_pod", name: "Podcasts", mediaType: "podcast" }] });
      if ((m = p.match(/^\/api\/libraries\/([^/]+)\/items$/))) {
        if (m[1] !== "lib_audio") return send(200, { results: [], total: 0 });
        const page = Number(url.searchParams.get("page") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 0) || items.length;
        return send(200, { results: items.slice(page * limit, page * limit + limit).map(itemJson), total: items.length });
      }
      if ((m = p.match(/^\/api\/libraries\/([^/]+)\/collections$/))) return send(200, { results: [...collections.values()].map(collJson) });
      if ((m = p.match(/^\/api\/items\/([^/]+)\/cover$/))) {
        const i = items.find((x) => x.id === m![1]);
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        return res.end(coverSvg(i?.title ?? "?", i?.authorName ?? "", Number(m[1].split("_")[1]) + 3, true));
      }
      if (p === "/api/collections" && req.method === "POST") {
        if (!body.books?.length) return send(400, "Invalid collection data. No books");
        const id = `col_${Math.random().toString(36).slice(2, 10)}`;
        collections.set(id, { id, libraryId: body.libraryId, name: body.name, description: body.description, books: [...body.books] });
        console.log(`[abs] create ${body.name}: ${body.books.join(",")}`);
        return send(200, collJson(collections.get(id)!));
      }
      if ((m = p.match(/^\/api\/collections\/([^/]+)(\/batch\/(add|remove))?$/))) {
        const c = collections.get(m[1]);
        if (!c) return send(404, "Collection not found");
        if (m[3] === "add") c.books.push(...body.books.filter((b: string) => !c.books.includes(b)));
        else if (m[3] === "remove") c.books = c.books.filter((b) => !body.books.includes(b));
        else if (req.method === "PATCH") {
          if (body.name) c.name = body.name;
          if (body.books?.length) c.books.sort((a, b) => body.books.indexOf(a) - body.books.indexOf(b));
        } else if (req.method === "DELETE") {
          collections.delete(c.id);
          return send(200);
        }
        if (req.method !== "GET") console.log(`[abs] ${req.method} ${p}: now ${c.books.join(",")}`);
        return send(200, collJson(c));
      }
      send(404, "Not found");
    });
  })
  .listen(5092, () => console.log("mock Audiobookshelf on :5092"));
