/**
 * Fake Hardcover GraphQL and Audiobookshelf servers for local development.
 *
 *   npx tsx test/mock-servers.ts
 *   HARDCOVER_ENDPOINT=http://localhost:5091/v1/graphql HARDCOVER_TOKEN=x ABS_URL=http://localhost:5092 ABS_TOKEN=x CHAPTARR_URL=http://localhost:5093 CHAPTARR_API_KEY=chaptarr-key CONFIG_DIR=./config npm run dev:server
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
// Hardcover sometimes lists a book twice; 120 is a second Project Hail Mary.
const duplicates: MockBook[] = [{ id: 120, title: "Project Hail Mary", author: "Andy Weir" }];

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

const seriesId = (name: string) => 3000 + [...new Set(books.filter((b) => b.series).map((b) => b.series![0]))].indexOf(name);
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
      rating: 3.6 + (b.id % 13) / 10,
      ratingsCount: 40 + b.id * 37,
      usersCount: 1000,
      cachedImage: { url: `${HC}/cover/${b.id}.svg` },
      cachedContributors: [{ author: { name: b.author }, contribution: null }],
      cachedFeaturedSeries: b.series ? { series: { id: seriesId(b.series[0]), name: b.series[0] }, position: b.series[1] } : {},
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
const genresOf = (b: MockBook) =>
  b.author === "Brandon Sanderson" ? ["Fantasy", "Fiction"] : b.author === "Blake Crouch" ? ["Thriller", "Science Fiction"] : b.id === 113 ? ["Urban Fantasy"] : ["Science Fiction", "Fiction"];
const moodsOf = (b: MockBook) => (b.id % 2 ? ["Adventurous", "Tense"] : ["Emotional", "Dark", "Reflective"]);
const hit = (b: MockBook) => ({ document: { genres: genresOf(b), moods: moodsOf(b), users_count: 1000 - b.id, has_audiobook: true, id: String(b.id), title: b.title, slug: b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), author_names: [b.author], image: { url: `${HC}/cover/${b.id}.svg` }, series_names: b.series ? [b.series[0]] : [], featured_series_position: b.series?.[1] ?? null, release_year: 2010 } });

function hardcover(body: { query: string; variables?: Record<string, unknown> }, token = "") {
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
      const read = v.read as Record<string, number & string>;
      if (read.started_at !== undefined) r.startedAt = read.started_at;
      if (read.finished_at !== undefined) r.finishedAt = read.finished_at;
      if (read.started_at !== undefined || read.finished_at !== undefined) console.log(`[hc] book ${e.bookId} dates ${r.startedAt} - ${r.finishedAt}`);
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
  if (q.includes("query BookEditions")) return { editions: mockEditions(Number(v.bookId)) };
  if (q.includes("query DiscoverTopRated") || q.includes("query DiscoverAudio") || q.includes("query DiscoverAuthors") || q.includes("query DiscoverRecent") || q.includes("query DiscoverUpcoming")) {
    let picked = books.map((_, i) => listBooks(i, 1)[0].book);
    if (q.includes("DiscoverTopRated")) picked = picked.sort((a, b) => b.rating - a.rating).slice(0, 8);
    if (q.includes("DiscoverAudio")) picked = picked.filter((b, i) => i % 2 === 0).slice(0, 8);
    if (q.includes("DiscoverAuthors")) {
      const names = new Set((v.names as string[]).map((n) => n.toLowerCase()));
      picked = picked.filter((b) => names.has(b.cachedContributors[0].author.name.toLowerCase()));
    }
    return { books: picked };
  }
  if (q.includes("query TrendingBookIds")) {
    const ids = books.map((b) => b.id);
    return { books_trending: { ids: v.duration === "one_year" ? ids.slice().reverse() : ids.slice(4).concat(ids.slice(0, 4)), error: null } };
  }
  if (q.includes("query ReleasedBooks")) {
    const future = String(v.from) > new Date().toISOString().slice(0, 10);
    const picked = future ? [2, 6, 9, 13] : [0, 3, 7, 10, 12, 15];
    return { books: picked.filter((i) => i < books.length).map((i) => listBooks(i, 1)[0].book) };
  }
  if (q.includes("query GetBookBySlug")) {
    const i = books.findIndex((_, n) => listBooks(n, 1)[0].book.slug === v.slug);
    return { books: i >= 0 ? [listBooks(i, 1)[0].book] : [] };
  }
  if (q.includes("query GetBooks")) {
    return {
      books: (v.ids as number[])
        .map((id) => {
          const i = books.findIndex((b) => b.id === id);
          if (i >= 0) return listBooks(i, 1)[0].book;
          const d = duplicates.find((b) => b.id === id);
          return d && { id: d.id, slug: `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-2`, title: d.title, releaseYear: 2021, cachedImage: { url: `${HC}/cover/101.svg` }, cachedContributors: [{ author: { name: d.author }, contribution: null }], cachedFeaturedSeries: {} };
        })
        .filter(Boolean),
    };
  }
  if (q.includes("query GetPrompts")) {
    return { prompts: [{ id: 41, slug: "best-books-to-go-in-blind", question: "Best books to go in blind?", description: "The less you know the better.", featured: true, answersCount: 12, booksCount: 5, usersCount: 9, userId: 3, createdAt: "2026-06-01" }] };
  }
  if (q.includes("query GetPromptBooks")) {
    return { prompt_books_summary: [111, 108, 113, 117, 112].map((id, i) => ({ answersCount: 9 - i, book: listBooks(books.findIndex((b) => b.id === id), 1)[0].book })) };
  }
  if (q.includes("query GetSeriesBooks")) {
    const inSeries = books.filter((b) => b.series && seriesId(b.series[0]) === Number(v.seriesId));
    return { book_series: inSeries.map((b) => ({ position: b.series![1], details: null, compilation: false, featured: true, book: listBooks(books.indexOf(b), 1)[0].book })) };
  }
  if (q.includes("query Search") && v.fields === "moods") {
    const want = String(v.query).toLowerCase();
    const found = books.filter((b) => moodsOf(b).some((g) => g.toLowerCase() === want));
    return { search: { ids: found.map((b) => b.id), results: { hits: found.map(hit), found: found.length }, query: v.query, queryType: "book", page: Number(v.page ?? 1), perPage: 50, error: null } };
  }
  if (q.includes("query Search") && v.fields === "genres") {
    const want = String(v.query).toLowerCase();
    const found = books.filter((b) => genresOf(b).some((g) => g.toLowerCase().includes(want)) || (want === "fantasy" && b.id === 113));
    const page = Number(v.page ?? 1);
    const per = Number(v.per_page ?? v.perPage ?? 25);
    const slice = found.slice((page - 1) * per, page * per);
    return { search: { ids: slice.map((b) => b.id), results: { hits: slice.map(hit), found: found.length }, query: v.query, queryType: "book", page, perPage: per, error: null } };
  }
  if (q.includes("query GetVibesForUser")) {
    const vibe = (id: number, title: string) => ({ id, slug: title.toLowerCase().replace(/\W+/g, "-"), title, description: null, vibeType: "system", resultType: "books", privacySettingId: 1, featured: false, likesCount: 0 });
    return { vibes: [vibe(1, "Your next favorite"), vibe(2, "Hidden gems")] };
  }
  if (q.includes("query GetVibeBookIds")) {
    const ids = Number(v.id) === 1 ? [108, 112, 114, 111, 101] : [115, 109, 117, 112];
    return { vibes_by_pk: { id: Number(v.id), updatedAt: "2026-10-01T00:00:00Z", booksGeneratedAt: "2026-10-02T00:00:00Z", cachedBookIds: ids } };
  }
  if (q.includes("query Search")) {
    const words = String(v.query).toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const found = [...books, ...duplicates].filter((b) => words.some((w) => b.title.toLowerCase().includes(w)));
    return { search: { ids: found.map((b) => b.id), results: { hits: found.map(hit), found: found.length }, query: v.query, queryType: "book", page: 1, perPage: 8, error: null } };
  }
  if (q.includes("query Me")) return { me: [token === "hc-sage" ? { id: 2, username: "sage", name: "Sage" } : { id: 1, username: "nathan", name: "Nathan" }] };
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
      // Test hook: change a book's status, like doing it on hardcover.app.
      if (req.url?.startsWith("/test/status")) {
        const { bookId, status } = JSON.parse(data);
        if (status === 0) {
          userBooks.delete(bookId);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        }
        let e = userBooks.get(bookId);
        if (!e) userBooks.set(bookId, (e = { id: nextId++, bookId, statusId: status, editionId: null, reads: [] }));
        e.statusId = status;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }
      const out = hardcover(JSON.parse(data || "{}"), String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
      // MOCK_DELAY_MS slows every answer down, to watch progress in the UI.
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: out }));
      }, Number(process.env.MOCK_DELAY_MS ?? 0));
    });
  })
  .listen(5091, () => console.log("mock Hardcover on :5091"));

// Audiobookshelf
const collections = new Map<string, { id: string; libraryId: string; name: string; description: string | null; books: string[] }>();
// A second library, so the Library page can be split by library.
const kidsItems: (typeof items)[number][] = [
  { id: "lk_1", title: "Charlotte's Web", authorName: "E. B. White" } as (typeof items)[number],
  { id: "lk_2", title: "Matilda", authorName: "Roald Dahl" } as (typeof items)[number],
];
const itemJson = (i: (typeof items)[number]) => ({
  id: i.id,
  libraryId: i.id.startsWith("lk_") ? "lib_kids" : "lib_audio",
  mediaType: "book",
  updatedAt: 1,
  addedAt: Date.now() - items.indexOf(i) * 86400_000,
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
      // Test hook: rename an item, like editing it in Audiobookshelf.
      if (req.method === "POST" && req.url?.startsWith("/test/rename/")) {
        const it = items.find((x) => x.id === req.url!.split("/")[3]);
        if (it) it.title = body.title;
        return send(200, { ok: !!it });
      }
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
      // Other Audiobookshelf users, as an admin key sees them.
      if (p === "/api/users") {
        return send(200, {
          users: [
            { id: "u1", username: "root", email: "nathan@example.com", type: "root", isActive: true, hasOpenIDLink: true },
            { id: "u2", username: "sage", email: "sage@example.com", type: "user", isActive: true, hasOpenIDLink: true },
            { id: "u3", username: "guest", email: null, type: "guest", isActive: true },
          ],
        });
      }
      if ((m = p.match(/^\/api\/users\/([^/]+)$/))) {
        const now = Date.now();
        const prog = (id: string, progress: number, finished = false, daysAgo = 1) => ({
          id: `mp_${m![1]}_${id}`, libraryItemId: id, episodeId: null, duration: 36000, progress, currentTime: progress * 36000,
          isFinished: finished, lastUpdate: now - daysAgo * 86400000, startedAt: now - (daysAgo + 10) * 86400000,
          finishedAt: finished ? now - daysAgo * 86400000 : null,
        });
        if (m[1] === "u2") return send(200, { id: "u2", username: "sage", mediaProgress: [prog("li_2", 0.55, false, 0), prog("li_6", 1, true, 6), prog("li_8", 0.25, false, 2)] });
        if (m[1] === "u3") return send(200, { id: "u3", username: "guest", mediaProgress: [] });
        return send(404, "Not found");
      }
      if (p === "/api/libraries") return send(200, { libraries: [{ id: "lib_audio", name: "Audiobooks", mediaType: "book" }, { id: "lib_kids", name: "Kids", mediaType: "book" }, { id: "lib_pod", name: "Podcasts", mediaType: "podcast" }] });
      if ((m = p.match(/^\/api\/libraries\/([^/]+)\/items$/))) {
        if (m[1] === "lib_kids") return send(200, { results: kidsItems.map(itemJson), total: kidsItems.length });
        if (m[1] !== "lib_audio") return send(200, { results: [], total: 0 });
        const page = Number(url.searchParams.get("page") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 0) || items.length;
        return send(200, { results: items.slice(page * limit, page * limit + limit).map(itemJson), total: items.length });
      }
      if ((m = p.match(/^\/api\/libraries\/([^/]+)\/collections$/))) return send(200, { results: [...collections.values()].map(collJson) });
      if ((m = p.match(/^\/api\/items\/([^/]+)(\/media)?$/))) {
        const it = items.find((x) => x.id === m![1]) as ((typeof items)[number] & { tags?: string[] }) | undefined;
        if (!it) return send(404, "Not found");
        if (req.method === "PATCH" && m[2]) {
          it.tags = body.tags;
          console.log(`[abs] tags ${it.id}: ${JSON.stringify(it.tags)}`);
        }
        return send(200, { id: it.id, media: { tags: it.tags ?? ["Sci-Fi"] } });
      }
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

// Chaptarr. Shapes follow Chaptarr's v1 API: one row per format, provider ids
// like hc:101, 201 on add, 202 while a new author imports, 409 when ambiguous.
const CHAPTARR_KEY = "chaptarr-key";
interface CRow {
  id: number;
  hc: number;
  mediaType: "audiobook" | "ebook";
  monitored: boolean;
  hasFiles: boolean;
  grabbed: boolean;
  checks: number;
}
const cRows: CRow[] = [
  { id: 1, hc: 101, mediaType: "audiobook", monitored: true, hasFiles: true, grabbed: false, checks: 0 },
  { id: 2, hc: 106, mediaType: "audiobook", monitored: false, hasFiles: false, grabbed: false, checks: 0 },
];
let cNextId = 10;
const cPending = new Map<number, { hc: number; mediaType: "audiobook" | "ebook"; lookups: number }>();
const cAdds: unknown[] = [];
const cCommands: unknown[] = [];

/** Hardcover editions for the edition picker: two audiobooks with different narrators, an ebook and a print copy. */
function mockEditions(bookId: number) {
  const b = books.find((x) => x.id === bookId);
  if (!b) return [];
  const who = (name: string, contribution: string | null) => ({ contribution, author: { name } });
  return [
    { id: 90000 + bookId * 10 + 1, title: b.title, asin: `B0${bookId}AUD1`, isbn_13: null, isbn_10: null, audio_seconds: 58000, pages: null, release_date: "2021-05-04", edition_format: "Audible Audio", reading_format_id: 2, users_count: 900, publisher: { name: "Audible Studios" }, language: { language: "English" }, image: { url: `${HC}/cover/${bookId}.svg` }, contributions: [who(b.author, null), who("Ray Porter", "Narrator")] },
    { id: 90000 + bookId * 10 + 2, title: b.title, asin: `B0${bookId}AUD2`, isbn_13: null, isbn_10: null, audio_seconds: 61000, pages: null, release_date: "2023-02-01", edition_format: "Audiobook", reading_format_id: 2, users_count: 120, publisher: { name: "Penguin Audio" }, language: { language: "English" }, image: null, contributions: [who(b.author, null), who("Jane Reader", "Narrator"), who("Sam Voice", "Narrator")] },
    { id: 90000 + bookId * 10 + 3, title: b.title, asin: null, isbn_13: `978000${bookId}0003`, isbn_10: null, audio_seconds: null, pages: 480, release_date: "2021-05-04", edition_format: "Kindle Edition", reading_format_id: 4, users_count: 300, publisher: { name: "Ballantine" }, language: { language: "English" }, image: null, contributions: [who(b.author, null)] },
    { id: 90000 + bookId * 10 + 4, title: b.title, asin: null, isbn_13: `978000${bookId}0004`, isbn_10: null, audio_seconds: null, pages: 496, release_date: "2021-05-04", edition_format: "Hardcover", reading_format_id: 1, users_count: 2000, publisher: { name: "Ballantine" }, language: { language: "English" }, image: null, contributions: [who(b.author, null)] },
  ];
}

