/**
 * Who is using Shelfhelp.
 *
 * - none: no sign-in. Everyone is the owner. APP_PASSWORD, if set, is asked
 *   for first.
 * - oidc: sign in with an OpenID Connect provider such as Pocket ID. The
 *   person is matched to their Audiobookshelf account by verified email,
 *   then username, the same way Audiobookshelf links OpenID accounts.
 * - cloudflare: Cloudflare Access signs people in; Shelfhelp checks the
 *   signed token Cloudflare adds to each request and reads the email from it.
 *
 * In every mode APP_PASSWORD (if set) also works as an emergency sign-in for
 * the owner, so a broken provider can't lock you out.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import { db } from "./db.js";
import { getSettings } from "./settings.js";
import { log } from "./activity.js";
import { OWNER_ID, getUser, matchAbsUser, resolveOwner, updateUser, userForAbs, type UserRow } from "./users.js";

export type Via = "open" | "password" | "oidc" | "cloudflare" | "recovery";
export interface Viewer {
  user: UserRow;
  via: Via;
}

export const SESSION_COOKIE = "shelfhelp_session";
const FLOW_COOKIE = "shelfhelp_oidc";
const SESSION_DAYS = 30;

// ---------------------------------------------------------------------------
// Sessions

export function isHttps(req: FastifyRequest) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return (proto || req.protocol) === "https";
}

/** The address the browser used to reach Shelfhelp, behind any proxy. */
export function publicBase(req: FastifyRequest) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() || req.protocol;
  const host = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() || req.headers.host || `localhost:${config.port}`;
  return `${proto}://${host}`;
}

export function createSession(req: FastifyRequest, reply: FastifyReply, userId: number, via: Via) {
  const id = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare("INSERT INTO sessions (id, user_id, via, expires_at) VALUES (?, ?, ?, ?)").run(id, userId, via, expires.toISOString());
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  updateUser(userId, { last_login_at: new Date().toISOString() });
  reply.setCookie(SESSION_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    signed: true,
    expires,
  });
}

function sessionViewer(req: FastifyRequest): Viewer | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  const row = db.prepare("SELECT user_id, via, expires_at FROM sessions WHERE id = ?").get(un.value) as
    | { user_id: number; via: Via; expires_at: string }
    | undefined;
  if (!row || row.expires_at < new Date().toISOString()) return null;
  // A password session only counts while a password is set.
  if (row.via === "password" && !config.appPassword) return null;
  const user = getUser(row.user_id);
  return user ? { user, via: row.via } : null;
}

export function endSession(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[SESSION_COOKIE];
  const un = raw ? req.unsignCookie(raw) : null;
  if (un?.valid && un.value) db.prepare("DELETE FROM sessions WHERE id = ?").run(un.value);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function passwordMatches(password: string) {
  if (!config.appPassword) return false;
  const a = createHash("sha256").update(password).digest();
  const b = createHash("sha256").update(config.appPassword).digest();
  return timingSafeEqual(a, b);
}

/** Who is making this request, or null if they need to sign in. */
export async function viewer(req: FastifyRequest): Promise<Viewer | null> {
  const s = getSettings();
  const session = sessionViewer(req);
  if (session) {
    // Sessions from another sign-in mode don't carry over, except the emergency password.
    const ok =
      session.via === "password" ||
      session.via === "recovery" ||
      (s.authMode === "oidc" && session.via === "oidc") ||
      (s.authMode === "none" && session.via === "open");
    if (ok) return session;
  }
  if (s.authMode === "cloudflare") {
    const user = await cloudflareUser(req);
    if (user) return { user, via: "cloudflare" };
    return null;
  }
  if (s.authMode === "none" && !config.appPassword) return { user: getUser(OWNER_ID)!, via: "open" };
  return null;
}

// ---------------------------------------------------------------------------
// OpenID Connect (Pocket ID and friends)

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  end_session_endpoint?: string;
}

