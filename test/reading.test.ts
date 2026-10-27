import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CONFIG_DIR = mkdtempSync(path.join(tmpdir(), "shelfhelp-test-"));
const { planFor } = await import("../server/lib/reading.ts");

const row = (over: Record<string, unknown>) =>
  ({ abs_item_id: "i", hc_book_id: 1, is_finished: 0, progress: 0.43, finished_at: null, last_update: Date.now(), started_at: null, ...over }) as never;
const entry = (statusId: number, progress?: number) =>
  ({ id: 9, bookId: 1, statusId, userBookReads: progress === undefined ? [] : [{ startedAt: "2026-01-01", finishedAt: null, progress }] }) as never;

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

test("leaves Did Not Finish alone while listening", () => {
  assert.equal(planFor(row({}), entry(5)).kind, "skip");
});

test("only sends progress when it changed", () => {
  assert.equal(planFor(row({ progress: 0.43 }), entry(2, 43)).kind, "none");
  assert.equal(planFor(row({ progress: 0.6 }), entry(2, 43)).kind, "progress");
});
