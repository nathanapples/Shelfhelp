/** Rows for the Discover page. Hardcover answers are cached for a few hours. */
import { db, json } from "./db.js";
import { hardcover } from "./hardcover.js";
import { hardcoverBook, inLibrary, requestsFor, summarizeBook, type HcSummary } from "./requests.js";
import { myShelfStatus } from "./reading.js";
import { recentlyAdded } from "./linking.js";

export type RowId = "trending" | "new" | "soon" | "year" | "want" | "added" | "requests";

export const ROWS: { id: RowId; title: string; subtitle: string }[] = [
  { id: "trending", title: "Trending this month", subtitle: "What Hardcover readers are picking up" },
  { id: "want", title: "From your Want to Read", subtitle: "On your Hardcover shelf, not in Audiobookshelf yet" },
  { id: "new", title: "New releases", subtitle: "Out in the last month, most popular first" },
  { id: "added", title: "Recently added", subtitle: "Newest in Audiobookshelf" },
  { id: "soon", title: "Coming soon", subtitle: "Releasing in the next two months" },
  { id: "year", title: "Popular this year", subtitle: "Trending on Hardcover over the past year" },
  { id: "requests", title: "Your recent requests", subtitle: "What you've asked for" },
];

const TTL = 6 * 3600_000;
const cache = new Map<string, { at: number; books: HcSummary[] }>();

const day = (d: Date) => d.toISOString().slice(0, 10);

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

export async function discoverRow(id: RowId, userId: number) {
  const hc = () => hardcover();
  const now = new Date();
  switch (id) {
    case "trending":
      return annotate(await cached(id, async () => (await hc().books.trending({ duration: "month", limit: 20 })).items.map(summarizeBook)), userId);
    case "year":
      return annotate(await cached(id, async () => (await hc().books.trending({ duration: "one_year", limit: 20 })).items.map(summarizeBook)), userId);
    case "new": {
      const from = day(new Date(now.getTime() - 30 * 86400_000));
      return annotate(await cached(id, async () => (await hc().books.released({ from, to: day(now), limit: 20 })).items.map(summarizeBook)), userId);
    }
    case "soon": {
      const to = day(new Date(now.getTime() + 60 * 86400_000));
      const from = day(new Date(now.getTime() + 86400_000));
      return annotate(await cached(id, async () => (await hc().books.released({ from, to, limit: 20 })).items.map(summarizeBook)), userId);
    }
    case "want": {
      // Your Want to Read shelf, as of the last reading sync, minus books you already have.
      const ids = (db.prepare("SELECT book_id FROM hc_library WHERE user_id = ? AND status = 1 ORDER BY refreshed_at DESC").all(userId) as { book_id: number }[]).map((r) => r.book_id);
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
  }
}

export { hardcoverBook };
