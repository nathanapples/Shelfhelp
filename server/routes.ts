import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { Abs, AbsError } from "./lib/abs.js";
import { db, json } from "./lib/db.js";
import { config } from "./lib/config.js";
import { READER_SCOPES, hardcoverUsage, hardcoverStatus, forgetToken, addToWantToRead, hardcoverProblem, bookDescription, checkHardcoverToken, scopeHelp, bookEditions, fetchList, fetchSource, myLists, myShelves, shelfCollectionName, resolveList, searchBooks, testHardcover, testServerKey } from "./lib/hardcover.js";
import { getItems, refreshLibrary, searchLibrary } from "./lib/library.js";
import { cleanIssuer, getSettings, isConfigured, lockedByEnv, saveSettings, type Settings } from "./lib/settings.js";
import { ensureWantToRead } from "./lib/autolists.js";
import { decide, getList, hardcoverUrl, isRunning, pushCollection, rematch, runningLists, statusCounts, syncAll, syncList, type ListRow } from "./lib/sync.js";
import { recentActivity, log } from "./lib/activity.js";
import { reschedule } from "./lib/scheduler.js";
import { jobsView } from "./lib/progress.js";
import { Chaptarr, chooseFor, localOf, type Format } from "./lib/chaptarr.js";
import { BUILTINS, PAGE, PERSONAL, hasHardcover, isTagRange, defaultRows, loadFeaturedPrompt, discoverRow, tagRows, tagsFor, allTags, listRow, searchLists, addDefaultListRow, backfillDefaultListRows, parseTagRef, tagSource, resetRows, rowInfo, rowInfoFor, rowsFor, saveRows } from "./lib/discover.js";
import { applyDecision, forgetRejection, linkLibrary, linkView, similarInLibrary, unlinkItem } from "./lib/linking.js";
import { ISSUE_KINDS, addComment, createIssue, deleteIssue, issueCounts, issueDetail, listIssues, setIssueStatus } from "./lib/issues.js";
import { canSeeRequest, editionLabel, forgetRequest, requestSource, requestSources, hardcoverBook, inLibrary, listRequests, parseHardcoverRef, refreshRequests, requestBook, requestCounts, requestsFor, retryRequest } from "./lib/requests.js";
import { SIGNIN_SCOPES, checkClient, lastClientAuthFailure, finishSignIn, grantedScopes, hasSignIn, oauthRef, signInConfigured, signOut as hardcoverSignOut, startSignIn } from "./lib/hcauth.js";
import { parseRedirect, type AuthorizationAttempt } from "@hardcover/sdk/oauth";
import { requestRecoveryLink, useRecoveryLink, cloudflareProblem, cloudflareUser, endSession, createSession, oidcCallback, oidcDiscovery, oidcRedirectUri, oidcStart, passwordMatches, publicBase, isHttps, viewer, type Viewer } from "./lib/auth.js";
import { OWNER_ID, absUsers, allUsers, asReader, getUser, readerById, readers, resolveOwner, updateUser, userForAbs, userView, type Reader } from "./lib/users.js";
import { decideItem, history, myShelfStatus, refreshShelves, readingUsers, readingRunning, rematchItem, readingView, rememberBook, send, skipChange, syncReading, undo, type HcBookView } from "./lib/reading.js";

const MASK = "••••••••";

declare module "fastify" {
  interface FastifyRequest {
    viewer: Viewer;
  }
}

/**
 * Someone just connected Hardcover. Reading sync stays off until they turn it
 * on (a first connection turns it off); their shelves are read for Discover,
 * and their Want to Read collection is made.
 */
function hardcoverConnected(userId: number, hadToken: boolean) {
  forgetToken(oauthRef(userId));
  if (!hadToken) updateUser(userId, { reading_enabled: 0 });
  refreshShelves(userId)
    .catch(() => {})
    .finally(() => {
      ensureWantToRead({ userId }).catch(() => {});
      syncReading("Hardcover connected", { userId }).catch(() => {});
    });
}

/**
 * Saves a pasted Hardcover key for someone (null disconnects). A pasted key
 * replaces a Hardcover sign-in, and disconnecting ends both.
 */
async function setHardcoverKey(userId: number, token: string | null) {
  const before = readerById(userId)?.hardcoverToken;
  if (before) forgetToken(before);
  await hardcoverSignOut(userId);
  updateUser(userId, { hardcover_token: token || null });
}

const HC_FLOW_COOKIE = "shelfhelp_hc_signin";
const HC_FLOW_PATH = "/api/hardcover/oauth";
const hcRedirectUri = (req: FastifyRequest) => `${publicBase(req)}${HC_FLOW_PATH}/callback`;

/** What someone who isn't an admin may use. Everything else is admin-only. */
const USER_ROUTES: [string, RegExp][] = [
  ["*", /^\/api\/discover(\/[^/]+)?$/],
  ["GET", /^\/api\/tags\/(genre|mood)$/],
  ["GET", /^\/api\/hardcover\/(search|book|editions|description)$/],
  ["GET", /^\/api\/hardcover\/oauth\/(start|callback)$/],
  ["GET", /^\/api\/abs\/cover\/[^/]+$/],
  ["GET", /^\/api\/library\/similar$/],
  ["GET", /^\/api\/(jobs|counts)$/],
  ["*", /^\/api\/requests(\/.*)?$/],
  ["*", /^\/api\/issues(\/.*)?$/],
  ["*", /^\/api\/reading(\/.*)?$/],
  ["*", /^\/api\/me(\/.*)?$/],
];

function userAllowed(method: string, path: string) {
  return USER_ROUTES.some(([m, re]) => (m === "*" || m === method) && re.test(path));
}

class HttpError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/** The reader a Reading request is about: ?user=<id>, or yourself. Only admins can look at someone else. */
function targetReader(req: FastifyRequest): Reader {
  const asked = Number((req.query as { user?: string } | undefined)?.user);
  const id = asked || req.viewer.user.id;
  if (id !== req.viewer.user.id && req.viewer.user.role !== "admin") throw new HttpError(403, "You can only see your own reading.");
  const r = readerById(id);
  if (!r) throw new HttpError(404, "No such reader.");
  return r;
}

const isAdmin = (req: FastifyRequest) => req.viewer.user.role === "admin";

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
  if (err instanceof HttpError) return reply.code(err.code).send({ error: message });
  return reply.code(err instanceof AbsError && err.status === 401 ? 401 : code).send({ error: message });
}