function cResource(b: MockBook, mediaType: "audiobook" | "ebook") {
  const local = (t: string) => cRows.filter((r) => r.hc === b.id && r.mediaType === t).map((r) => ({ id: r.id, title: b.title, mediaType: t, monitored: r.monitored, hasFiles: r.hasFiles }));
  const own = cRows.find((r) => r.hc === b.id && r.mediaType === mediaType);
  return {
    id: own?.id ?? 0,
    title: b.title,
    authorTitle: b.author.split(" ").reverse().join(", ") + " " + b.title,
    foreignBookId: `hc:${b.id}`,
    hardcoverBookId: `hc:${b.id}`,
    mediaType,
    monitored: own?.monitored ?? false,
    hasFiles: own?.hasFiles ?? false,
    grabbed: own?.grabbed ?? false,
    remoteCover: `${HC}/cover/${b.id}.svg`,
    narrator: mediaType === "audiobook" ? "Ray Porter" : null,
    authorId: own ? authorIdOf(b.author) : 0,
    author: { id: own ? authorIdOf(b.author) : 0, authorName: b.author, foreignAuthorId: `hc:${2000 + b.id}`, audiobookRootFolderPath: null, ebookRootFolderPath: null },
    // Chaptarr lists the first audiobook edition by Hardcover id, the second only by ASIN, and the ebook by ISBN.
    editions:
      mediaType === "audiobook"
        ? [
            { id: 0, foreignEditionId: `hc:edition:${90000 + b.id * 10 + 1}`, title: b.title, asin: `B0${b.id}AUD1`, monitored: true },
            { id: 0, foreignEditionId: `az:B0${b.id}AUD2`, title: b.title, asin: `B0${b.id}AUD2`, monitored: false },
          ]
        : [{ id: 0, foreignEditionId: `isbn:978000${b.id}0003`, title: b.title, isbn13: `978000${b.id}0003`, monitored: true }],
    localAudiobookBooks: local("audiobook"),
    localEbookBooks: local("ebook"),
    statistics: { bookFileCount: own?.hasFiles ? 1 : 0 },
  };
}

