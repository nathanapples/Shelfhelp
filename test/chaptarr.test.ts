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
  assert.equal(requesterTag("sage", "Requested by {user}"), "Requested by sage");
  assert.equal(requesterTag("sage", "{user}"), "sage");
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
