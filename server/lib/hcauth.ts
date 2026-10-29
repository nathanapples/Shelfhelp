/**
 * "Sign in with Hardcover": people connect their own Hardcover account through
 * Shelfhelp's Hardcover developer app instead of pasting a key.
 *
 * Hardcover only issues tokens for a signed-in person (there is no app-only
 * token), so the app's client ID and secret just run the sign-in and refresh
 * each person's tokens. Shared data (trending, genres, book details) still
 * comes from the server's own key in Settings.
 *
 * A signed-in reader's "token" inside Shelfhelp is the reference
 * `oauth:<userId>`; hardcover() turns it into a client that refreshes the real
 * token as it expires and stores each new pair before using it.
 */
import { OAuthSession, createAuthorization, exchangeCode, type AuthorizationAttempt, type OAuthConfig, type TokenSet, type TokenStore } from "@hardcover/sdk/oauth";
import { fetchTransport, type HttpRequest, type Transport } from "@hardcover/sdk";
import { config } from "./config.js";
import { db, json } from "./db.js";
import { getSettings } from "./settings.js";
import { log } from "./activity.js";

export const OAUTH_PREFIX = "oauth:";

/** What Shelfhelp asks for at sign-in. offline_access gives a refresh token, so nobody has to sign in again. */
export const SIGNIN_SCOPES = ["read:me:content", "read:library", "write:library", "read:vibes", "read:catalog", "read:lists", "offline_access"] as const;

export const oauthRef = (userId: number) => `${OAUTH_PREFIX}${userId}`;
export const oauthUserId = (token: string) => (token.startsWith(OAUTH_PREFIX) ? Number(token.slice(OAUTH_PREFIX.length)) : null);

export function signInConfigured(s = getSettings()) {
  return !!s.hardcoverClientId;
}

/**
 * The SDK sends the client secret in the form body (client_secret_post).
 * Hardcover's app settings can require HTTP Basic instead (client_secret_basic),
 * and answer invalid_client otherwise. This tries each way in turn on
 * invalid_client, and remembers what worked. Retrying is
 * safe: a request refused for client authentication never spends a code or
 * refresh token.
 */
type AuthMethod = "basic" | "basic-raw" | "basic+id" | "post";
const METHODS: AuthMethod[] = ["basic", "post", "basic-raw", "basic+id"];
const working = new Map<string, AuthMethod>();
const base = fetchTransport();

/** What Hardcover answered for each way of sending the secret, last time it refused all of them. */
export let lastClientAuthFailure: { method: AuthMethod; status: number; answer: string }[] = [];

function withMethod(req: HttpRequest, method: AuthMethod): HttpRequest | null {
  if (method === "post") return req;
  const form = new URLSearchParams(req.body);
  const id = form.get("client_id");
  const secret = form.get("client_secret");
  if (!id || !secret) return null;
  // RFC 6749 says to form-encode both before Basic; some servers expect them as is.
  if (method === "basic-raw" && encodeURIComponent(id) === id && encodeURIComponent(secret) === secret) return null;
  if (method !== "basic+id") form.delete("client_id");
  form.delete("client_secret");
  const pair = method === "basic-raw" ? `${id}:${secret}` : `${encodeURIComponent(id)}:${encodeURIComponent(secret)}`;
  return { ...req, headers: { ...req.headers, authorization: `Basic ${Buffer.from(pair).toString("base64")}` }, body: form.toString() };
}

/** Hardcover's answer, without anything secret (error bodies never echo the secret). */
const answerOf = (body: string) => body.replace(/\s+/g, " ").slice(0, 300);

function clientAuthTransport(clientId: string): Transport {
  return {
    async send(req) {
      if (!/client_secret=/.test(req.body)) return base.send(req);
      const known = working.get(clientId);
      const order = known ? [known, ...METHODS.filter((m) => m !== known)] : METHODS;
      const tried: typeof lastClientAuthFailure = [];
      let first: Awaited<ReturnType<Transport["send"]>> | null = null;
      for (const method of order) {
        const r = withMethod(req, method);
        if (!r) continue;
        const res = await base.send(r);
        if (!isInvalidClient(res.status, res.body)) {
          working.set(clientId, method);
          return res;
        }
        first ??= res;
        tried.push({ method, status: res.status, answer: answerOf(res.body) });
      }
      lastClientAuthFailure = tried;
      return first!;
    },
  };
}

function isInvalidClient(status: number, body: string) {
  return (status === 400 || status === 401) && /"error"\s*:\s*"invalid_client"/.test(body);
}

function tokenEndpoint() {
  const base = process.env.HARDCOVER_OAUTH_URL?.replace(/\/+$/, "");
  return base ? `${base}/oauth2/token` : "https://api.hardcover.app/oauth2/token";
}

/**
 * Checks the client ID and secret without anyone signing in: a token request
 * with a made-up code. If Hardcover accepts the client it answers
 * invalid_grant (the code is wrong); invalid_client means the ID or secret is.
 */
