import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Abs, AbsError } from "./lib/abs.js";
import { db, json } from "./lib/db.js";
import { config } from "./lib/config.js";
import { fetchList, fetchSource, myLists, myShelves, shelfCollectionName, resolveList, searchBooks, testHardcover } from "./lib/hardcover.js";
import { getItems, refreshLibrary, searchLibrary } from "./lib/library.js";
import { getSettings, isConfigured, lockedByEnv, saveSettings, type Settings } from "./lib/settings.js";
import { decide, getList, hardcoverUrl, isRunning, pushCollection, rematch, runningLists, statusCounts, syncAll, syncList, type ListRow } from "./lib/sync.js";
import { recentActivity, log } from "./lib/activity.js";
import { reschedule } from "./lib/scheduler.js";
import { decideItem, history, myShelfStatus, readingView, rememberBook, send, skipChange, syncReading, undo, type HcBookView } from "./lib/reading.js";

const COOKIE = "shelfhelp_session";
const MASK = "••••••••";

function sessionValue() {
  return createHash("sha256").update(`shelfhelp:${config.appPassword}`).digest("hex");
}

function authed(req: FastifyRequest): boolean {
  if (!config.appPassword) return true;
  const raw = req.cookies[COOKIE];
  if (!raw) return false;
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return false;
  const a = Buffer.from(un.value);
  const b = Buffer.from(sessionValue());
  return a.length === b.length && timingSafeEqual(a, b);
}

function listView(l: ListRow) {
  return {
    id: l.id,
    sourceType: l.source_type,
    hcListId: l.hc_list_id,
    hcSlug: l.hc_slug,
    hcOwner: l.hc_owner,
    hcUrl: hardcoverUrl(l),
    name: l.name,
    description: l.description,
    absLibraryId: l.abs_library_id,
    absCollectionId: l.abs_collection_id,
    collectionName: l.collection_name,
    removeMissing: !!l.remove_missing,
    keepOrder: !!l.keep_order,
    enabled: !!l.enabled,
    lastSyncedAt: l.last_synced_at,
    lastStatus: l.last_status,
    lastError: l.last_error,
    syncing: isRunning(l.id),
    counts: statusCounts(l.id),
    covers: (
      db.prepare("SELECT cover_url FROM list_books WHERE list_id = ? AND cover_url IS NOT NULL ORDER BY position LIMIT 6").all(l.id) as {
        cover_url: string;
      }[]
    ).map((r) => r.cover_url),
  };
}

function bookView(r: Record<string, unknown>, items: Map<string, ReturnType<typeof itemView> & object>) {
  const candidates = json<{ absItemId: string; score: number; titleSim: number; authorSim: number | null; idVia: string[]; notes: string[] }[]>(
    r.candidates as string,
    [],
  );
  return {
    listId: r.list_id,
    hcBookId: r.hc_book_id,
    position: r.position,
    slug: r.slug,
    hcUrl: r.slug ? `https://hardcover.app/books/${r.slug}` : null,
    title: r.title,
    subtitle: r.subtitle,
    authors: json<string[]>(r.authors as string, []),
    seriesName: r.series_name,
    seriesPosition: r.series_position,
    coverUrl: r.cover_url,
    releaseYear: r.release_year,
    status: r.status,
    matchSource: r.match_source,
    absItemId: r.abs_item_id,
    absItem: r.abs_item_id ? (items.get(r.abs_item_id as string) ?? null) : null,
    score: r.score,
    reasons: json<string[]>(r.reasons as string, []),
    candidates: candidates.map((c) => ({ ...c, item: items.get(c.absItemId) ?? null })),
  };
}

function itemView(i: ReturnType<typeof getItems> extends Map<string, infer V> ? V : never) {
  return {
    id: i.id,
    title: i.title,
    subtitle: i.subtitle,
    authors: i.authors,
    narrators: i.narrators,
    series: i.series,
    asin: i.asin,
    isbn: i.isbn,
    duration: i.duration,
    publishedYear: i.publishedYear,
    coverUrl: `/api/abs/cover/${i.id}`,
  };
}

