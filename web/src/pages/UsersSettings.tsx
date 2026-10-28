import { useState, type ReactNode } from "react";
import { ExclamationTriangleIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, type AuthMode, type Settings, type Status, type UserView } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Spinner } from "../components/ui";
import { useToast } from "../components/toast";

const MODES: [AuthMode, string, string][] = [
  ["none", "No sign-in", "Everyone who opens Shelfhelp is the owner. Set APP_PASSWORD to ask for a password first."],
  ["oidc", "Pocket ID", "Each person signs in with Pocket ID (or another OpenID Connect provider) and gets their own reading and requests."],
  ["cloudflare", "Cloudflare Access", "Cloudflare Access signs people in. Shelfhelp reads who they are from it, so there's only one login."],
];

function Field({ label, tip, children }: { label: string; tip?: ReactNode; children: ReactNode }) {
  return (
    <div className="form-row">
      <label>
        {label}
        {tip && <span className="label-tip">{tip}</span>}
      </label>
      <div className="form-input-area">{children}</div>
    </div>
  );
}

export function UsersSettings({
  s,
  set,
  locked,
  status,
  testResult,
  setTest,
  save,
  saving,
}: {
  s: Settings;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  locked: (k: keyof Settings) => boolean;
  status: Status;
  testResult: ReactNode;
  setTest: (t: { ok: boolean; message: ReactNode } | null) => void;
  save: (keys: (keyof Settings)[]) => Promise<void>;
  saving: boolean;
}) {
  const toast = useToast();
  const { data, reload } = useApi<{ users: UserView[]; absUsers: { id: string; username: string; email: string | null; type: string; shelfhelpId: number | null }[] }>(
    "/users",
  );
  const [testing, setTesting] = useState(false);
  const redirect = `${window.location.origin}/api/auth/oidc/callback`;

  const testOidc = async () => {
    setTesting(true);
    try {
      const r = await api<{ issuer: string; redirectUri: string }>("/settings/test/oidc", {
        method: "POST",
        body: { issuer: s.oidcIssuer, internalUrl: s.oidcInternalUrl },
      });
      setTest({
        ok: true,
        message: (
          <>
            Found <b>{r.issuer}</b>. In Pocket ID, the callback URL for this client must be <code className="text-white">{r.redirectUri}</code>.
          </>
        ),
      });
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const setRole = async (u: UserView, role: "admin" | "user") => {
    try {
      await api(`/users/${u.id}`, { method: "PUT", body: { role } });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (u: UserView) => {
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      toast(`Removed ${u.name}. Their Audiobookshelf account isn't touched.`, "info");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const keys: (keyof Settings)[] = [
    "authMode",
    "oidcIssuer",
    "oidcClientId",
    "oidcClientSecret",
    "oidcInternalUrl",
    "oidcAdminGroup",
    "oidcLabel",
    "cfTeamDomain",
    "cfAudience",
  ];
  const absById = new Map((data?.absUsers ?? []).map((a) => [a.id, a]));

  return (
    <>
      <Field label="Sign-in" tip="How Shelfhelp knows who's using it. Settings set by environment variables can't be changed here.">
        <div className="space-y-3 sm:pt-2">
          {MODES.map(([id, label, tip]) => (
            <label key={id} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="authMode"
                className="mt-1 h-4 w-4 border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                checked={s.authMode === id}
                disabled={locked("authMode")}
                onChange={() => set("authMode", id)}
              />
              <span>
                <span className="font-medium text-white">{label}</span>
                <span className="block text-xs text-gray-400">{tip}</span>
              </span>
            </label>
          ))}
          {!status.passwordLogin && s.authMode !== "none" && (
            <p className="flex items-start gap-1.5 text-xs text-yellow-300">
              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
              Set APP_PASSWORD on the container too. It's an emergency admin sign-in if {s.authMode === "oidc" ? "Pocket ID" : "Cloudflare"} is down or
              misconfigured. Without it, the way back in is setting AUTH_MODE=none.
            </p>
          )}
        </div>
      </Field>

      {s.authMode === "oidc" && (
        <>
          <Field label="Callback URL" tip="Add this to the Shelfhelp client in Pocket ID. Add one for each address you open Shelfhelp at.">
            <code className="block break-all rounded-md bg-gray-900 px-3 py-2 text-sm text-gray-200 ring-1 ring-gray-700">{redirect}</code>
          </Field>
          <Field label="Issuer URL" tip="Your Pocket ID address, e.g. https://id.example.com">
            <input className="input" placeholder="https://id.example.com" value={s.oidcIssuer} disabled={locked("oidcIssuer")} onChange={(e) => set("oidcIssuer", e.target.value)} />
          </Field>
          <Field label="Client ID">
            <input className="input font-mono" value={s.oidcClientId} disabled={locked("oidcClientId")} onChange={(e) => set("oidcClientId", e.target.value)} />
          </Field>
          <Field label="Client secret">
            <input
              className="input font-mono"
              type="password"
              autoComplete="off"
              value={s.oidcClientSecret}
              disabled={locked("oidcClientSecret")}
              onChange={(e) => set("oidcClientSecret", e.target.value)}
              onFocus={(e) => e.target.value.startsWith("•") && set("oidcClientSecret", "")}
            />
          </Field>
          <Field label="Admin group" tip="Optional. Pocket ID group whose members are Shelfhelp admins. Audiobookshelf admins are always admins.">
            <input className="input" placeholder="shelfhelp-admins" value={s.oidcAdminGroup} disabled={locked("oidcAdminGroup")} onChange={(e) => set("oidcAdminGroup", e.target.value)} />
          </Field>
          <Field label="Internal URL" tip="Optional. How this container reaches Pocket ID if the public address doesn't work from inside, e.g. http://pocket-id:1411">
            <input className="input" placeholder="http://pocket-id:1411" value={s.oidcInternalUrl} disabled={locked("oidcInternalUrl")} onChange={(e) => set("oidcInternalUrl", e.target.value)} />
          </Field>
          <Field label="Button name">
            <input className="input max-w-xs" value={s.oidcLabel} onChange={(e) => set("oidcLabel", e.target.value)} />
          </Field>
        </>
      )}

      {s.authMode === "cloudflare" && (
        <>
          <Field label="Team domain" tip="From Cloudflare Zero Trust, Settings, Custom Pages. e.g. myteam.cloudflareaccess.com">
            <input className="input" placeholder="myteam.cloudflareaccess.com" value={s.cfTeamDomain} disabled={locked("cfTeamDomain")} onChange={(e) => set("cfTeamDomain", e.target.value)} />
          </Field>
          <Field label="Audience (AUD) tag" tip="From the Shelfhelp application in Cloudflare Access, Overview.">
            <input className="input font-mono" value={s.cfAudience} disabled={locked("cfAudience")} onChange={(e) => set("cfAudience", e.target.value)} />
          </Field>
          <Field label="How it matches people">
            <p className="text-sm text-gray-400 sm:pt-2">
              By the email Cloudflare signed them in with, against the email on their Audiobookshelf account. To turn this on, open this page through
              Cloudflare, so Shelfhelp can check it works before switching.
            </p>
          </Field>
        </>
      )}

      {testResult}
      <div className="mt-8 flex max-w-6xl justify-end gap-3 border-t border-gray-700 pt-5">
        {s.authMode === "oidc" && (
          <button className="btn btn-warning" onClick={testOidc} disabled={testing}>
            {testing && <Spinner className="h-4 w-4 text-white" />} Test
          </button>
        )}
        <button className="btn btn-primary" onClick={() => save(keys)} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <section className="mt-12">
        <h3 className="heading">People</h3>
        <p className="description">
          Everyone who has signed in or been added as a reader. People are matched to Audiobookshelf accounts by email, then username. Audiobookshelf
          admins are admins here.
        </p>
        <ul className="mt-5 max-w-6xl divide-y divide-gray-700 overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
          {(data?.users ?? []).map((u) => {
            const abs = u.absUserId ? absById.get(u.absUserId) : null;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 font-bold uppercase text-white">
                  {u.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-white">
                    {u.name}
                    {u.isOwner && <span className="ml-2 text-xs text-gray-400">owner</span>}
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    {[abs ? `Audiobookshelf ${abs.username}` : u.absUserId ? "Audiobookshelf user gone" : null, u.email, u.hasHardcover ? "Hardcover connected" : "no Hardcover", u.lastLoginAt ? `signed in ${timeAgo(u.lastLoginAt)}` : "never signed in"]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <select
                  className="input w-auto py-1 text-xs"
                  value={u.role}
                  disabled={u.isOwner || u.id === status.user?.id}
                  onChange={(e) => setRole(u, e.target.value as "admin" | "user")}
                  aria-label={`Role for ${u.name}`}
                >
                  <option value="user">Reader</option>
                  <option value="admin">Admin</option>
                </select>
                {!u.isOwner && u.id !== status.user?.id && (
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(u)} title="Remove from Shelfhelp">
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-gray-500">Add someone as a reader from the Reading page.</p>
      </section>
    </>
  );
}
