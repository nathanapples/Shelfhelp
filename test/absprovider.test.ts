import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CONFIG_DIR = mkdtempSync(path.join(tmpdir(), "shelfhelp-test-"));
const { audioEditions, editionMatch, keyMatches, providerKey, rotateProviderKey } = await import("../server/lib/absprovider.ts");
const { getSettings } = await import("../server/lib/settings.ts");

const ed = (o: Record<string, unknown>) =>
  ({
    id: 1, format: "audiobook", title: null, narrators: [], publisher: null, language: null, releaseDate: null, audioSeconds: null,
    pages: null, asin: null, isbn13: null, isbn10: null, editionFormat: null, coverUrl: null, readers: 0, ...o,
  }) as never;

test("audiobook editions: most read first, language filter keeps unknown languages", () => {
  const list = [
    ed({ id: 1, readers: 5, language: "English" }),
    ed({ id: 2, readers: 50, language: "German" }),
    ed({ id: 3, readers: 20, language: null }),
    ed({ id: 4, readers: 99, format: "print" }),
  ];
  assert.deepEqual(audioEditions(list, "").map((e: { id: number }) => e.id), [2, 3, 1]);
  assert.deepEqual(audioEditions(list, "english").map((e: { id: number }) => e.id), [3, 1]);
});

test("an edition becomes an Audiobookshelf match with minutes, narrators and the book's series", () => {
  const book = {
    id: 9, title: "The Sign of the Four", subtitle: null, releaseYear: 1890,
    description: "First paragraph.\n\nSecond <one>.",
    cachedImage: { url: "https://img/book.jpg" },
    cachedTags: { Genre: [{ tag: "Mystery" }, { tag: "Classics" }], Mood: [{ tag: "dark" }] },
    contributions: [{ contribution: null, author: { name: "Arthur Conan Doyle" } }, { contribution: "Narrator", author: { name: "Someone" } }],
    bookSeries: [{ position: 2, series: { name: "Sherlock Holmes" } }],
  };
  const m = editionMatch(book, ed({ narrators: ["Ada Reader", "Felix Voice"], audioSeconds: 18_030, publisher: "Audio House", asin: "B000000001", releaseDate: "2021-05-04", language: "English" }), getSettings());
  assert.equal(m.title, "The Sign of the Four");
  assert.equal(m.author, "Arthur Conan Doyle");
  assert.equal(m.narrator, "Ada Reader, Felix Voice");
  assert.equal(m.duration, 301);
  assert.equal(m.publisher, "Audio House");
  assert.equal(m.publishedYear, "2021");
  assert.equal(m.cover, "https://img/book.jpg");
  assert.deepEqual(m.series, [{ series: "Sherlock Holmes", sequence: "2" }]);
  assert.deepEqual(m.genres, ["Mystery", "Classics"]);
  assert.deepEqual(m.tags, ["dark"]);
  assert.equal(m.description, "<p>First paragraph.</p><p>Second &lt;one&gt;.</p>");
  assert.equal("isbn" in m, false);
});

test("the provider key: exact match, Bearer allowed, a new key replaces the old", () => {
  const k = providerKey();
  assert.ok(keyMatches(k));
  assert.ok(keyMatches(`Bearer ${k}`));
  assert.ok(!keyMatches(undefined));
  assert.ok(!keyMatches(`${k}x`));
  const k2 = rotateProviderKey();
  assert.notEqual(k, k2);
  assert.ok(!keyMatches(k));
  assert.ok(keyMatches(k2));
});

test("book editions: ebooks first, then print, most read first, no audiobooks", async () => {
  const { textEditions } = await import("../server/lib/absprovider.ts");
  const list = [
    ed({ id: 1, format: "print", readers: 900 }),
    ed({ id: 2, format: "ebook", readers: 10 }),
    ed({ id: 3, format: "audiobook", readers: 5000 }),
    ed({ id: 4, format: "ebook", readers: 50, language: "German" }),
    ed({ id: 5, format: "print", readers: 20 }),
  ];
  assert.deepEqual(textEditions(list, "").map((e: { id: number }) => e.id), [4, 2, 1, 5]);
  assert.deepEqual(textEditions(list, "English").map((e: { id: number }) => e.id), [2, 1, 5]);
});

test("a print edition becomes a match with its ISBN and publisher, no narrator or length", () => {
  const book = { id: 9, title: "Dracula", releaseYear: 1897, contributions: [{ contribution: null, author: { name: "Bram Stoker" } }] };
  const m = editionMatch(book, ed({ format: "print", isbn13: "9780000000001", publisher: "Classic House", releaseDate: "2003-01-01", pages: 400 }), getSettings());
  assert.equal(m.isbn, "9780000000001");
  assert.equal(m.publisher, "Classic House");
  assert.equal(m.publishedYear, "2003");
  assert.equal("narrator" in m, false);
  assert.equal("duration" in m, false);
});

test("Shelfhelp's two provider entries are told apart by their address", async () => {
  const { kindOf } = await import("../server/lib/absprovider.ts");
  const p = (url: string) => ({ id: "x", name: "x", mediaType: "book", url });
  assert.equal(kindOf(p("http://shelfhelp:5075/api/abs-provider")), "audio");
  assert.equal(kindOf(p("http://shelfhelp:5075/api/abs-provider/")), "audio");
  assert.equal(kindOf(p("http://shelfhelp:5075/api/abs-provider/books")), "books");
  assert.equal(kindOf(p("http://other/provider")), null);
});
