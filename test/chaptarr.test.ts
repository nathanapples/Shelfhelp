import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CONFIG_DIR = mkdtempSync(path.join(tmpdir(), "shelfhelp-test-"));
const { chooseFor, addBody, localOf, errorText } = await import("../server/lib/chaptarr.ts");
const { parseHardcoverRef } = await import("../server/lib/requests.ts");
const { getSettings } = await import("../server/lib/settings.ts");

const roots = [
  { id: 1, path: "/audiobooks", folderType: 1, isEffectiveDefaultAudiobook: true, audiobook: { qualityProfileId: 1, metadataProfileId: 2 } },
  { id: 2, path: "/ebooks", folderType: 2, isEffectiveDefaultEbook: true, ebook: { qualityProfileId: 3, metadataProfileId: 3 } },
  { id: 3, path: "/mixed", folderType: 0, audiobook: { qualityProfileId: 4, metadataProfileId: 2 }, ebook: null },
];
const quality = [
  { id: 1, name: "M4B", profileType: "audiobook" },
  { id: 4, name: "Any", profileType: "audiobook" },
  { id: 3, name: "EPUB", profileType: "ebook" },
];
const metadata = [
  { id: 2, name: "Audio", profileType: 1 },
  { id: 3, name: "Ebook", profileType: 2 },
];

test("defaults come from the format's default root folder", () => {
  const s = getSettings();
  assert.deepEqual(chooseFor("audiobook", s, roots, quality, metadata), { rootFolderPath: "/audiobooks", qualityProfileId: 1, metadataProfileId: 2, problem: null });
  assert.deepEqual(chooseFor("ebook", s, roots, quality, metadata), { rootFolderPath: "/ebooks", qualityProfileId: 3, metadataProfileId: 3, problem: null });
});

test("your picks win over the folder defaults", () => {
  const s = { ...getSettings(), chaptarrAudiobookRoot: "/mixed", chaptarrAudiobookQuality: 1 };
  const c = chooseFor("audiobook", s, roots, quality, metadata);
  assert.equal(c.rootFolderPath, "/mixed");
  assert.equal(c.qualityProfileId, 1);
  assert.equal(c.metadataProfileId, 2);
});

test("a format with no folder says why", () => {
  const c = chooseFor("ebook", getSettings(), [roots[0]], quality, metadata);
  assert.match(c.problem ?? "", /no root folder for ebooks/);
});

test("the add body asks for this book only, in this format only", () => {
  const found = {
    id: 0,
    title: "Recursion",
    foreignBookId: "hc:113",
    mediaType: "ebook",
    author: { id: 0, authorName: "Blake Crouch", foreignAuthorId: "hc:2113", ebookRootFolderPath: "/x", rootFolderPath: "/legacy", qualityProfileId: 9 },
  };
  const body = addBody(found, "audiobook", { rootFolderPath: "/audiobooks", qualityProfileId: 1, metadataProfileId: 2, problem: null }, true);
  const a = body.author as Record<string, unknown>;
  assert.equal(body.mediaType, "audiobook");
  assert.equal(body.foreignBookId, "hc:113");
  assert.deepEqual(body.addOptions, { addType: "manual", searchForNewBook: true });
  assert.equal(a.audiobookRootFolderPath, "/audiobooks");
  assert.equal(a.audiobookQualityProfileId, 1);
  assert.equal(a.audiobookMetadataProfileId, 2);
  assert.equal(a.audiobookMonitorNewItems, "none");
  assert.equal(a.ebookRootFolderPath, null, "the other format is left unset");
  assert.equal(a.rootFolderPath, undefined, "legacy single fields are dropped");
  assert.equal(a.qualityProfileId, undefined);
  assert.equal((a.addOptions as Record<string, unknown>).monitor, "specificBook");
  assert.equal((a.addOptions as Record<string, unknown>).searchForMissingBooks, false);
  assert.equal(a.audiobookTags, undefined, "no tags unless asked");
  const tagged = addBody(found, "audiobook", { rootFolderPath: "/audiobooks", qualityProfileId: 1, metadataProfileId: 2, problem: null }, true, [4]).author as Record<string, unknown>;
  assert.deepEqual(tagged.audiobookTags, [4]);
  assert.deepEqual(tagged.ebookTags, []);
});