// Chaptarr tags live on authors, per format.
const cTags: { id: number; label: string }[] = [];
const cAuthors = new Map<string, { id: number; authorName: string; audiobookTags: number[]; ebookTags: number[] }>();
function authorIdOf(name: string, tags?: { audiobook?: number[]; ebook?: number[] }) {
  let a = cAuthors.get(name);
  if (!a) cAuthors.set(name, (a = { id: 500 + cAuthors.size, authorName: name, audiobookTags: [], ebookTags: [] }));
  if (tags?.audiobook) a.audiobookTags = [...new Set([...a.audiobookTags, ...tags.audiobook])];
  if (tags?.ebook) a.ebookTags = [...new Set([...a.ebookTags, ...tags.ebook])];
  return a.id;
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (code: number, body?: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(body === undefined ? "" : JSON.stringify(body));
      };
      if (req.headers["x-api-key"] !== CHAPTARR_KEY) return send(401, { error: "Unauthorized" });
      const url = new URL(req.url ?? "/", "http://x");
      const p = url.pathname;
      const body = raw ? JSON.parse(raw) : null;
      if (p === "/api/v1/system/status") return send(200, { appName: "Chaptarr", instanceName: "Chaptarr", version: "0.9.512" });
      if (p === "/api/v1/rootfolder")
        return send(200, [
          { id: 1, name: "Audiobooks", path: "/audiobooks", folderType: 1, isEffectiveDefaultAudiobook: true, isEffectiveDefaultEbook: false, audiobook: { qualityProfileId: 1, metadataProfileId: 2 }, ebook: null, freeSpace: 4e12 },
          { id: 2, name: "Ebooks", path: "/ebooks", folderType: 2, isEffectiveDefaultAudiobook: false, isEffectiveDefaultEbook: true, audiobook: null, ebook: { qualityProfileId: 3, metadataProfileId: 3 }, freeSpace: 4e12 },
        ]);
      if (p === "/api/v1/qualityprofile")
        return send(200, [
          { id: 1, name: "M4B Preferred", profileType: "audiobook" },
          { id: 4, name: "Any Audio", profileType: "audiobook" },
          { id: 3, name: "EPUB", profileType: "ebook" },
        ]);
      if (p === "/api/v1/metadataprofile")
        return send(200, [
          { id: 2, name: "Audiobook Standard", profileType: 1 },
          { id: 3, name: "Ebook Standard", profileType: 2 },
        ]);
      if (p === "/api/v1/book/lookup") {
        const term = url.searchParams.get("term") ?? "";
        const mt = url.searchParams.get("mediaType") as "audiobook" | "ebook" | null;
        if (/^\d+$/.test(term)) return send(400, { error: "Provider prefix required for term (hc:, gr:, ol:, gb:, az:, isbn:)." });
        // A pending author import finishes after a couple of lookups.
        for (const [pid, pend] of cPending) {
          if (++pend.lookups >= 2) {
            cRows.push({ id: cNextId++, hc: pend.hc, mediaType: pend.mediaType, monitored: true, hasFiles: false, grabbed: false, checks: 0 });
            cPending.delete(pid);
          }
        }
        const m = term.match(/^hc:(\d+)$/i);
        const found = m ? books.filter((b) => b.id === Number(m[1])) : books.filter((b) => b.title.toLowerCase().includes(term.toLowerCase()));
        const out = found.flatMap((b) => (["audiobook", "ebook"] as const).map((t) => cResource(b, t)));
        return send(200, mt ? out.filter((o) => o.mediaType === mt) : out);
      }
      if (p === "/api/v1/book" && req.method === "POST") {
        const mt = url.searchParams.get("mediaType") as "audiobook" | "ebook";
        cAdds.push({ mediaType: mt, body });
        console.log(`[chaptarr] add ${mt}: ${body?.title} author=${body?.author?.foreignAuthorId} root=${body?.author?.[`${mt}RootFolderPath`]} q=${body?.author?.[`${mt}QualityProfileId`]} m=${body?.author?.[`${mt}MetadataProfileId`]} search=${body?.addOptions?.searchForNewBook} monitor=${body?.author?.addOptions?.monitor} edition=${(body?.editions ?? []).filter((e: { monitored?: boolean }) => e.monitored).map((e: { foreignEditionId?: string }) => e.foreignEditionId).join(",")}`);
        if (!/^hc:\d+$/.test(body?.foreignBookId ?? "")) return send(400, [{ propertyName: "foreignBookId", errorMessage: "foreignBookId requires a provider prefix." }]);
        if (!body?.author?.[`${mt}RootFolderPath`] || !body?.author?.[`${mt}QualityProfileId`])
          return send(400, "No media type is configured (audiobook/ebook). Configure at least one root folder + quality profile for this instance.");
        const hc = Number(body.foreignBookId.slice(3));
        if (hc === 116) return send(409, { error: "Ambiguous provider identity", message: "More than one local author matches hc:2116.", candidates: [{ id: 7, title: "Orson Scott Card", authorName: "Orson Scott Card" }, { id: 8, title: "Orson S. Card", authorName: "Orson S. Card" }] });
        if (hc === 115) {
          const pid = cNextId++;
          cPending.set(pid, { hc, mediaType: mt, lookups: 0 });
          return send(202, { pendingId: pid, message: "Author import queued; the book will be added and searched when the author finishes importing." });
        }
        authorIdOf(books.find((b) => b.id === hc)!.author, { audiobook: body.author.audiobookTags, ebook: body.author.ebookTags });
        const row: CRow = { id: cNextId++, hc, mediaType: mt, monitored: true, hasFiles: false, grabbed: false, checks: 0 };
        cRows.push(row);
        return send(201, cResource(books.find((b) => b.id === hc)!, mt));
      }
      if (p === "/api/v1/tag" && req.method === "GET") return send(200, cTags);
      if (p === "/api/v1/tag" && req.method === "POST") {
        const label = String(body?.label ?? "").toLowerCase();
        if (!label) return send(400, [{ propertyName: "Label", errorMessage: "'Label' must not be empty." }]);
        const t = cTags.find((x) => x.label === label) ?? { id: cTags.length + 1, label };
        if (!cTags.includes(t)) cTags.push(t);
        console.log(`[chaptarr] tag ${t.id} ${t.label}`);
        return send(201, t);
      }
      let mm: RegExpMatchArray | null;
      if ((mm = p.match(/^\/api\/v1\/author\/(\d+)$/))) {
        const a = [...cAuthors.values()].find((x) => x.id === Number(mm![1]));
        if (!a) return send(404, { message: "NotFound" });
        if (req.method === "PUT") {
          a.audiobookTags = body.audiobookTags ?? a.audiobookTags;
          a.ebookTags = body.ebookTags ?? a.ebookTags;
          console.log(`[chaptarr] author ${a.authorName} tags audiobook=${JSON.stringify(a.audiobookTags)} ebook=${JSON.stringify(a.ebookTags)}`);
          return send(202, { id: a.id });
        }
        return send(200, { ...a, tags: [...new Set([...a.audiobookTags, ...a.ebookTags])], monitored: true });
      }
      if ((mm = p.match(/^\/api\/v1\/book\/(\d+)$/))) {
        const row = cRows.find((r) => r.id === Number(mm![1]));
        if (!row) return send(404, { message: "NotFound" });
        // Each check moves a monitored book along: searching, downloading, downloaded.
        if (row.monitored && !row.hasFiles) {
          row.checks++;
          if (row.checks >= 2) row.grabbed = true;
          if (row.checks >= 4) {
            row.grabbed = false;
            row.hasFiles = true;
          }
        }
        return send(200, cResource(books.find((b) => b.id === row.hc)!, row.mediaType));
      }
      if (p === "/api/v1/book/monitor" && req.method === "PUT") {
        for (const id of body.bookIds) {
          const r = cRows.find((x) => x.id === id);
          if (r) r.monitored = body.monitored;
        }
        return send(202, []);
      }
      if (p === "/api/v1/command" && req.method === "POST") {
        cCommands.push(body);
        console.log(`[chaptarr] command ${body.name} ${JSON.stringify(body.bookIds)}`);
        return send(201, { id: cCommands.length, name: body.name, status: "queued" });
      }
      if (p === "/api/v1/queue") {
        const records = cRows.filter((r) => r.grabbed).map((r) => ({ bookId: r.id, status: "downloading", size: 400e6, sizeleft: 100e6, timeleft: "00:04:10" }));
        return send(200, { page: 1, pageSize: 500, totalRecords: records.length, records });
      }
      if (p === "/test/chaptarr") return send(200, { rows: cRows, adds: cAdds, commands: cCommands, pending: [...cPending], tags: cTags, authors: [...cAuthors.values()] });
      send(404, { message: "NotFound" });
    });
  })
  .listen(5093, () => console.log("mock Chaptarr on :5093"));


