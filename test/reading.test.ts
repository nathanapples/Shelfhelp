import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CONFIG_DIR = mkdtempSync(path.join(tmpdir(), "shelfhelp-test-"));
const { planFor, preferShelved } = await import("../server/lib/reading.ts");

const row = (over: Record<string, unknown>) =>
  ({ abs_item_id: "i", hc_book_id: 1, is_finished: 0, progress: 0.43, finished_at: null, last_update: Date.now(), started_at: null, ...over }) as never;
const entry = (statusId: number, progress?: number, read: Record<string, unknown> = {}) =>
  ({
    id: 9,
    bookId: 1,
    statusId,
    userBookReads: progress === undefined ? [] : [{ id: 50, startedAt: null, finishedAt: null, progress, ...read }],
  }) as never;
const ms = (d: string) => new Date(`${d}T12:00:00`).getTime();

test("listening, not on Hardcover: add as Currently Reading", () => {
  const p = planFor(row({}), undefined);
  assert.equal(p.kind, "add");
  assert.equal(p.status, 2);
});

test("finished, Want to Read on Hardcover: move to Read", () => {
  const p = planFor(row({ is_finished: 1, progress: 1 }), entry(1));
  assert.equal(p.kind, "status");
  assert.equal(p.status, 3);
});

test("never moves a Read book backward", () => {
  assert.equal(planFor(row({}), entry(3)).kind, "skip");
  assert.equal(planFor(row({ is_finished: 1, progress: 1 }), entry(3)).kind, "skip");
});

test("never changes Did Not Finish, even when you finish the book", () => {
  assert.equal(planFor(row({}), entry(5)).kind, "skip");
  assert.equal(planFor(row({ is_finished: 1, progress: 1 }), entry(5)).kind, "skip");
});

test("syncs again once the book is taken off Did Not Finish", () => {
  assert.equal(planFor(row({ is_finished: 1, progress: 1 }), entry(2, 50)).kind, "status");
});

test("only sends progress when it changed", () => {
  assert.equal(planFor(row({ progress: 0.43 }), entry(2, 43)).kind, "none");
  assert.equal(planFor(row({ progress: 0.6 }), entry(2, 43)).kind, "progress");
});

test("holds books under the minimum progress", () => {
  const p = planFor(row({ progress: 0.03 }), undefined);
  assert.equal(p.kind, "held");
  assert.match(p.description, /Under 5%/);
});

test("finished books aren't held by the minimum", () => {
  assert.equal(planFor(row({ progress: 1, is_finished: 1 }), undefined).kind, "add");
});

test("doesn't add new books when adding is off", () => {
  const p = planFor(row({}), undefined, { minProgress: 5, addNew: false });
  assert.equal(p.kind, "held");
});

test("never lowers progress on Hardcover", () => {
  const p = planFor(row({ progress: 0.2 }), entry(2, 60));
  assert.equal(p.kind, "none");
  assert.match(p.description, /further along/);
});


test("fixes reading dates on a book that's already Read", () => {
  const r = row({ is_finished: 1, progress: 1, started_at: ms("2026-02-01"), finished_at: ms("2026-02-18") });
  const p = planFor(r, entry(3, 100, { startedAt: null, finishedAt: "2026-02-20" }));
  assert.equal(p.kind, "dates");
  assert.match(p.description, /started \(none\) → 2026-02-01, finished 2026-02-20 → 2026-02-18/);
});

test("no date change when Hardcover already has the same dates", () => {
  const r = row({ is_finished: 1, progress: 1, started_at: ms("2026-02-01"), finished_at: ms("2026-02-18") });
  assert.equal(planFor(r, entry(3, 100, { startedAt: "2026-02-01", finishedAt: "2026-02-18" })).kind, "skip");
});

test("progress update carries a start date fix", () => {
  const p = planFor(row({ progress: 0.6, started_at: ms("2026-03-05") }), entry(2, 40, { startedAt: "2026-03-09" }));
  assert.equal(p.kind, "progress");
  assert.equal(p.dates?.startedAt, "2026-03-05");
});

test("prefers the copy on your shelves when Hardcover lists a book twice", () => {
  const ranked = [
    { id: 1, titleSim: 1, authorSim: 1 },
    { id: 2, titleSim: 1, authorSim: 1 },
  ];
  assert.equal(preferShelved(ranked, new Set([2]))?.id, 2);
  assert.equal(preferShelved(ranked, new Set([1])), null);
  // A different book on your shelves isn't a substitute.
  assert.equal(preferShelved([{ id: 1, titleSim: 1, authorSim: 1 }, { id: 3, titleSim: 0.5, authorSim: 1 }], new Set([3])), null);
});