test("finds the copy Chaptarr already has", () => {
  const found = { id: 0, mediaType: "ebook", localAudiobookBooks: [{ id: 12, monitored: false, hasFiles: false }], localEbookBooks: [] };
  assert.equal(localOf(found, "audiobook")?.id, 12);
  assert.equal(localOf(found, "ebook"), null);
  assert.equal(localOf({ id: 5, mediaType: "ebook", hasFiles: true }, "ebook")?.hasFiles, true);
});

test("Chaptarr errors read as one line", () => {
  assert.equal(errorText([{ errorMessage: "A" }, { errorMessage: "A" }, { errorMessage: "B" }], 400), "A B");
  assert.equal(errorText('"No media type is configured"', 400), "No media type is configured");
  assert.equal(errorText({ message: "Ambiguous" }, 409), "Ambiguous");
  assert.equal(errorText(null, 500), "Chaptarr answered 500.");
});

test("Hardcover links, slugs and ids", () => {
  assert.deepEqual(parseHardcoverRef("https://hardcover.app/books/project-hail-mary"), { slug: "project-hail-mary" });
  assert.deepEqual(parseHardcoverRef("https://hardcover.app/books/dune/editions/123?x=1"), { slug: "dune" });
  assert.deepEqual(parseHardcoverRef("427578"), { id: 427578 });
  assert.deepEqual(parseHardcoverRef("hc:12"), { id: 12 });
  assert.deepEqual(parseHardcoverRef("Dark-Matter"), { slug: "dark-matter" });
  assert.equal(parseHardcoverRef("two words"), null);
});

test("an ASIN link counts as owned unless the linker rejected it", async () => {
  const { db } = await import("../server/lib/db.ts");
  const { inLibrary } = await import("../server/lib/requests.ts");
  const now = new Date().toISOString();
  const add = db.prepare("INSERT INTO abs_items (id, library_id, title, authors, narrators, series, seen_at) VALUES (?, 'lib', ?, '[]', '[]', '[]', ?)");
  add.run("good", "Golden Son", now);
  add.run("wrong", "Morning Star", now);
  db.prepare("INSERT INTO id_links (abs_item_id, hc_book_id, via) VALUES ('good', 5, 'asin'), ('wrong', 6, 'asin')").run();
  db.prepare("INSERT INTO library_links (abs_item_id, library_id, status, hc_book_id, updated_at) VALUES ('wrong', 'lib', 'review', 6, ?)").run(now);
  const found = inLibrary([5, 6]);
  assert.equal(found.get(5), "good");
  assert.equal(found.has(6), false);
  db.prepare("UPDATE library_links SET status = 'matched' WHERE abs_item_id = 'wrong'").run();
  assert.equal(inLibrary([6]).get(6), "wrong");
});

test("requester tags and request collections", async () => {
  const { db } = await import("../server/lib/db.ts");
  const { requesterTag, requestSource } = await import("../server/lib/requests.ts");
  assert.equal(requesterTag("Sage", "{user}"), "sage");
  assert.equal(requesterTag("Sage", "req-{user}"), "req-sage");
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (7, 'sage', 'user')").run();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO requests (id, hc_book_id, format, title, authors, status, requested_at, updated_at) VALUES (901, 55, 'audiobook', 'Dune', '[\"Frank Herbert\"]', 'requested', ?, ?)",
  ).run(now, now);
  db.prepare("INSERT INTO request_users (request_id, user_id) VALUES (901, 7)").run();
  const mine = requestSource(7);
  assert.equal(mine.info.name, "Sage's requests");
  assert.deepEqual(mine.books.map((b) => b.id), [55]);
  assert.ok(requestSource(0).books.some((b) => b.id === 55));
});

test("issuer URLs pasted from Pocket ID", async () => {
  const { cleanIssuer } = await import("../server/lib/settings.ts");
  assert.equal(cleanIssuer("https://id.example.com/.well-known/openid-configuration"), "https://id.example.com");
  assert.equal(cleanIssuer(" https://id.example.com/ "), "https://id.example.com");
});