// Pocket ID stand-in: an OpenID Connect provider with a page to pick who you are.
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createHash, randomBytes } from "node:crypto";
const OIDC = "http://localhost:5094";
const people: Record<string, { sub: string; email: string; name: string; preferred_username: string; groups: string[] }> = {
  nathan: { sub: "pid-nathan", email: "nathan@example.com", name: "Nathan", preferred_username: "nathan", groups: [] },
  sage: { sub: "pid-sage", email: "sage@example.com", name: "Sage", preferred_username: "sage", groups: [] },
  stranger: { sub: "pid-stranger", email: "stranger@example.com", name: "Stranger", preferred_username: "stranger", groups: [] },
};
const codes = new Map<string, { who: string; nonce: string; challenge: string; redirect: string }>();
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const url = new URL(req.url ?? "/", OIDC);
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        return json(200, {
          issuer: OIDC,
          authorization_endpoint: `${OIDC}/authorize`,
          token_endpoint: `${OIDC}/api/oidc/token`,
          jwks_uri: `${OIDC}/.well-known/jwks.json`,
          userinfo_endpoint: `${OIDC}/api/oidc/userinfo`,
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        });
      }
      if (url.pathname === "/.well-known/jwks.json" || url.pathname === "/cdn-cgi/access/certs") return json(200, { keys: [jwk] });
      // Test hook: a Cloudflare Access token for an email.
      if (url.pathname === "/test/cf-token") {
        const t = await new SignJWT({ email: url.searchParams.get("email"), type: "app" })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer("https://team.example")
          .setAudience("aud123")
          .setSubject("cf-user")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end(t);
      }
      if (url.pathname === "/authorize") {
        const q = url.searchParams;
        if (q.get("client_id") !== "shelfhelp") return json(400, { error: "unknown client" });
        const who = q.get("who");
        if (!who) {
          res.writeHead(200, { "Content-Type": "text/html" });
          const links = Object.keys(people).map((k) => `<p><a id="as-${k}" href="${url.pathname}?${q}&who=${k}">Sign in as ${k}</a></p>`).join("");
          return res.end(`<h1>Fake Pocket ID</h1>${links}`);
        }
        const code = randomBytes(12).toString("hex");
        codes.set(code, { who, nonce: q.get("nonce") ?? "", challenge: q.get("code_challenge") ?? "", redirect: q.get("redirect_uri") ?? "" });
        res.writeHead(302, { Location: `${q.get("redirect_uri")}?code=${code}&state=${q.get("state")}` });
        return res.end();
      }
      if (url.pathname === "/api/oidc/token") {
        const form = new URLSearchParams(raw);
        const basic = String(req.headers.authorization ?? "").replace(/^Basic /, "");
        const [id, secret] = basic ? Buffer.from(basic, "base64").toString().split(":") : [form.get("client_id"), form.get("client_secret")];
        if (id !== "shelfhelp" || secret !== "secret") return json(401, { error: "invalid_client" });
        const c = codes.get(form.get("code") ?? "");
        if (!c) return json(400, { error: "invalid_grant" });
        codes.delete(form.get("code")!);
        const check = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (check !== c.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE check failed" });
        if (form.get("redirect_uri") !== c.redirect) return json(400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        const p = people[c.who];
        const idToken = await new SignJWT({ ...p, email_verified: true, nonce: c.nonce })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(OIDC)
          .setAudience("shelfhelp")
          .setSubject(p.sub)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        console.log(`[oidc] signed in ${c.who}`);
        return json(200, { access_token: "at", token_type: "Bearer", id_token: idToken, expires_in: 300 });
      }
      json(404, { error: "not found" });
    });
  })
  .listen(5094, () => console.log("mock Pocket ID on :5094"));
