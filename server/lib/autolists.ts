/**
 * Collections Shelfhelp makes on its own: each reader's Hardcover Want to Read
 * shelf, as soon as they connect Hardcover. Each is made once; if you delete
 * one, it isn't made again.
 */
import { db } from "./db.js";
import { Abs } from "./abs.js";
import { getSettings, isConfigured } from "./settings.js";
import { getUser, readers, updateUser, type Reader } from "./users.js";
import { shelfCollectionName, testHardcover } from "./hardcover.js";
import { log } from "./activity.js";

const WANT_TO_READ = 1;

export async function ensureWantToRead({ userId, sync = true }: { userId?: number; sync?: boolean } = {}) {
  const s = getSettings();
  if (!s.autoWantToRead || !isConfigured().abs) return [];
  const who: Reader[] = readers().filter((r) => r.hardcoverToken && (userId === undefined || r.id === userId));
  const todo = who.filter((r) => !getUser(r.id)?.want_list_at);
  if (!todo.length) return [];
  const library = (await new Abs().selectedLibraries())[0];
  if (!library) return [];
  const made: number[] = [];
  for (const r of todo) {
    // A Want to Read collection someone already set up counts (the owner's may predate this).
    const existing = db
      .prepare("SELECT id FROM lists WHERE source_type = 'hardcover_status' AND hc_list_id = ? AND user_id = ?")
      .get(WANT_TO_READ, r.id) as { id: number } | undefined;
    if (!existing) {
      const hcUser = (await testHardcover(r.hardcoverToken).catch(() => null))?.username ?? null;
      const name = shelfCollectionName(hcUser && hcUser !== "unknown" ? hcUser : r.name, "Want to Read");
      const res = db
        .prepare(
          `INSERT INTO lists (source_type, hc_list_id, hc_slug, hc_owner, name, description, abs_library_id, collection_name, remove_missing, keep_order, user_id)
           VALUES ('hardcover_status', ?, 'want-to-read', ?, 'Want to Read', ?, ?, ?, 1, 1, ?)`,
        )
        .run(WANT_TO_READ, hcUser, "Books on your Want to Read shelf.", library.id, name, r.id);
      const id = Number(res.lastInsertRowid);
      made.push(id);
      log("info", `Made "${name}" for ${r.name}`, id);
    }
    updateUser(r.id, { want_list_at: new Date().toISOString() });
  }
  if (sync && made.length) {
    const { syncList } = await import("./sync.js");
    for (const id of made) await syncList(id, { forceLibrary: true }).catch(() => {});
  }
  return made;
}