export async function checkClient(redirectUri: string) {
  const s = getSettings();
  if (!s.hardcoverClientId) throw new Error("Add the client ID first.");
  const secret = s.hardcoverClientSecret.trim();
  const req: HttpRequest = {
    url: tokenEndpoint(),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": `shelfhelp/${config.version}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "shelfhelp-credentials-check",
      redirect_uri: redirectUri,
      code_verifier: "shelfhelp-credentials-check-0000000000000000000000",
      client_id: s.hardcoverClientId,
      ...(secret ? { client_secret: secret } : {}),
    }).toString(),
  };
  const results: { method: string; status: number; answer: string; accepted: boolean }[] = [];
  for (const method of secret ? METHODS : (["post"] as AuthMethod[])) {
    const r = withMethod(req, method);
    if (!r) continue;
    const res = await base.send(r);
    results.push({ method, status: res.status, answer: answerOf(res.body), accepted: !isInvalidClient(res.status, res.body) });
  }
  return {
    secretLength: secret.length,
    secretHasSpaces: /\s/.test(s.hardcoverClientSecret.trim()) || s.hardcoverClientSecret !== s.hardcoverClientSecret.trim(),
    secretLooksLikeClientId: secret === s.hardcoverClientId,
    results,
  };
}

function oauthConfig(): OAuthConfig {
  const s = getSettings();
  if (!s.hardcoverClientId) throw new Error("Sign in with Hardcover isn't set up. An admin adds the Hardcover app's client ID in Settings.");
  // HARDCOVER_OAUTH_URL points at a stand-in server for tests.
  const base = process.env.HARDCOVER_OAUTH_URL?.replace(/\/+$/, "");
  return {
    clientId: s.hardcoverClientId,
    clientSecret: s.hardcoverClientSecret.trim() || undefined,
    transport: clientAuthTransport(s.hardcoverClientId),
    userAgent: `shelfhelp/${config.version}`,
    ...(base
      ? {
          endpoints: {
            authorize: `${base}/oauth2/authorize`,
            token: `${base}/oauth2/token`,
            revoke: `${base}/oauth2/revoke`,
            device: `${base}/oauth2/device`,
            issuer: base,
          },
        }
      : {}),
  };
}

function readTokens(userId: number): TokenSet | null {
  const row = db.prepare("SELECT hc_oauth FROM users WHERE id = ?").get(userId) as { hc_oauth: string | null } | undefined;
  return json<TokenSet | null>(row?.hc_oauth, null);
}

function writeTokens(userId: number, tokens: TokenSet | null) {
  db.prepare("UPDATE users SET hc_oauth = ? WHERE id = ?").run(tokens ? JSON.stringify(tokens) : null, userId);
}

/** Tokens live in the users table, written before they're used. */
function dbStore(userId: number): TokenStore {
  return {
    get: async () => readTokens(userId),
    set: async (tokens) => writeTokens(userId, tokens),
  };
}

const sessions = new Map<string, OAuthSession>();

/** One session per person (and app), so a refresh token is never spent twice. */
export function sessionFor(userId: number): OAuthSession {
  const cfg = oauthConfig();
  const key = `${userId}|${cfg.clientId}`;
  const hit = sessions.get(key);
  if (hit) return hit;
  const session = new OAuthSession({
    ...cfg,
    store: dbStore(userId),
    onSignedOut: (reason) => {
      if (reason === "signed-out") return;
      const row = db.prepare("SELECT display_name, username FROM users WHERE id = ?").get(userId) as { display_name: string | null; username: string | null } | undefined;
      log("warn", `${row?.display_name || row?.username || `User ${userId}`}'s Hardcover sign-in ended (${reason}). They need to connect Hardcover again in My account.`);
    },
  });
  sessions.set(key, session);
  return session;
}

export function hasSignIn(userId: number) {
  return !!readTokens(userId);
}

/** The scopes someone granted at sign-in. */
export function grantedScopes(userId: number): string[] {
  return (readTokens(userId)?.scope ?? "").split(/\s+/).filter(Boolean);
}

/** Starts a sign-in. The attempt goes in a signed cookie until Hardcover sends the person back. */
export function startSignIn(redirectUri: string): AuthorizationAttempt {
  return createAuthorization(oauthConfig(), { scopes: SIGNIN_SCOPES, redirectUri });
}

/** Finishes a sign-in: exchanges the code and stores the tokens for this person. */
export async function finishSignIn(userId: number, attempt: AuthorizationAttempt, code: string) {
  const tokens = await exchangeCode(oauthConfig(), { code, codeVerifier: attempt.codeVerifier, redirectUri: attempt.redirectUri });
  // A fresh session, so nothing cached from an earlier sign-in is reused.
  for (const k of [...sessions.keys()]) if (k.startsWith(`${userId}|`)) sessions.delete(k);
  writeTokens(userId, tokens);
  return tokens;
}

/** Signs someone out of Hardcover: revokes the tokens (best effort) and forgets them. */
export async function signOut(userId: number) {
  if (!readTokens(userId)) return;
  try {
    await sessionFor(userId).signOut();
  } catch {
    /* the app may be gone from Settings; forget the tokens anyway */
  }
  writeTokens(userId, null);
  for (const k of [...sessions.keys()]) if (k.startsWith(`${userId}|`)) sessions.delete(k);
}