let discovered: { key: string; at: number; d: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

/** Reads the provider's configuration. With an internal URL, server-to-server calls go there instead. */
export async function oidcDiscovery(fresh = false) {
  const s = getSettings();
  if (!s.oidcIssuer || !s.oidcClientId) throw new Error("Pocket ID isn't set up: add the issuer URL and client ID in Settings, Users.");
  const key = `${s.oidcIssuer}|${s.oidcInternalUrl}`;
  if (!fresh && discovered?.key === key && Date.now() - discovered.at < 3600_000) return discovered;
  const base = s.oidcInternalUrl || s.oidcIssuer;
  const res = await fetch(`${base}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) }).catch((err: Error) => {
    throw new Error(`Couldn't reach ${base}: ${(err as Error & { cause?: { code?: string } }).cause?.code ?? err.message}`);
  });
  if (!res.ok) throw new Error(`${base} answered ${res.status} for its OpenID configuration.`);
  const d = (await res.json()) as Discovery;
  if (s.oidcInternalUrl) {
    // Shelfhelp talks to the provider at the internal address; browsers still use the public one.
    const pub = new URL(s.oidcIssuer).origin;
    const internal = new URL(s.oidcInternalUrl).origin;
    const inside = (u?: string) => (u ? u.replace(pub, internal) : u);
    d.token_endpoint = inside(d.token_endpoint)!;
    d.jwks_uri = inside(d.jwks_uri)!;
    d.userinfo_endpoint = inside(d.userinfo_endpoint);
    d.authorization_endpoint = d.authorization_endpoint.replace(internal, pub);
  }
  discovered = { key, at: Date.now(), d, jwks: createRemoteJWKSet(new URL(d.jwks_uri)) };
  return discovered;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function oidcRedirectUri(req: FastifyRequest) {
  return `${publicBase(req)}/api/auth/oidc/callback`;
}

export async function oidcStart(req: FastifyRequest, reply: FastifyReply, back = "/") {
  const s = getSettings();
  const { d } = await oidcDiscovery();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  reply.setCookie(FLOW_COOKIE, JSON.stringify({ state, nonce, verifier, back: back.startsWith("/") ? back : "/" }), {
    path: "/api/auth/oidc",
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    signed: true,
    maxAge: 600,
  });
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: s.oidcClientId,
    redirect_uri: oidcRedirectUri(req),
    scope: s.oidcAdminGroup ? "openid email profile groups" : "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return reply.redirect(url.toString());
}

class SignInError extends Error {}

export async function oidcCallback(req: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) {
  const fail = (msg: string) => {
    log("warn", `Sign-in failed: ${msg}`);
    return reply.redirect(`/?signin_error=${encodeURIComponent(msg)}`);
  };
  try {
    const q = req.query;
    if (q.error) throw new SignInError(q.error_description || q.error);
    const raw = req.cookies[FLOW_COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(FLOW_COOKIE, { path: "/api/auth/oidc" });
    if (!un?.valid || !un.value) throw new SignInError("The sign-in took too long or started in another browser. Try again.");
    const flow = JSON.parse(un.value) as { state: string; nonce: string; verifier: string; back: string };
    if (!q.state || q.state !== flow.state) throw new SignInError("The sign-in didn't match. Try again.");
    if (!q.code) throw new SignInError("No code came back from the provider.");

    const s = getSettings();
    const { d, jwks } = await oidcDiscovery();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: q.code,
      redirect_uri: oidcRedirectUri(req),
      code_verifier: flow.verifier,
      client_id: s.oidcClientId,
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    const methods = d.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
    if (s.oidcClientSecret) {
      if (methods.includes("client_secret_basic") || !methods.includes("client_secret_post")) {
        headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(s.oidcClientId)}:${encodeURIComponent(s.oidcClientSecret)}`).toString("base64")}`;
      } else body.set("client_secret", s.oidcClientSecret);
    }
    const res = await fetch(d.token_endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !tokens.id_token) throw new SignInError(tokens.error_description || tokens.error || `The provider answered ${res.status}.`);

    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: d.issuer || s.oidcIssuer, audience: s.oidcClientId });
    if (payload.nonce !== flow.nonce) throw new SignInError("The sign-in didn't match. Try again.");
    let claims = payload as Record<string, unknown>;
    if (!claims.email && d.userinfo_endpoint && tokens.access_token) {
      const info = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then((r) => (r.ok ? r.json() : {}));
      claims = { ...info, ...claims };
    }
    const user = await userForClaims({
      sub: String(claims.sub),
      email: (claims.email as string) ?? null,
      emailVerified: claims.email_verified as boolean | undefined,
      username: (claims.preferred_username as string) ?? null,
      name: (claims.name as string) ?? null,
      groups: Array.isArray(claims.groups) ? (claims.groups as string[]) : [],
    });
    createSession(req, reply, user.id, "oidc");
    log("info", `${user.display_name || user.username} signed in with ${s.oidcLabel || "OpenID"}`);
    return reply.redirect(flow.back || "/");
  } catch (err) {
    return fail(err instanceof SignInError ? err.message : `Sign-in failed: ${(err as Error).message}`);
  }
}