test("Discover rows: starter, defaults, and your own", async () => {
  const { rowsFor, saveRows, resetRows, STARTER_ROWS } = await import("../server/lib/discover.ts");
  const { db } = await import("../server/lib/db.ts");
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (8, 'reader', 'user')").run();
  assert.deepEqual(rowsFor(8).rows.map((r) => r.key), STARTER_ROWS.map((r) => r.key));
  saveRows(1, [{ key: "week", kind: "builtin", id: "week" }, { key: "x", kind: "builtin", id: "nope" }], true);
  assert.deepEqual(rowsFor(8).rows.map((r) => r.key), ["week"]);
  saveRows(8, [{ key: "list-5", kind: "list", listId: 5, title: "Mine" }], false);
  assert.deepEqual(rowsFor(8), { rows: [{ key: "list-5", kind: "list", listId: 5, title: "Mine", owner: null, slug: null }], custom: true });
  resetRows(8);
  assert.equal(rowsFor(8).custom, false);
});

test("Not the same book: no matcher links them again", async () => {
  const { db } = await import("../server/lib/db.ts");
  const { unlinkItem } = await import("../server/lib/linking.ts");
  const { inLibrary } = await import("../server/lib/requests.ts");
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO abs_items (id, library_id, title, authors, narrators, series, seen_at) VALUES ('wrongly', 'lib', 'Book A', '[]', '[]', '[]', ?)").run(now);
  db.prepare("INSERT OR IGNORE INTO id_links (abs_item_id, hc_book_id, via) VALUES ('wrongly', 77, 'asin')").run();
  db.prepare("INSERT INTO item_overrides (abs_item_id, action, hc_book_id) VALUES ('wrongly', 'match', 77)").run();
  assert.equal(inLibrary([77]).get(77), "wrongly");
  unlinkItem("wrongly", 77);
  assert.equal(inLibrary([77]).has(77), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_overrides WHERE abs_item_id = 'wrongly'").get()!.n, 0);
});

test("issues: report, comment, resolve, reopen", async () => {
  const { db } = await import("../server/lib/db.ts");
  const { addComment, issueCounts, issueDetail, listIssues, setIssueStatus } = await import("../server/lib/issues.ts");
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (9, 'sage', 'user')").run();
  const r = db.prepare("INSERT INTO issues (hc_book_id, title, kind, created_by) VALUES (110, 'The Way of Kings', 'audio', 9)").run();
  const id = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO issue_comments (issue_id, user_id, body) VALUES (?, 9, 'Skips at 3h')").run(id);
  addComment(id, 1, "Looking");
  assert.equal(listIssues("open", 110)[0].comments, 2);
  setIssueStatus(id, 1, "resolved");
  assert.equal(issueDetail(id).status, "resolved");
  assert.equal(issueDetail(id).thread.at(-1)!.event, "resolved");
  assert.equal(listIssues("open", 110).length, 0);
  setIssueStatus(id, 1, "open");
  assert.equal(issueCounts().open >= 1, true);
  assert.throws(() => addComment(id, 9, "   "));
});

test("issues: only open issues take comments from readers; anyone reopens", async () => {
  const { db } = await import("../server/lib/db.ts");
  const { addComment, issueDetail, setIssueStatus } = await import("../server/lib/issues.ts");
  const r = db.prepare("INSERT INTO issues (hc_book_id, title, kind, created_by) VALUES (111, 'Hyperion', 'other', 9)").run();
  const id = Number(r.lastInsertRowid);
  setIssueStatus(id, 1, "resolved", "Fixed the file");
  const t = issueDetail(id).thread;
  assert.deepEqual(t.slice(-2).map((c) => c.event ?? c.body), ["Fixed the file", "resolved"]);
  assert.throws(() => addComment(id, 9, "still broken"), /Reopen/);
  addComment(id, 1, "admin note", true);
  setIssueStatus(id, 9, "open", "Still skips at 2h");
  const after = issueDetail(id);
  assert.equal(after.status, "open");
  assert.deepEqual(after.thread.slice(-2).map((c) => c.event ?? c.body), ["reopened", "Still skips at 2h"]);
});
