import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CONFIG_DIR = mkdtempSync(path.join(tmpdir(), "shelfhelp-test-"));
const { addDefaultListRow, backfillDefaultListRows, defaultRows, parseTagRef, STARTER_ROWS } = await import("../server/lib/discover.ts");
const { db } = await import("../server/lib/db.ts");
const { getSettings } = await import("../server/lib/settings.ts");

const listKeys = () => defaultRows().filter((r) => r.kind === "list").map((r) => r.key);

test("a list collection joins the default rows after the starter rows, once", () => {
  addDefaultListRow({ id: 83230, name: "100 Best", owner: "hardcover", slug: "100-best" });
  addDefaultListRow({ id: 83230, name: "100 Best", owner: "hardcover", slug: "100-best" });
  const rows = defaultRows();
  assert.equal(rows.length, STARTER_ROWS.length + 1);
  assert.deepEqual(listKeys(), ["list-83230"]);
});

test("backfill adds existing public list collections only, and only once", () => {
  const add = db.prepare(
    "INSERT INTO lists (source_type, hc_list_id, hc_slug, hc_owner, name, abs_library_id, collection_name, user_id) VALUES (?, ?, ?, ?, ?, 'lib', ?, ?)",
  );
  add.run("hardcover_list", 5, "five", "someone", "Five", "Five", null);
  add.run("hardcover_list", 6, "six", "me", "Private six", "Six", 1);
  add.run("hardcover_status", 1, "want-to-read", "me", "Want to Read", "Want", 1);
  add.run("hardcover_tag", 0, "genre:fantasy", null, "Top Fantasy", "Fantasy", null);
  backfillDefaultListRows();
  assert.deepEqual(listKeys(), ["list-83230", "list-5"]);
  assert.equal(getSettings().discoverListRowsAdded, true);
  add.run("hardcover_list", 7, "seven", "someone", "Seven", "Seven", null);
  backfillDefaultListRows();
  assert.deepEqual(listKeys(), ["list-83230", "list-5"]);
});

test("genre and mood refs", () => {
  assert.deepEqual(parseTagRef("genre:science-fiction"), { kind: "genre", slug: "science-fiction" });
  assert.deepEqual(parseTagRef("mood:dark"), { kind: "mood", slug: "dark" });
  assert.equal(parseTagRef("list:5"), null);
  assert.equal(parseTagRef(null), null);
});

test("list rows sort the whole list, Random is stable for a seed", async () => {
  const { sortList } = await import("../server/lib/discover.ts");
  const b = (id: number, title: string, year: number | null, author: string) => ({ id, title, releaseYear: year, authors: [author] }) as never;
  const list = [b(1, "The Demolished Man", 1953, "Alfred Bester"), b(2, "Dune", 1965, "Frank Herbert"), b(3, "A Memory Called Empire", 2020, "Arkady Martine"), b(4, "Undated", null, "Zed Writer")];
  const ids = (l: { id: number }[]) => l.map((x) => x.id).join();
  assert.equal(ids(sortList(list, "list")), "1,2,3,4");
  assert.equal(ids(sortList(list, "newest")), "3,2,1,4");
  assert.equal(ids(sortList(list, "oldest")), "1,2,3,4");
  assert.equal(ids(sortList(list, "title")), "1,2,3,4"); // "The" and "A" are ignored
  assert.equal(ids(sortList(list, "author")), "1,2,3,4");
  assert.equal(ids(sortList(list, "random", 42)), ids(sortList(list, "random", 42)));
  assert.equal(sortList(list, "random", 42).length, 4);
});

test("rows keep enough books whether owned ones show or not", async () => {
  const { mixOwned } = await import("../server/lib/discover.ts");
  const books = Array.from({ length: 30 }, (_, i) => ({ id: i, absItemId: i < 26 ? `a${i}` : null }));
  const out = mixOwned(books, 3);
  assert.equal(out.filter((b) => !b.absItemId).length, 3);
  assert.equal(out.filter((b) => b.absItemId).length, 3);
  assert.deepEqual(out.map((b) => b.id), [0, 1, 2, 26, 27, 28]);
});
