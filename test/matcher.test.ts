import { test } from "node:test";
import assert from "node:assert/strict";
import { LibraryIndex, matchBook, type AbsItem, type HcBook } from "../server/lib/matcher.ts";
import { cleanAuthor, cleanTitle, parseAbsSeries, splitAuthors, titleVariants } from "../server/lib/normalize.ts";

const item = (id: string, title: string, authors: string, extra: Partial<AbsItem> = {}): AbsItem => ({
  id,
  title,
  authors: splitAuthors(authors),
  series: [],
  ...extra,
});

const library = [
  item("a1", "The Final Empire", "Brandon Sanderson", { series: parseAbsSeries("Mistborn #1"), asin: "B002UZMLXM" }),
  item("a2", "The Well of Ascension", "Brandon Sanderson", { series: parseAbsSeries("Mistborn #2") }),
  item("a3", "The Hero of Ages", "Brandon Sanderson", { series: parseAbsSeries("Mistborn #3") }),
  item("b1", "Project Hail Mary (Unabridged)", "Andy Weir"),
  item("c1", "Dune Messiah", "Frank Herbert", { series: parseAbsSeries("Dune #2") }),
  // Wrong ASIN: points at a book that isn't this one.
  item("d1", "Red Rising", "Pierce Brown", { asin: "WRONGASIN1", series: parseAbsSeries("Red Rising Saga #1") }),
  item("e1", "Harry Potter and the Sorcerer's Stone, Book 1", "J.K. Rowling", { series: parseAbsSeries("Harry Potter #1") }),
  item("f1", "Mistborn: The Final Empire", "Sanderson, Brandon"),
  item("g1", "The Fellowship of the Ring", "J. R. R. Tolkien"),
  item("h1", "Children of Time", "Adrian Tchaikovsky"),
];
const index = new LibraryIndex(library);

const book = (id: number, title: string, authors: string[], extra: Partial<HcBook> = {}): HcBook => ({ id, title, authors, ...extra });

test("normalization", () => {
  assert.equal(cleanTitle("Project Hail Mary (Unabridged)"), "project hail mary");
  assert.equal(cleanTitle("The Way of Kings: Book One of the Stormlight Archive"), "way of kings of the stormlight archive");
  assert.equal(cleanAuthor("Sanderson, Brandon"), "brandon sanderson");
  assert.equal(cleanAuthor("J. R. R. Tolkien"), "jrr tolkien");
  assert.ok(titleVariants("Mistborn: The Final Empire").includes("final empire"));
  assert.deepEqual(parseAbsSeries("Mistborn #1, Cosmere #3.5"), [
    { name: "Mistborn", sequence: 1 },
    { name: "Cosmere", sequence: 3.5 },
  ]);
});

test("edition noise in the title still matches", () => {
  const r = matchBook(book(1, "Project Hail Mary", ["Andy Weir"]), index, new Map());
  assert.equal(r.status, "matched");
  assert.equal(r.absItemId, "b1");
});

test("ID match confirmed by title and author", () => {
  const links = new Map([[2, new Map([["a1", ["asin"]]])]]);
  const r = matchBook(book(2, "The Final Empire", ["Brandon Sanderson"], { seriesName: "Mistborn", seriesPosition: 1 }), index, links);
  assert.equal(r.status, "matched");
  assert.equal(r.absItemId, "a1");
});

test("a wrong ASIN goes to review, not into the collection", () => {
  // Library says d1's ASIN is "Golden Son"; title and author disagree.
  const links = new Map([[3, new Map([["d1", ["asin"]]])]]);
  const r = matchBook(book(3, "Golden Son", ["Pierce Brown"], { seriesName: "Red Rising Saga", seriesPosition: 2 }), index, links);
  assert.notEqual(r.status, "matched");
});

test("a different book in the same series is not matched", () => {
  const r = matchBook(book(4, "Dune", ["Frank Herbert"], { seriesName: "Dune", seriesPosition: 1 }), index, new Map());
  assert.notEqual(r.status, "matched");
});

test("same title with different series numbering still matches", () => {
  // e.g. Foundation is #3 by publication, #13 in chronological order.
  const r = matchBook(
    book(5, "The Well of Ascension", ["Brandon Sanderson"], { seriesName: "Mistborn", seriesPosition: 3 }),
    index,
    new Map(),
  );
  assert.equal(r.status, "matched");
});

test("an ISBN match is trusted even when series numbers differ", () => {
  const idx = new LibraryIndex([
    item("f1", "Second Foundation", "Isaac Asimov", { series: parseAbsSeries("Foundation #13"), asin: "B003IF384Y" }),
  ]);
  const links = new Map([[20, new Map([["f1", ["isbn"]]])]]);
  const r = matchBook(book(20, "Second Foundation", ["Isaac Asimov"], { seriesName: "Foundation", seriesPosition: 3 }), idx, links);
  assert.equal(r.status, "matched");
  assert.ok(r.score >= 90, `score ${r.score}`);
});

test("an ID match with a so-so title is trusted", () => {
  const idx = new LibraryIndex([item("g1", "Leviathan Wakes: The Expanse, Book 1 (Unabridged)", "Corey, James S. A.")]);
  const links = new Map([[21, new Map([["g1", ["asin"]]])]]);
  const r = matchBook(book(21, "Leviathan Wakes", ["Daniel Abraham", "Ty Franck"]), idx, links);
  assert.equal(r.status, "matched");
});

test("series prefix and Last, First author", () => {
  const r = matchBook(book(6, "The Final Empire", ["Brandon Sanderson"]), index, new Map());
  assert.equal(r.status, "matched");
  assert.ok(["a1", "f1"].includes(r.absItemId!));
});

test("American vs UK title variants and series suffix", () => {
  const r = matchBook(book(7, "Harry Potter and the Sorcerer's Stone", ["J.K. Rowling"]), index, new Map());
  assert.equal(r.status, "matched");
  assert.equal(r.absItemId, "e1");
});

test("initials in author names", () => {
  const r = matchBook(book(8, "The Fellowship of the Ring", ["J.R.R. Tolkien"]), index, new Map());
  assert.equal(r.status, "matched");
  assert.equal(r.absItemId, "g1");
});

test("a book not in the library is missing", () => {
  const r = matchBook(book(9, "Children of Memory", ["Adrian Tchaikovsky"]), index, new Map());
  assert.notEqual(r.status, "matched");
});

test("right title, wrong author, goes to review at most", () => {
  const r = matchBook(book(10, "Children of Time", ["Someone Else"]), index, new Map());
  assert.notEqual(r.status, "matched");
});

test("an author stored as Last, First still matches", () => {
  const idx = new LibraryIndex([item("m1", "The Martian", "Weir, Andy")]);
  const r = matchBook(book(11, "The Martian", ["Andy Weir"]), idx, new Map());
  assert.equal(r.status, "matched");
});