function booksWithItems(rows: Record<string, unknown>[]) {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.abs_item_id) ids.add(r.abs_item_id as string);
    for (const c of json<{ absItemId: string }[]>(r.candidates as string, [])) ids.add(c.absItemId);
  }
  const items = new Map([...getItems([...ids])].map(([k, v]) => [k, itemView(v)]));
  return rows.map((r) => bookView(r, items));
}

function fail(reply: FastifyReply, err: unknown, code = 400) {
  const message = (err as Error)?.message ?? String(err);
  return reply.code(err instanceof AbsError && err.status === 401 ? 401 : code).send({ error: message });
}

export async function routes(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/auth/") || req.url === "/api/status") return;
    if (!authed(req)) return reply.code(401).send({ error: "Sign in required" });
  });

  app.get("/api/status", async (req) => ({
    version: config.version,
    authRequired: !!config.appPassword,
    signedIn: authed(req),
    configured: isConfigured(),
  }));

  app.post<{ Body: { password?: string } }>("/api/auth/login", async (req, reply) => {
    const given = Buffer.from(req.body?.password ?? "");
    const want = Buffer.from(config.appPassword);
    if (!config.appPassword || (given.length === want.length && timingSafeEqual(given, want))) {
      reply.setCookie(COOKIE, sessionValue(), { signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
      return { ok: true };
    }
    return reply.code(401).send({ error: "Wrong password" });
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  // Settings
  app.get("/api/settings", async () => {
    const s = getSettings();
    return {
      ...s,
      hardcoverToken: s.hardcoverToken ? MASK : "",
      absToken: s.absToken ? MASK : "",
      lockedByEnv: lockedByEnv(),
    };
  });

  app.put<{ Body: Partial<Settings> }>("/api/settings", async (req) => {
    const patch = { ...req.body };
    if (patch.hardcoverToken === MASK) delete patch.hardcoverToken;
    if (patch.absToken === MASK) delete patch.absToken;
    if (patch.syncIntervalMinutes !== undefined) patch.syncIntervalMinutes = Math.max(0, Number(patch.syncIntervalMinutes) || 0);
    if (patch.matchStrictness && !["strict", "balanced", "loose"].includes(patch.matchStrictness)) delete patch.matchStrictness;
    if (patch.readingMinProgress !== undefined) patch.readingMinProgress = Math.min(100, Math.max(0, Number(patch.readingMinProgress) || 0));
    if (patch.absLibraries !== undefined && !Array.isArray(patch.absLibraries)) delete patch.absLibraries;
    delete patch.readingApproved;
    const before = getSettings().matchStrictness;
    const saved = saveSettings(patch);
    reschedule();
    if (["readingMinProgress", "readingAddNew", "readingEnabled", "absLibraries"].some((k) => k in patch)) {
      syncReading("settings changed").catch(() => {});
    }
    if (patch.matchStrictness && patch.matchStrictness !== before) {
      for (const l of db.prepare("SELECT * FROM lists").all() as unknown as ListRow[]) rematch(l);
    }
    return { ...saved, hardcoverToken: saved.hardcoverToken ? MASK : "", absToken: saved.absToken ? MASK : "" };
  });

  app.post<{ Body: { token?: string } }>("/api/settings/test/hardcover", async (req, reply) => {
    try {
      const token = !req.body?.token || req.body.token === MASK ? getSettings().hardcoverToken : req.body.token;
      return await testHardcover(token);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { url?: string; token?: string } }>("/api/settings/test/abs", async (req, reply) => {
    try {
      const s = getSettings();
      const url = (req.body?.url || s.absUrl).replace(/\/+$/, "");
      const token = !req.body?.token || req.body.token === MASK ? s.absToken : req.body.token;
      const abs = new Abs(url, token);
      const me = await abs.me();
      const libraries = await abs.libraries();
      return { username: me.username, type: me.type, canUpdate: me.permissions?.update !== false, libraries };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Audiobookshelf
  app.get<{ Querystring: { all?: string } }>("/api/abs/libraries", async (req, reply) => {
    try {
      const abs = new Abs();
      if (req.query.all === "1") {
        const chosen = getSettings().absLibraries;
        return (await abs.libraries()).map((l) => ({ ...l, selected: !chosen.length || chosen.includes(l.id) }));
      }
      return await abs.selectedLibraries();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/api/abs/cover/:id", async (req, reply) => {
    try {
      const res = await new Abs().cover(req.params.id);
      if (!res.ok || !res.body) return reply.code(res.status || 404).send();
      reply.header("Content-Type", res.headers.get("content-type") ?? "image/jpeg");
      reply.header("Cache-Control", "private, max-age=86400");
      return reply.send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
    } catch {
      return reply.code(404).send();
    }
  });

  app.get<{ Querystring: { libraryId: string; q: string } }>("/api/abs/search", async (req) => {
    return searchLibrary(req.query.libraryId, req.query.q ?? "").map(itemView);
  });

  // Hardcover
  app.get("/api/hardcover/shelves", async (_req, reply) => {
    try {
      return await myShelves();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/hardcover/lists", async (_req, reply) => {
    try {
      return await myLists();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { url: string } }>("/api/hardcover/resolve", async (req, reply) => {
    try {
      const id = await resolveList(req.body.url);
      const { info } = await fetchList(id);
      const m = req.body.url.match(/@([^/\s]+)\/lists/);
      return { ...info, owner: m ? decodeURIComponent(m[1]) : null };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get<{ Querystring: { q: string } }>("/api/hardcover/search", async (req, reply) => {
    try {
      const q = (req.query.q ?? "").trim();
      if (!q) return [];
      const hits = await searchBooks(q);
      // What we already know about each result in your libraries.
      const ids = hits.map((h) => h.id);
      const known = new Map<number, string>();
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        for (const r of db
          .prepare(`SELECT DISTINCT hc_book_id, abs_item_id FROM id_links WHERE hc_book_id IN (${ph})`)
          .all(...ids) as { hc_book_id: number; abs_item_id: string }[])
          known.set(r.hc_book_id, r.abs_item_id);
        for (const r of db
          .prepare(`SELECT hc_book_id, abs_item_id FROM list_books WHERE status = 'matched' AND hc_book_id IN (${ph})`)
          .all(...ids) as { hc_book_id: number; abs_item_id: string }[])
          known.set(r.hc_book_id, r.abs_item_id);
      }
      const shelves = myShelfStatus(ids);
      return hits.map((h) => ({ ...h, absItemId: known.get(h.id) ?? null, mine: shelves.get(h.id) ?? null }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Lists
  app.get("/api/lists", async () => {
    const rows = db.prepare("SELECT * FROM lists ORDER BY name COLLATE NOCASE").all() as unknown as ListRow[];
    return rows.map(listView);
  });

  app.post<{
    Body: { sourceType?: "hardcover_list" | "hardcover_status"; hcListId: number; hcOwner?: string | null; absLibraryId: string; collectionName?: string; removeMissing?: boolean; keepOrder?: boolean };
  }>("/api/lists", async (req, reply) => {
    try {
      const b = req.body;
      const sourceType = b.sourceType === "hardcover_status" ? "hardcover_status" : "hardcover_list";
      const existing = db
        .prepare("SELECT id FROM lists WHERE source_type = ? AND hc_list_id = ? AND abs_library_id = ?")
        .get(sourceType, b.hcListId, b.absLibraryId) as
        | { id: number }
        | undefined;
      if (existing) return reply.code(409).send({ error: "That list is already synced to this library.", id: existing.id });
      const { info } = await fetchSource(sourceType, b.hcListId);
      const res = db
        .prepare(
          `INSERT INTO lists (source_type, hc_list_id, hc_slug, hc_owner, name, description, abs_library_id, collection_name, remove_missing, keep_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceType, b.hcListId, info.slug, b.hcOwner ?? info.owner ?? null, info.name, info.description, b.absLibraryId,
          (b.collectionName || (sourceType === "hardcover_status" ? shelfCollectionName(info.owner, info.name) : info.name)).trim(), b.removeMissing === false ? 0 : 1, b.keepOrder === false ? 0 : 1,
        );
      const id = Number(res.lastInsertRowid);
      log("info", `Added list "${info.name}"`, id);
      syncList(id, { forceLibrary: true }).catch(() => {});
      return listView(getList(id)!);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/api/lists/:id", async (req, reply) => {
    const list = getList(Number(req.params.id));
    if (!list) return reply.code(404).send({ error: "Not found" });
    const rows = db.prepare("SELECT * FROM list_books WHERE list_id = ? ORDER BY position").all(list.id) as Record<string, unknown>[];
    return { ...listView(list), books: booksWithItems(rows) };
  });

  app.patch<{
    Params: { id: string };
    Body: Partial<{ collectionName: string; removeMissing: boolean; keepOrder: boolean; enabled: boolean }>;
  }>("/api/lists/:id", async (req, reply) => {
    const list = getList(Number(req.params.id));
    if (!list) return reply.code(404).send({ error: "Not found" });
    const b = req.body;
    db.prepare("UPDATE lists SET collection_name = ?, remove_missing = ?, keep_order = ?, enabled = ? WHERE id = ?").run(
      (b.collectionName ?? list.collection_name).trim() || list.name,
      b.removeMissing === undefined ? list.remove_missing : b.removeMissing ? 1 : 0,
      b.keepOrder === undefined ? list.keep_order : b.keepOrder ? 1 : 0,
      b.enabled === undefined ? list.enabled : b.enabled ? 1 : 0,
      list.id,
    );
    const updated = getList(list.id)!;
    if (updated.enabled) pushCollection(list.id).catch((e) => log("error", `Couldn't update the collection: ${e.message}`, list.id));
    return listView(updated);
  });

  app.delete<{ Params: { id: string }; Querystring: { deleteCollection?: string } }>("/api/lists/:id", async (req, reply) => {
    const list = getList(Number(req.params.id));
    if (!list) return reply.code(404).send({ error: "Not found" });
    if (req.query.deleteCollection === "1" && list.abs_collection_id) {
      try {
        await new Abs().deleteCollection(list.abs_collection_id);
      } catch (err) {
        if (!(err instanceof AbsError && err.status === 404)) return fail(reply, err);
      }
    }
    db.prepare("DELETE FROM lists WHERE id = ?").run(list.id);
    log("info", `Removed list "${list.name}"`);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/lists/:id/sync", async (req, reply) => {
    const id = Number(req.params.id);
    if (!getList(id)) return reply.code(404).send({ error: "Not found" });
    syncList(id, { forceLibrary: true }).catch(() => {});
    return { started: true };
  });

  app.post("/api/sync", async () => {
    syncAll("manual").catch(() => {});
    return { started: true };
  });

  app.get("/api/sync/state", async () => ({ running: runningLists() }));

  // Review and missing, across all lists (one row per book and library).
  function crossList(status: "review" | "missing" | "ignored") {
    const rows = db
      .prepare(
        `SELECT b.*, l.abs_library_id AS library_id, l.name AS list_name FROM list_books b JOIN lists l ON l.id = b.list_id
         WHERE b.status = ? ORDER BY b.title COLLATE NOCASE`,
      )
      .all(status) as Record<string, unknown>[];
    const seen = new Map<string, { row: Record<string, unknown>; lists: { id: number; name: string }[] }>();
    for (const r of rows) {
      const key = `${r.hc_book_id}:${r.library_id}`;
      if (!seen.has(key)) seen.set(key, { row: r, lists: [] });
      seen.get(key)!.lists.push({ id: r.list_id as number, name: r.list_name as string });
    }
    const groups = [...seen.values()];
    const views = booksWithItems(groups.map((g) => g.row));
    return views.map((v, i) => ({ ...v, libraryId: groups[i].row.library_id, lists: groups[i].lists }));
  }

  app.get("/api/review", async () => crossList("review"));
  app.get("/api/missing", async () => crossList("missing"));
  app.get("/api/ignored", async () => crossList("ignored"));

  app.get("/api/counts", async () => {
    const r = db
      .prepare(
        `SELECT b.status, COUNT(DISTINCT b.hc_book_id || ':' || l.abs_library_id) AS n
         FROM list_books b JOIN lists l ON l.id = b.list_id GROUP BY b.status`,
      )
      .all() as { status: string; n: number }[];
    return Object.fromEntries(r.map((x) => [x.status, x.n]));
  });

  app.post<{ Body: { hcBookId: number; libraryId: string; action: "match" | "ignore" | "missing" | "reset"; absItemId?: string } }>(
    "/api/decisions",
    async (req, reply) => {
      try {
        const { hcBookId, libraryId, action, absItemId } = req.body;
        await decide(hcBookId, libraryId, action, absItemId);
        return { ok: true };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{ Params: { libraryId: string } }>("/api/abs/libraries/:libraryId/refresh", async (req, reply) => {
    try {
      await refreshLibrary(req.params.libraryId, { force: true });
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/activity", async () => recentActivity());

  // Reading progress
  app.get("/api/reading", async () => readingView());

  app.post("/api/reading/sync", async () => {
    // Check Now always re-reads Audiobookshelf, so metadata you just fixed is used.
    syncReading("manual", { force: true }).catch(() => {});
    return { started: true };
  });

  // Sends exactly the changes you picked (or every waiting one). Nothing else.
  app.post<{ Body: { ids?: string[] } }>("/api/reading/send", async (req, reply) => {
    try {
      return await send(req.body?.ids?.length ? req.body.ids : null);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { id: string } }>("/api/reading/skip", async (req) => {
    skipChange(req.body.id);
    return { ok: true };
  });

  app.get("/api/reading/history", async () =>
    history().map((h) => ({
      id: h.id,
      ts: h.ts,
      absItemId: h.abs_item_id,
      hcBookId: h.hc_book_id,
      title: h.title,
      description: h.description,
      kind: h.kind,
      undoneAt: h.undone_at,
      undoNote: h.undo_note,
      coverUrl: `/api/abs/cover/${h.abs_item_id}`,
    })),
  );

  app.post<{ Params: { id: string } }>("/api/reading/history/:id/undo", async (req, reply) => {
    try {
      return { note: await undo(Number(req.params.id)) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { absItemId: string; action: "match" | "ignore" | "missing" | "reset"; hcBookId?: number; hcBook?: HcBookView } }>(
    "/api/reading/decisions",
    async (req, reply) => {
      try {
        const { absItemId, action, hcBookId, hcBook } = req.body;
        const before = db
          .prepare("SELECT hc_book_id, library_id FROM overrides WHERE abs_item_id = ? AND action = 'match'")
          .get(absItemId) as { hc_book_id: number; library_id: string } | undefined;
        const libraryId = decideItem(absItemId, action, hcBookId);
        // One match for both features: tell the collections too.
        if (libraryId && action === "match" && hcBookId) {
          rememberBook(absItemId, hcBook ?? null);
          await decide(hcBookId, libraryId, "match", absItemId);
        } else if (before && action === "reset") {
          await decide(before.hc_book_id, before.library_id, "reset");
        }
        syncReading("decision").catch(() => {});
        return { ok: true };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