/** The Shelfhelp user for someone the provider signed in. */
async function userForClaims(c: { sub: string; email: string | null; emailVerified?: boolean; username: string | null; name: string | null; groups: string[] }) {
  const s = getSettings();
  await resolveOwner();
  let user = db.prepare("SELECT * FROM users WHERE oidc_sub = ?").get(c.sub) as unknown as UserRow | undefined;
  if (!user) {
    const abs = await matchAbsUser({ email: c.email, emailVerified: c.emailVerified, username: c.username });
    if (!abs) {
      throw new SignInError(
        `There's no Audiobookshelf account for ${c.email ?? c.username ?? "you"}. Ask the admin to give your Audiobookshelf account the same email.`,
      );
    }
    user = await userForAbs(abs);
    // This sign-in now belongs to that user.
    db.prepare("UPDATE users SET oidc_sub = NULL WHERE oidc_sub = ?").run(c.sub);
    updateUser(user.id, { oidc_sub: c.sub });
  }
  const patch: Partial<UserRow> = {};
  if (c.name) patch.display_name = c.name;
  if (s.oidcAdminGroup && c.groups.includes(s.oidcAdminGroup)) patch.role = "admin";
  updateUser(user.id, patch);
  return getUser(user.id)!;
}

// ---------------------------------------------------------------------------
// Cloudflare Access

const cfKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const cfSeen = new Map<string, { at: number; userId: number | null; why?: string }>();
let cfLastProblem: string | null = null;
export const cloudflareProblem = () => cfLastProblem;

export async function cloudflareUser(req: FastifyRequest): Promise<UserRow | null> {
  const s = getSettings();
  const token = String(req.headers["cf-access-jwt-assertion"] ?? "") || req.cookies.CF_Authorization || "";
  if (!token) {
    cfLastProblem = "No Cloudflare Access token on the request. Is Shelfhelp behind a Cloudflare Access application?";
    return null;
  }
  if (!s.cfTeamDomain || !s.cfAudience) {
    cfLastProblem = "Cloudflare Access needs the team domain and the Application Audience (AUD) tag in Settings, Users.";
    return null;
  }
  const key = createHash("sha256").update(token).digest("hex");
  const hit = cfSeen.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) {
    cfLastProblem = hit.why ?? null;
    return hit.userId ? getUser(hit.userId) : null;
  }
  try {
    const team = `https://${s.cfTeamDomain}`;
    // CF_ACCESS_CERTS_URL exists only so tests can stand in for Cloudflare.
    if (!cfKeys.has(team)) cfKeys.set(team, createRemoteJWKSet(new URL(process.env.CF_ACCESS_CERTS_URL || `${team}/cdn-cgi/access/certs`)));
    const { payload } = await jwtVerify(token, cfKeys.get(team)!, { issuer: team, audience: s.cfAudience });
    const email = (payload.email as string) ?? null;
    if (!email) throw new Error("Cloudflare's token has no email.");
    await resolveOwner();
    const abs = await matchAbsUser({ email, emailVerified: true });
    if (!abs) throw new Error(`There's no Audiobookshelf account with the email ${email}.`);
    const user = await userForAbs(abs);
    if (!hit) updateUser(user.id, { last_login_at: new Date().toISOString() });
    if (cfSeen.size > 500) cfSeen.clear();
    cfSeen.set(key, { at: Date.now(), userId: user.id });
    cfLastProblem = null;
    return user;
  } catch (err) {
    const why = (err as Error).message;
    cfSeen.set(key, { at: Date.now(), userId: null, why });
    cfLastProblem = why;
    return null;
  }
}


// ---------------------------------------------------------------------------
// One-time sign-in link in the container log

let recovery: { code: string; expires: number } | null = null;
let lastRecovery = 0;

/**
 * Writes a one-time admin sign-in link to the container log. Only someone who
 * can read the log (docker logs) can use it. One link at a time, 15 minutes,
 * single use, at most one request a minute.
 */
export function requestRecoveryLink(req: FastifyRequest): "sent" | "wait" {
  if (Date.now() - lastRecovery < 60_000) return "wait";
  lastRecovery = Date.now();
  const code = randomBytes(24).toString("base64url");
  recovery = { code, expires: Date.now() + 15 * 60_000 };
  const url = `${publicBase(req)}/api/auth/recovery/${code}`;
  const line = "=".repeat(72);
  console.log(`\n${line}\nShelfhelp: one-time admin sign-in link (works once, for 15 minutes):\n\n  ${url}\n\nIf you didn't ask for this, someone pressed "Can't sign in?" on the login page.\n${line}\n`);
  log("warn", "A one-time sign-in link was written to the container log");
  return "sent";
}

export function useRecoveryLink(code: string): boolean {
  if (!recovery || recovery.expires < Date.now()) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(recovery.code);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  recovery = null;
  return true;
}