export async function routes(app: FastifyInstance) {
  try {
    backfillDefaultListRows();
  } catch (err) {
    log("warn", `Couldn't add list collections to the Discover rows: ${(err as Error).message}`);
  }
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const path = req.url.split("?")[0];
    if (path.startsWith("/api/auth/") || path === "/api/status") return;
    const v = await viewer(req);
    if (!v) return reply.code(401).send({ error: "Sign in required" });
    req.viewer = v;
    if (v.user.role !== "admin" && !userAllowed(req.method, path)) return reply.code(403).send({ error: "Only an admin can do that." });
  });

  app.get("/api/status", async (req) => {
    const s = getSettings();
    const v = await viewer(req).catch(() => null);
    return {
      version: config.version,
      authMode: s.authMode,
      authRequired: s.authMode !== "none" || !!config.appPassword,
      passwordLogin: !!config.appPassword,
      recoveryLink: config.logRecoveryLink,
      oidcLabel: s.oidcLabel || "Pocket ID",
      signedIn: !!v,
      signinProblem: !v && s.authMode === "cloudflare" ? cloudflareProblem() : null,
      user: v ? { ...userView(v.user), via: v.via } : null,
      configured: isConfigured(),
      hardcoverSignIn: signInConfigured(s),
      requestsEnabled: s.requestsEnabled && isConfigured().chaptarr,
      requestFormat: s.requestFormat,
    };
  });

  // Emergency / shared password: signs in as the owner.
  app.post<{ Body: { password?: string } }>("/api/auth/login", async (req, reply) => {
    if (!config.appPassword) return reply.code(400).send({ error: "No password is set. Set APP_PASSWORD to use one." });
    if (!passwordMatches(req.body?.password ?? "")) return reply.code(401).send({ error: "Wrong password" });
    await resolveOwner();
    createSession(req, reply, OWNER_ID, "password");
    return { ok: true };
  });

  // Can't sign in: a one-time link goes to the container log.
  app.post("/api/auth/recovery", async (req, reply) => {
    if (!config.logRecoveryLink) return reply.code(404).send({ error: "Sign-in links in the container log are turned off. Set LOG_RECOVERY_LINK=true to use them." });
    return { result: requestRecoveryLink(req) };
  });

  app.get<{ Params: { code: string } }>("/api/auth/recovery/:code", async (req, reply) => {
    if (!config.logRecoveryLink) return reply.redirect("/");
    if (!useRecoveryLink(req.params.code)) {
      return reply.redirect(`/?signin_error=${encodeURIComponent("That sign-in link has expired or was already used. Ask for a new one.")}`);
    }
    await resolveOwner();
    createSession(req, reply, OWNER_ID, "recovery");
    log("warn", "Signed in with a one-time link from the container log");
    return reply.redirect("/settings?tab=auth");
  });

  app.post("/api/auth/logout", async (req, reply) => {
    endSession(req, reply);
    const s = getSettings();
    // Behind Cloudflare Access, signing out of Shelfhelp alone does nothing; send them to Cloudflare's logout.
    return { ok: true, redirect: s.authMode === "cloudflare" && s.cfTeamDomain ? `https://${s.cfTeamDomain}/cdn-cgi/access/logout` : null };
  });

  app.get<{ Querystring: { back?: string } }>("/api/auth/oidc/start", async (req, reply) => {
    if (getSettings().authMode !== "oidc") return reply.redirect("/");
    try {
      return await oidcStart(req, reply, req.query.back ?? "/");
    } catch (err) {
      return reply.redirect(`/?signin_error=${encodeURIComponent((err as Error).message)}`);
    }
  });

  app.get<{ Querystring: Record<string, string> }>("/api/auth/oidc/callback", async (req, reply) => oidcCallback(req, reply));

  // Your account
  app.get("/api/me", async (req) => {
    const u = req.viewer.user;
    let hardcoverUser: string | null = null;
    const r = readerById(u.id)!;
    let hardcoverProblem: string | null = null;
    if (r.hardcoverToken) {
      try {
        const check = await checkHardcoverToken(r.hardcoverToken);
        hardcoverUser = check.username;
        if (check.missing.length) hardcoverProblem = scopeHelp(check.missing, hasSignIn(u.id));
      } catch (err) {
        hardcoverProblem = hasSignIn(u.id)
          ? `Hardcover didn't accept your sign-in: ${(err as Error).message}. Connect again.`
          : `Hardcover didn't accept your key: ${(err as Error).message}`;
      }
    }
    return {
      ...userView(getUser(u.id)!),
      via: req.viewer.via,
      hardcoverUser,
      hardcoverProblem,
      hardcoverScopes: READER_SCOPES,
      hardcoverGranted: hasSignIn(u.id) ? grantedScopes(u.id) : null,
      hardcoverSignIn: signInConfigured(),
    };
  });

  app.put<{ Body: { hardcoverToken?: string | null } }>("/api/me", async (req, reply) => {
    try {
      const u = req.viewer.user;
      const token = req.body?.hardcoverToken;
      if (token === undefined || token === MASK) return { ok: true };
      if (token) {
        const who = await checkHardcoverToken(token);
        if (who.missing.length) return reply.code(400).send({ error: scopeHelp(who.missing) });
        const had = !!readerById(u.id)?.hardcoverToken;
        await setHardcoverKey(u.id, token);
        hardcoverConnected(u.id, had);
        return { ok: true, hardcoverUser: who.username };
      }
      await setHardcoverKey(u.id, null);
      return { ok: true, hardcoverUser: null };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Sign in with Hardcover: connects the signed-in Shelfhelp user's own Hardcover account.
  app.get<{ Querystring: { back?: string } }>(`${HC_FLOW_PATH}/start`, async (req, reply) => {
    const back = req.query.back?.startsWith("/") ? req.query.back : "/account";
    try {
      const attempt = startSignIn(hcRedirectUri(req));
      reply.setCookie(HC_FLOW_COOKIE, JSON.stringify({ attempt, userId: req.viewer.user.id, back }), {
        path: HC_FLOW_PATH,
        httpOnly: true,
        sameSite: "lax",
        secure: isHttps(req),
        signed: true,
        maxAge: 900,
      });
      return reply.redirect(attempt.url);
    } catch (err) {
      return reply.redirect(`${back}${back.includes("?") ? "&" : "?"}hardcover_error=${encodeURIComponent((err as Error).message)}`);
    }
  });

  app.get<{ Querystring: Record<string, string> }>(`${HC_FLOW_PATH}/callback`, async (req, reply) => {
    const raw = req.cookies[HC_FLOW_COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(HC_FLOW_COOKIE, { path: HC_FLOW_PATH });
    let back = "/account";
    const done = (q: string) => reply.redirect(`${back}${back.includes("?") ? "&" : "?"}${q}`);
    try {
      if (!un?.valid || !un.value) throw new Error("The Hardcover sign-in took too long or started in another browser. Try again.");
      const flow = JSON.parse(un.value) as { attempt: AuthorizationAttempt; userId: number; back: string };
      back = flow.back;
      // The person who started the sign-in must be the one finishing it.
      if (flow.userId !== req.viewer.user.id) throw new Error("You were signed in to Shelfhelp as someone else when you started. Try again.");
      let code: string;
      try {
        code = parseRedirect(`${publicBase(req)}${req.url}`, flow.attempt);
      } catch (err) {
        const e = err as Error & { code?: string; description?: string };
        if (e.code === "access_denied") throw err;
        throw new Error(`Hardcover sent you back with an error: ${e.description ? `${e.code}: ${e.description}` : e.message}`);
      }
      const id = req.viewer.user.id;
      const had = !!readerById(id)?.hardcoverToken;
      const previous = readerById(id)?.hardcoverToken;
      if (previous) forgetToken(previous);
      try {
        await finishSignIn(id, flow.attempt, code);
      } catch (err) {
        const e = err as Error & { code?: string; description?: string };
        const why = e.description ? `${e.code ?? e.message}: ${e.description}` : e.message;
        if (lastClientAuthFailure.length) {
          log("warn", `Hardcover refused the client ID and secret: ${lastClientAuthFailure.map((t) => `${t.method} → HTTP ${t.status} ${t.answer}`).join("; ")}`);
        }
        throw new Error(
          e.code === "invalid_client" || /invalid_client/.test(e.message)
            ? `Hardcover didn't accept Shelfhelp's client ID and secret (${why}). Check both in Settings, Hardcover against the developer app; the secret may need to be made again.`
            : `Hardcover didn't finish the sign-in: ${why}`,
        );
      }
      // Signing in replaces a pasted key.
      updateUser(id, { hardcover_token: null });
      forgetToken(oauthRef(id));
      const check = await checkHardcoverToken(oauthRef(id)).catch(() => null);
      hardcoverConnected(id, had);
      log("info", `${userView(getUser(id)!).name} connected Hardcover${check ? ` as @${check.username}` : ""} by signing in`);
      if (check?.missing.length) return done(`hardcover_error=${encodeURIComponent(scopeHelp(check.missing, true))}`);
      return done(`hardcover=connected${check ? `&hardcover_user=${encodeURIComponent(check.username)}` : ""}`);
    } catch (err) {
      const e = err as Error & { code?: string };
      const message = e.code === "access_denied" || /access_denied/.test(e.message) ? "You didn't allow Shelfhelp on Hardcover, so nothing changed." : e.message;
      log("warn", `Hardcover sign-in failed: ${message}`);
      return done(`hardcover_error=${encodeURIComponent(message)}`);
    }
  });

  // Users (admin)
  app.get("/api/users", async (req, reply) => {
    try {
      await resolveOwner();
      const linked = new Map(allUsers().map((u) => [u.abs_user_id, u]));
      const abs = await absUsers(true).catch(() => []);
      const fresh = (req.query as { fresh?: string } | undefined)?.fresh === "1";
      // Whether each person's Hardcover connection works (checked at most hourly unless ?fresh=1).
      const users = await Promise.all(
        allUsers().map(async (u) => {
          const token = readerById(u.id)?.hardcoverToken;
          const hc = token ? await hardcoverStatus(token, fresh).catch((err: Error) => ({ problem: err.message, username: null, checkedAt: Date.now() })) : null;
          return { ...userView(u), hardcoverUser: hc?.username ?? null, hardcoverProblem: hc?.problem ?? null, hardcoverCheckedAt: hc ? new Date(hc.checkedAt).toISOString() : null };
        }),
      );
      return {
        users,
        absUsers: abs.map((a) => ({ ...a, shelfhelpId: linked.get(a.id)?.id ?? null })),
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Adds an Audiobookshelf user as a Shelfhelp user (a reader), optionally with their Hardcover token. */
  app.post<{ Body: { absUserId: string; hardcoverToken?: string } }>("/api/users", async (req, reply) => {
    try {
      const a = (await absUsers(true)).find((x) => x.id === req.body.absUserId);
      if (!a) return reply.code(404).send({ error: "That Audiobookshelf user wasn't found." });
      const u = await userForAbs(a);
      if (req.body.hardcoverToken) {
        const check = await checkHardcoverToken(req.body.hardcoverToken);
        if (check.missing.length) return reply.code(400).send({ error: scopeHelp(check.missing) });
        const had = !!readerById(u.id)?.hardcoverToken;
        await setHardcoverKey(u.id, req.body.hardcoverToken);
        hardcoverConnected(u.id, had);
      }
      return userView(getUser(u.id)!);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put<{ Params: { id: string }; Body: { role?: "admin" | "user"; hardcoverToken?: string | null; readingEnabled?: boolean } }>(
    "/api/users/:id",
    async (req, reply) => {
      try {
        const id = Number(req.params.id);
        const u = getUser(id);
        if (!u) return reply.code(404).send({ error: "No such user." });
        const b = req.body ?? {};
        if (b.role && id !== OWNER_ID) updateUser(id, { role: b.role === "admin" ? "admin" : "user" });
        if (b.readingEnabled !== undefined) updateUser(id, { reading_enabled: b.readingEnabled ? 1 : 0 });
        if (b.hardcoverToken !== undefined && b.hardcoverToken !== MASK) {
          if (b.hardcoverToken) {
            const check = await checkHardcoverToken(b.hardcoverToken);
            if (check.missing.length) return reply.code(400).send({ error: scopeHelp(check.missing) });
          }
          const had = !!readerById(id)?.hardcoverToken;
          await setHardcoverKey(id, b.hardcoverToken || null);
          if (b.hardcoverToken) hardcoverConnected(id, had);
        }
        return userView(getUser(id)!);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/users/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (id === OWNER_ID) return reply.code(400).send({ error: "The owner can't be removed." });
    if (id === req.viewer.user.id) return reply.code(400).send({ error: "You can't remove yourself." });
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM reading WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM hc_library WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM request_users WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return { ok: true };
  });

  app.post<{ Body: { issuer?: string; clientId?: string; internalUrl?: string } }>("/api/settings/test/oidc", async (req, reply) => {
    try {
      const s = getSettings();
      const issuer = cleanIssuer(req.body?.issuer || s.oidcIssuer);
      const internal = cleanIssuer(req.body?.internalUrl ?? s.oidcInternalUrl);
      const base = internal || issuer;
      const res = await fetch(`${base}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) }).catch((err: Error) => {
        throw new Error(`Couldn't reach ${base}: ${(err as Error & { cause?: { code?: string } }).cause?.code ?? err.message}`);
      });
      if (!res.ok) throw new Error(`${base} answered ${res.status}. Is the issuer URL right?`);
      const d = (await res.json()) as { issuer?: string };
      if (d.issuer && d.issuer.replace(/\/+$/, "") !== issuer) {
        throw new Error(`The provider calls itself ${d.issuer}, not ${issuer}. Use that as the issuer URL.`);
      }
      return { issuer: d.issuer ?? issuer, redirectUri: oidcRedirectUri(req) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Settings
  app.get("/api/settings", async (req) => {
    const s = getSettings();
    return {
      ...s,
      hardcoverToken: s.hardcoverToken ? MASK : "",
      absToken: s.absToken ? MASK : "",
      chaptarrApiKey: s.chaptarrApiKey ? MASK : "",
      oidcClientSecret: s.oidcClientSecret ? MASK : "",
      hardcoverClientSecret: s.hardcoverClientSecret ? MASK : "",
      hardcoverRedirectUri: hcRedirectUri(req),
      hardcoverSignInScopes: SIGNIN_SCOPES,
      lockedByEnv: lockedByEnv(),
    };
  });

  app.put<{ Body: Partial<Settings> }>("/api/settings", async (req, reply) => {
    const patch = { ...req.body };
    if (patch.oidcClientSecret === MASK) delete patch.oidcClientSecret;
    if (patch.hardcoverClientSecret === MASK) delete patch.hardcoverClientSecret;
    if (patch.hardcoverClientId !== undefined) patch.hardcoverClientId = String(patch.hardcoverClientId).trim();
    // Switching sign-in modes must not lock you out.
    if (patch.authMode && patch.authMode !== getSettings().authMode) {
      const next = { ...getSettings(), ...patch };
      if (next.authMode === "oidc" && (!next.oidcIssuer || !next.oidcClientId)) {
        return reply.code(400).send({ error: "Add the Pocket ID issuer URL and client ID before turning it on." });
      }
      if (next.authMode === "cloudflare") {
        if (!next.cfTeamDomain || !next.cfAudience) return reply.code(400).send({ error: "Add the Cloudflare team domain and AUD tag first." });
        if (!req.headers["cf-access-jwt-assertion"]) {
          return reply.code(400).send({
            error: "This page didn't come through Cloudflare Access, so turning it on would lock you out. Open Shelfhelp through its Cloudflare address and try again.",
          });
        }
      }
    }
    if (patch.hardcoverToken === MASK) delete patch.hardcoverToken;
    if (patch.absToken === MASK) delete patch.absToken;
    if (patch.chaptarrApiKey === MASK) delete patch.chaptarrApiKey;
    if (patch.requestFormat && !["audiobook", "ebook", "both"].includes(patch.requestFormat)) delete patch.requestFormat;
    for (const k of ["chaptarrAudiobookQuality", "chaptarrEbookQuality", "chaptarrAudiobookMetadata", "chaptarrEbookMetadata"] as const) {
      if (patch[k] !== undefined) patch[k] = Math.max(0, Number(patch[k]) || 0);
    }
    if (patch.syncIntervalMinutes !== undefined) patch.syncIntervalMinutes = Math.max(0, Number(patch.syncIntervalMinutes) || 0);
    if (patch.matchStrictness && !["strict", "balanced", "loose"].includes(patch.matchStrictness)) delete patch.matchStrictness;
    if (patch.readingMinProgress !== undefined) patch.readingMinProgress = Math.min(100, Math.max(0, Number(patch.readingMinProgress) || 0));
    if (patch.absLibraries !== undefined && !Array.isArray(patch.absLibraries)) delete patch.absLibraries;
    delete patch.readingApproved;
    const before = getSettings().matchStrictness;
    const modeBefore = getSettings().authMode;
    const saved = saveSettings(patch);
    // The setting turned on, or Audiobookshelf just connected: make the Want to Read collections now.
    if (patch.autoWantToRead || patch.absUrl || patch.absToken) ensureWantToRead().catch(() => {});
    // Turning on Cloudflare Access: you must still be an admin afterwards, or it's undone.
    if (saved.authMode === "cloudflare" && modeBefore !== "cloudflare") {
      const cf = await cloudflareUser(req).catch(() => null);
      if (!cf || cf.role !== "admin") {
        saveSettings({ authMode: modeBefore });
        return reply.code(400).send({
          error: cf
            ? "Cloudflare signed you in as someone who isn't an admin here, so it wasn't turned on."
            : `Cloudflare's sign-in didn't check out: ${cloudflareProblem() ?? "unknown problem"}. It wasn't turned on.`,
        });
      }
    }
    reschedule();
    if (["absLibraries"].some((k) => k in patch)) {
      syncReading("settings changed").catch(() => {});
    }
    if (patch.matchStrictness && patch.matchStrictness !== before) {
      for (const l of db.prepare("SELECT * FROM lists").all() as unknown as ListRow[]) rematch(l);
    }
    return {
      ...saved,
      hardcoverToken: saved.hardcoverToken ? MASK : "",
      absToken: saved.absToken ? MASK : "",
      chaptarrApiKey: saved.chaptarrApiKey ? MASK : "",
      oidcClientSecret: saved.oidcClientSecret ? MASK : "",
      hardcoverClientSecret: saved.hardcoverClientSecret ? MASK : "",
      hardcoverRedirectUri: hcRedirectUri(req),
      hardcoverSignInScopes: SIGNIN_SCOPES,
    };
  });

  app.post<{ Body: { token?: string } }>("/api/settings/test/hardcover", async (req, reply) => {
    try {
      const token = !req.body?.token || req.body.token === MASK ? getSettings().hardcoverToken : req.body.token;
      return await testServerKey(token);
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Hardcover API usage: the server key (asked now if needed) and each person's connection as last seen. */
  app.get("/api/settings/hardcover-usage", async (_req, reply) => {
    try {
      const key = getSettings().hardcoverToken;
      const server = key ? await hardcoverUsage(key, true) : null;
      const people = allUsers()
        .map((u) => ({ u, token: readerById(u.id)?.hardcoverToken }))
        .filter((x) => !!x.token)
        .map(({ u, token }) => ({ id: u.id, name: userView(u).name, via: userView(u).hardcoverVia, sharesServerKey: token === key }))
        .map(async (p) => ({ ...p, usage: await hardcoverUsage(readerById(p.id)!.hardcoverToken) }));
      return { server, people: await Promise.all(people) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Checks the Hardcover app's client ID and secret (as saved) without anyone signing in.
  app.post("/api/settings/test/hardcover-app", async (req, reply) => {
    try {
      return await checkClient(hcRedirectUri(req));
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
  app.get("/api/hardcover/shelves", async (req, reply) => {
    try {
      const token = readerById(req.viewer.user.id)?.hardcoverToken;
      if (!token) return reply.code(409).send({ error: "Connect your Hardcover account in My account to pick from your shelves." });
      return await myShelves(token);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/hardcover/lists", async (req, reply) => {
    try {
      const token = readerById(req.viewer.user.id)?.hardcoverToken;
      if (!token) return reply.code(409).send({ error: "Connect your Hardcover account in My account to pick from your lists." });
      return await myLists(token);
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
      // A pasted Hardcover link or hc:<id> opens that one book.
      const direct = /hardcover\.app\/books\//i.test(q) || /^hc:\d+$/i.test(q) ? parseHardcoverRef(q) : null;
      const hits = direct ? [await hardcoverBook(direct)].filter((b): b is NonNullable<typeof b> => !!b) : await searchBooks(q);
      // What we already know about each result in your libraries.
      const ids = hits.map((h) => h.id);
      const known = inLibrary(ids);
      const requests = requestsFor(ids);
      const shelves = myShelfStatus(ids, req.viewer.user.id);
      return hits.map((h) => ({ ...h, absItemId: known.get(h.id) ?? null, mine: shelves.get(h.id) ?? null, requests: requests.get(h.id) ?? {} }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** A book's description from Hardcover, for the book popup. */
  app.get<{ Querystring: { id: string } }>("/api/hardcover/description", async (req, reply) => {
    try {
      const id = Number(req.query.id);
      if (!id) return reply.code(400).send({ error: "Which book?" });
      return await bookDescription(id);
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Puts a book on your own Hardcover Want to Read shelf (with your Hardcover account). */
  app.post<{ Body: { hcBookId: number } }>("/api/me/want-to-read", async (req, reply) => {
    try {
      const id = Number(req.body?.hcBookId);
      if (!id) return reply.code(400).send({ error: "Which book?" });
      return await addToWantToRead(req.viewer.user.id, id);
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** A book's editions on Hardcover, for requesting a specific one. */
  app.get<{ Querystring: { book: string } }>("/api/hardcover/editions", async (req, reply) => {
    try {
      const id = Number(req.query.book);
      if (!id) return reply.code(400).send({ error: "Which book?" });
      return (await bookEditions(id)).map((e) => ({ ...e, label: editionLabel(e) }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** One Hardcover book from a link, slug or id, with what Shelfhelp knows about it. */
  app.get<{ Querystring: { ref: string } }>("/api/hardcover/book", async (req, reply) => {
    try {
      const ref = parseHardcoverRef(req.query.ref ?? "");
      if (!ref) return reply.code(400).send({ error: "Paste a hardcover.app book link, a book slug, or a Hardcover book id." });
      const book = await hardcoverBook(ref);
      if (!book) return reply.code(404).send({ error: "Hardcover has no book by that link or id." });
      return {
        ...book,
        absItemId: inLibrary([book.id]).get(book.id) ?? null,
        mine: myShelfStatus([book.id], req.viewer.user.id).get(book.id) ?? null,
        requests: requestsFor([book.id]).get(book.id) ?? {},
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Discover: your rows (or the defaults), and each row's books.
  app.get("/api/discover", async (req) => {
    // Titles the featured prompt row with its question.
    await loadFeaturedPrompt().catch(() => null);
    const { rows, custom } = rowsFor(req.viewer.user.id);
    const chaptarr = isConfigured().chaptarr;
    const connected = hasHardcover(req.viewer.user.id);
    const chips = tagsFor(req.viewer.user.id);
    return {
      // Personal rows need the viewer's own Hardcover account.
      rows: rows.filter((r) => (chaptarr || r.key !== "requests") && (connected || !PERSONAL.has(r.key))).map(rowInfo),
      needsHardcover: !connected && rows.some((r) => PERSONAL.has(r.key)),
      // A connected key that's missing permissions: say so instead of showing empty rows.
      hardcoverProblem: connected && rows.some((r) => PERSONAL.has(r.key)) ? await hardcoverProblem(readerById(req.viewer.user.id)!.hardcoverToken).catch(() => null) : null,
      allRows: rows.filter((r) => chaptarr || r.key !== "requests").map(rowInfo),
      custom,
      defaults: defaultRows().map(rowInfo),
      builtins: Object.entries(BUILTINS)
        .filter(([id]) => chaptarr || id !== "requests")
        .map(([id, b]) => ({ key: id, kind: "builtin", id, ...b })),
      genres: tagRows("genre", chips.genre),
      moods: tagRows("mood", chips.mood),
      show: chips.show,
    };
  });


  /** Every genre or mood on Hardcover, most books first, for All genres / All moods and Customize. */
  app.get<{ Params: { kind: string } }>("/api/tags/:kind", async (req, reply) => {
    try {
      const kind = req.params.kind === "mood" ? "mood" : "genre";
      return await allTags(kind);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put<{ Body: { rows: unknown; asDefault?: boolean; tags?: unknown } }>("/api/discover/rows", async (req, reply) => {
    if (req.body?.asDefault && !isAdmin(req)) return reply.code(403).send({ error: "Only an admin can change the defaults." });
    return { rows: saveRows(req.viewer.user.id, req.body?.rows, !!req.body?.asDefault, req.body?.tags).map(rowInfo) };
  });

  app.delete("/api/discover/rows", async (req) => {
    resetRows(req.viewer.user.id);
    return { ok: true };
  });

  /** Public Hardcover lists matching ?q=, for the Add a row search. */
  app.get<{ Querystring: { q?: string } }>("/api/discover/list-search", async (req, reply) => {
    try {
      return await searchLists(req.query.q?.slice(0, 100) ?? "");
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { ref: string } }>("/api/discover/list", async (req, reply) => {
    try {
      return rowInfo(await listRow(req.body?.ref ?? ""));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** One row's books. With ?full=1, a bigger set and the row's title, for the row's own page. */
  app.get<{ Params: { row: string }; Querystring: { full?: string; range?: string; name?: string } }>("/api/discover/:row", async (req, reply) => {
    try {
      if (req.query.full === "1") {
        const name = req.query.name?.slice(0, 80) || null;
        const [info, books] = await Promise.all([
          rowInfoFor(req.params.row, req.viewer.user.id, name),
          discoverRow(req.params.row, req.viewer.user.id, PAGE, isTagRange(req.query.range) ? req.query.range : "month", name),
        ]);
        return { info, books };
      }
      return await discoverRow(req.params.row, req.viewer.user.id);
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Library links: every Audiobookshelf book matched to Hardcover
  app.get<{ Querystring: { status?: string; q?: string; offset?: string; library?: string } }>("/api/library/links", async (req) =>
    linkView({ status: req.query.status, q: req.query.q, libraryId: req.query.library || null, offset: Number(req.query.offset) || 0 }),
  );

  app.post<{ Body: { force?: boolean } }>("/api/library/link", async (req, reply) => {
    const r = linkLibrary("by you", { force: !!req.body?.force });
    if (r === "not-configured") return reply.code(400).send({ error: "Set up Hardcover and Audiobookshelf first." });
    return { result: r };
  });

  app.get<{ Querystring: { hcBookId: string; title?: string; authors?: string } }>("/api/library/similar", async (req, reply) => {
    try {
      const id = Number(req.query.hcBookId);
      let title = req.query.title ?? "";
      let authors = (req.query.authors ?? "").split("|").filter(Boolean);
      if (!title) {
        const b = await hardcoverBook({ id });
        if (!b) return reply.code(404).send({ error: "No such book" });
        title = b.title;
        authors = b.authors;
      }
      return similarInLibrary({ id, title, authors });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** "Not the same book": unlinks an Audiobookshelf book from a Hardcover book, everywhere. */
  app.post<{ Body: { absItemId: string; hcBookId: number } }>("/api/library/unlink", async (req, reply) => {
    try {
      const { absItemId, hcBookId } = req.body;
      if (!absItemId || !hcBookId) return reply.code(400).send({ error: "Which books?" });
      unlinkItem(absItemId, Number(hcBookId));
      // Collections that had this book re-match without it.
      const lists = db
        .prepare("SELECT DISTINCT list_id FROM list_books WHERE abs_item_id = ? AND hc_book_id = ?")
        .all(absItemId, Number(hcBookId)) as { list_id: number }[];
      for (const l of lists) {
        const list = getList(l.list_id);
        if (list) {
          rematch(list);
          await pushCollection(list.id).catch(() => {});
        }
      }
      linkLibrary("unlink");
      syncReading("unlink").catch(() => {});
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Undo for an unlink. */
  app.post<{ Body: { absItemId: string; hcBookId: number } }>("/api/library/relink", async (req) => {
    forgetRejection(req.body.absItemId, Number(req.body.hcBookId));
    linkLibrary("undo unlink");
    return { ok: true };
  });

  app.post<{ Body: { absItemId: string; action: "match" | "ignore" | "missing" | "reset"; hcBookId?: number; hcBook?: HcBookView } }>(
    "/api/library/decisions",
    async (req, reply) => {
      try {
        const { absItemId, action, hcBookId, hcBook } = req.body;
        const item = getItems([absItemId]).get(absItemId);
        if (!item) return reply.code(404).send({ error: "That book isn't in Audiobookshelf anymore." });
        const before = db
          .prepare("SELECT hc_book_id, library_id FROM overrides WHERE abs_item_id = ? AND action = 'match'")
          .get(absItemId) as { hc_book_id: number; library_id: string } | undefined;
        decideItem(absItemId, action, hcBookId);
        applyDecision(absItemId, action, hcBook ?? null);
        if (action === "match" && hcBookId) {
          rememberBook(absItemId, hcBook ?? null);
          await decide(hcBookId, item.libraryId, "match", absItemId);
        } else if (before && action === "reset") {
          await decide(before.hc_book_id, before.library_id, "reset");
        }
        if (action === "reset") linkLibrary("rematch");
        syncReading("decision").catch(() => {});
        return { ok: true };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  // Chaptarr
  app.post<{ Body: { url?: string; apiKey?: string } }>("/api/settings/test/chaptarr", async (req, reply) => {
    try {
      const s = getSettings();
      const url = (req.body?.url || s.chaptarrUrl).replace(/\/+$/, "");
      const key = !req.body?.apiKey || req.body.apiKey === MASK ? s.chaptarrApiKey : req.body.apiKey;
      const c = new Chaptarr(url, key, s);
      const status = await c.status();
      const [roots, quality, metadata] = await Promise.all([c.rootFolders(), c.qualityProfiles(), c.metadataProfiles()]);
      return {
        appName: status.appName ?? "Chaptarr",
        version: status.version ?? null,
        rootFolders: roots.length,
        qualityProfiles: quality.length,
        metadataProfiles: metadata.length,
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Root folders and profiles to pick from, and what a request would use right now. */
  app.get("/api/chaptarr/options", async (_req, reply) => {
    try {
      const s = getSettings();
      const c = new Chaptarr(undefined, undefined, s);
      const [roots, quality, metadata] = await Promise.all([c.rootFolders(), c.qualityProfiles(), c.metadataProfiles()]);
      return {
        rootFolders: roots.map((r) => ({
          id: r.id,
          name: r.name ?? null,
          path: r.path,
          folderType: r.folderType ?? 0,
          defaultAudiobook: !!r.isEffectiveDefaultAudiobook,
          defaultEbook: !!r.isEffectiveDefaultEbook,
          freeSpace: r.freeSpace ?? null,
        })),
        qualityProfiles: quality.map((p) => ({ id: p.id, name: p.name, profileType: p.profileType ?? null })),
        metadataProfiles: metadata.map((p) => ({ id: p.id, name: p.name, profileType: p.profileType ?? null })),
        using: {
          audiobook: chooseFor("audiobook", s, roots, quality, metadata),
          ebook: chooseFor("ebook", s, roots, quality, metadata),
        },
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Read-only: what Chaptarr says about a term, for testing from the Settings page. */
  app.get<{ Querystring: { term: string; mediaType?: string } }>("/api/chaptarr/lookup", async (req, reply) => {
    try {
      const raw = (req.query.term ?? "").trim();
      if (!raw) return reply.code(400).send({ error: "Enter something to look up." });
      // A Hardcover link or a bare number becomes hc:<id>; anything else goes as typed.
      let term = raw;
      if (/hardcover\.app\/books\//i.test(raw)) {
        const book = await hardcoverBook(parseHardcoverRef(raw)!);
        if (!book) return reply.code(404).send({ error: "Hardcover has no book at that link." });
        term = `hc:${book.id}`;
      } else if (/^\d+$/.test(raw)) term = `hc:${raw}`;
      const mediaType = req.query.mediaType === "audiobook" || req.query.mediaType === "ebook" ? (req.query.mediaType as Format) : undefined;
      const started = Date.now();
      const results = await new Chaptarr().lookup(term, mediaType);
      return {
        term,
        ms: Date.now() - started,
        results: results.slice(0, 20).map((b) => ({
          id: b.id,
          title: b.title ?? null,
          authorTitle: b.authorTitle ?? null,
          authorName: b.author?.authorName ?? null,
          foreignAuthorId: b.author?.foreignAuthorId ?? null,
          foreignBookId: b.foreignBookId ?? null,
          hardcoverBookId: b.hardcoverBookId ?? null,
          mediaType: b.mediaType ?? null,
          monitored: b.monitored ?? null,
          hasFiles: b.hasFiles ?? null,
          grabbed: b.grabbed ?? null,
          narrator: b.narrator ?? null,
          cover: b.remoteCover ?? null,
          inChaptarr: {
            audiobook: localOf(b, "audiobook"),
            ebook: localOf(b, "ebook"),
          },
          editions: Array.isArray(b.editions) ? b.editions.length : null,
        })),
        sample: results[0] ? JSON.stringify(results[0], null, 2).slice(0, 6000) : null,
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Issues: anyone reports and comments; admins resolve, reopen and delete.
  app.get<{ Querystring: { status?: "open" | "resolved" | "all"; book?: string } }>("/api/issues", async (req) => ({
    issues: listIssues(req.query.status ?? "open", Number(req.query.book) || undefined),
    counts: issueCounts(),
    kinds: ISSUE_KINDS,
  }));

  app.get<{ Params: { id: string } }>("/api/issues/:id", async (req, reply) => {
    try {
      return issueDetail(Number(req.params.id));
    } catch (err) {
      return fail(reply, err, 404);
    }
  });

  app.post<{ Body: { hcBookId: number; kind: string; body: string } }>("/api/issues", async (req, reply) => {
    try {
      return await createIssue(req.viewer.user.id, Number(req.body?.hcBookId), req.body?.kind, req.body?.body);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: { body: string } }>("/api/issues/:id/comments", async (req, reply) => {
    try {
      return addComment(Number(req.params.id), req.viewer.user.id, req.body?.body, isAdmin(req));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Admins resolve; anyone can reopen. Either can carry a comment.
  app.put<{ Params: { id: string }; Body: { status: "open" | "resolved"; comment?: string } }>("/api/issues/:id", async (req, reply) => {
    const status = req.body?.status === "resolved" ? "resolved" : "open";
    if (status === "resolved" && !isAdmin(req)) return reply.code(403).send({ error: "Only an admin can resolve issues." });
    try {
      return setIssueStatus(Number(req.params.id), req.viewer.user.id, status, req.body?.comment ?? "");
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/issues/:id", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: "Only an admin can delete issues." });
    deleteIssue(Number(req.params.id));
    return { ok: true };
  });

  // Requests
  const myRequests = (req: FastifyRequest) => {
    const scope = isAdmin(req) ? undefined : req.viewer.user.id;
    return { requests: listRequests(scope), counts: requestCounts(scope), all: isAdmin(req) };
  };

  app.get("/api/requests/sources", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: "Only an admin can do that." });
    return requestSources();
  });

  app.get("/api/requests", async (req) => {
    refreshRequests().catch(() => {});
    return myRequests(req);
  });

  app.post("/api/requests/refresh", async (req) => {
    await refreshRequests(0);
    return myRequests(req);
  });

  app.post<{ Body: { hcBookId: number; format?: "audiobook" | "ebook" | "both"; editions?: { audiobook?: number | null; ebook?: number | null } } }>(
    "/api/requests",
    async (req, reply) => {
    try {
      const id = Number(req.body?.hcBookId);
      if (!id) return reply.code(400).send({ error: "Which book?" });
      const format = req.body.format && ["audiobook", "ebook", "both"].includes(req.body.format) ? req.body.format : getSettings().requestFormat;
      const e = req.body.editions ?? {};
      const editions = { audiobook: Number(e.audiobook) || null, ebook: Number(e.ebook) || null };
      return { outcomes: await requestBook(id, format, req.viewer.user.id, editions) };
    } catch (err) {
      return fail(reply, err);
    }
  },
  );

  app.post<{ Params: { id: string } }>("/api/requests/:id/retry", async (req, reply) => {
    try {
      const id = Number(req.params.id);
      if (!isAdmin(req) && !canSeeRequest(id, req.viewer.user.id)) return reply.code(404).send({ error: "That request is gone." });
      return { outcomes: await retryRequest(id, req.viewer.user.id) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/requests/:id", async (req) => {
    forgetRequest(Number(req.params.id), req.viewer.user.id, isAdmin(req));
    return { ok: true };
  });

  // Lists
  app.get("/api/lists", async () => {
    const rows = db.prepare("SELECT * FROM lists ORDER BY name COLLATE NOCASE").all() as unknown as ListRow[];
    return rows.map(listView);
  });

  app.post<{
    Body: {
      sourceType?: "hardcover_list" | "hardcover_status" | "requests" | "hardcover_tag";
      hcListId: number;
      hcOwner?: string | null;
      /** For hardcover_tag: "genre:<slug>" or "mood:<slug>". hcListId is then 0 (top, all time) or 1 (trending this month). */
      tagRef?: string;
      absLibraryId: string;
      collectionName?: string;
      removeMissing?: boolean;
      keepOrder?: boolean;
    };
  }>("/api/lists", async (req, reply) => {
    try {
      const b = req.body;
      const sourceType = b.sourceType === "hardcover_status" || b.sourceType === "requests" || b.sourceType === "hardcover_tag" ? b.sourceType : "hardcover_list";
      if (sourceType === "hardcover_tag") {
        if (!parseTagRef(b.tagRef)) return reply.code(400).send({ error: "Pick a genre or mood." });
        const range = b.hcListId === 1 ? 1 : 0;
        const dup = db
          .prepare("SELECT id FROM lists WHERE source_type = 'hardcover_tag' AND hc_slug = ? AND hc_list_id = ? AND abs_library_id = ?")
          .get(b.tagRef!, range, b.absLibraryId) as { id: number } | undefined;
        if (dup) return reply.code(409).send({ error: "That's already synced to this library.", id: dup.id });
        const { info } = await tagSource(b.tagRef!, range);
        const res = db
          .prepare(
            `INSERT INTO lists (source_type, hc_list_id, hc_slug, hc_owner, name, description, abs_library_id, collection_name, remove_missing, keep_order, user_id)
             VALUES ('hardcover_tag', ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(range, info.slug, info.name, info.description, b.absLibraryId, (b.collectionName || info.name).trim(), b.removeMissing === false ? 0 : 1, b.keepOrder === false ? 0 : 1);
        const id = Number(res.lastInsertRowid);
        log("info", `Added "${info.name}"`, id);
        syncList(id, { forceLibrary: true }).catch(() => {});
        return listView(getList(id)!);
      }
      // Shelves are read with your own Hardcover connection; lists with the server's key, or yours for a private list.
      const mine = readerById(req.viewer.user.id)?.hardcoverToken || "";
      let userId: number | null = sourceType === "hardcover_status" ? req.viewer.user.id : null;
      if (sourceType === "hardcover_status" && !mine) {
        return reply.code(409).send({ error: "Connect your Hardcover account in My account to sync your shelves." });
      }
      const existing = db
        .prepare("SELECT id FROM lists WHERE source_type = ? AND hc_list_id = ? AND abs_library_id = ? AND user_id IS ?")
        .get(sourceType, b.hcListId, b.absLibraryId, userId) as
        | { id: number }
        | undefined;
      if (existing) return reply.code(409).send({ error: "That list is already synced to this library.", id: existing.id });
      let info;
      if (sourceType === "requests") info = requestSource(b.hcListId).info;
      else if (sourceType === "hardcover_status") info = (await fetchSource(sourceType, b.hcListId, mine)).info;
      else {
        try {
          info = (await fetchSource(sourceType, b.hcListId)).info;
        } catch (err) {
          if (!mine) throw err;
          info = (await fetchSource(sourceType, b.hcListId, mine)).info;
          userId = req.viewer.user.id;
        }
      }
      const res = db
        .prepare(
          `INSERT INTO lists (source_type, hc_list_id, hc_slug, hc_owner, name, description, abs_library_id, collection_name, remove_missing, keep_order, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceType, b.hcListId, info.slug, b.hcOwner ?? info.owner ?? null, info.name, info.description, b.absLibraryId,
          (b.collectionName || (sourceType === "hardcover_status" ? shelfCollectionName(info.owner, info.name) : info.name)).trim(), b.removeMissing === false ? 0 : 1, b.keepOrder === false ? 0 : 1,
          userId,
        );
      const id = Number(res.lastInsertRowid);
      log("info", `Added list "${info.name}"`, id);
      // A public list collection also becomes one of everyone's default Discover rows.
      if (sourceType === "hardcover_list" && userId === null) {
        try {
          addDefaultListRow({ id: b.hcListId, name: info.name, owner: b.hcOwner ?? info.owner ?? null, slug: info.slug });
        } catch (err) {
          log("warn", `Couldn't add "${info.name}" to the Discover rows: ${(err as Error).message}`);
        }
      }
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
  app.get("/api/jobs", async () => jobsView());

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

  app.get("/api/counts", async (req) => {
    const r = db
      .prepare(
        `SELECT b.status, COUNT(DISTINCT b.hc_book_id || ':' || l.abs_library_id) AS n
         FROM list_books b JOIN lists l ON l.id = b.list_id GROUP BY b.status`,
      )
      .all() as { status: string; n: number }[];
    const c = requestCounts(isAdmin(req) ? undefined : req.viewer.user.id);
    const openRequests = (c.pending ?? 0) + (c.requested ?? 0) + (c.downloading ?? 0) + (c.downloaded ?? 0);
    return { ...Object.fromEntries(r.map((x) => [x.status, x.n])), requests: openRequests, issues: issueCounts().open };
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

  // Reading progress. Every route works on ?user=<id> (admins) or yourself.
  app.get("/api/reading", async (req, reply) => {
    try {
      const r = targetReader(req);
      return asReader(r, () => ({ ...readingView(), reader: { id: r.id, name: r.name, hasHardcover: !!r.hardcoverToken, isOwner: r.isOwner } }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/reading/users", async (req) => {
    const me = req.viewer.user;
    const visible = isAdmin(req) ? readers() : [readerById(me.id)!];
    // Admins always see their own card, even before connecting Hardcover.
    if (isAdmin(req) && !visible.some((r) => r.id === me.id)) visible.unshift(readerById(me.id)!);
    return { users: await readingUsers(visible, me.id) };
  });

  app.get("/api/reading/settings", async (req, reply) => {
    try {
      const r = targetReader(req);
      return { enabled: r.enabled, autoSend: r.autoSend, minProgress: r.minProgress, markOwned: r.markOwned };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put<{ Body: { enabled?: boolean; autoSend?: boolean; minProgress?: number; markOwned?: boolean } }>("/api/reading/settings", async (req, reply) => {
    try {
      const r = targetReader(req);
      const b = req.body ?? {};
      const patch: Record<string, number> = {};
      if (b.enabled !== undefined) patch.reading_enabled = b.enabled ? 1 : 0;
      if (b.autoSend !== undefined) patch.reading_auto_send = b.autoSend ? 1 : 0;
      if (b.markOwned !== undefined) patch.reading_mark_owned = b.markOwned ? 1 : 0;
      if (b.minProgress !== undefined) patch.reading_min_progress = Math.min(100, Math.max(0, Number(b.minProgress) || 0));
      updateUser(r.id, patch);
      syncReading("settings changed", { userId: r.id }).catch(() => {});
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/reading/sync", async (req, reply) => {
    try {
      const r = targetReader(req);
      if (!r.enabled) return reply.code(409).send({ error: "Reading progress is turned off. Turn it on with the gear button." });
      if (!r.hardcoverToken) return reply.code(409).send({ error: "Connect a Hardcover account first, under My account." });
      if (readingRunning(r.id)) return { started: false, running: true };
      // Check Now always re-reads Audiobookshelf, so metadata you just fixed is used.
      syncReading("manual", { force: true, userId: r.id }).catch(() => {});
      return { started: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Sends exactly the changes you picked (or every waiting one). Nothing else.
  app.post<{ Body: { ids?: string[] } }>("/api/reading/send", async (req, reply) => {
    try {
      const r = targetReader(req);
      return await asReader(r, () => send(req.body?.ids?.length ? req.body.ids : null));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Forgets a book's match and cached ASIN/ISBN answers, then matches it fresh.
  app.post<{ Body: { absItemId: string } }>("/api/reading/rematch", async (req, reply) => {
    try {
      const r = targetReader(req);
      const { absItemId } = req.body;
      const before = db
        .prepare("SELECT hc_book_id, library_id FROM overrides WHERE abs_item_id = ? AND action = 'match'")
        .get(absItemId) as { hc_book_id: number; library_id: string } | undefined;
      await rematchItem(absItemId);
      if (before) await decide(before.hc_book_id, before.library_id, "reset");
      const res = await syncReading("match again", { userId: r.id });
      return { started: res === "started", running: res === "running" };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { id: string } }>("/api/reading/skip", async (req, reply) => {
    try {
      asReader(targetReader(req), () => skipChange(req.body.id));
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/reading/history", async (req, reply) => {
    try {
      return asReader(targetReader(req), () =>
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
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/reading/history/:id/undo", async (req, reply) => {
    try {
      const r = targetReader(req);
      return { note: await asReader(r, () => undo(Number(req.params.id))) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: { absItemId: string; action: "match" | "ignore" | "missing" | "reset"; hcBookId?: number; hcBook?: HcBookView } }>(
    "/api/reading/decisions",
    async (req, reply) => {
      try {
        const r = targetReader(req);
        const { absItemId, action, hcBookId, hcBook } = req.body;
        const before = db
          .prepare("SELECT hc_book_id, library_id FROM overrides WHERE abs_item_id = ? AND action = 'match'")
          .get(absItemId) as { hc_book_id: number; library_id: string } | undefined;
        const libraryId = asReader(r, () => decideItem(absItemId, action, hcBookId));
        applyDecision(absItemId, action, hcBook ?? null);
        // One match for both features: tell the collections too.
        if (libraryId && action === "match" && hcBookId) {
          asReader(r, () => rememberBook(absItemId, hcBook ?? null));
          await decide(hcBookId, libraryId, "match", absItemId);
        } else if (before && action === "reset") {
          await decide(before.hc_book_id, before.library_id, "reset");
        }
        syncReading("decision", { userId: r.id }).catch(() => {});
        return { ok: true };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
