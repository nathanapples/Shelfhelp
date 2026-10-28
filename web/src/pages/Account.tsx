import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightOnRectangleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, type Status, type UserView } from "../lib/api";
import { useApi } from "../lib/hooks";
import { ErrorBlock, LoadingBlock, PageTitle, Spinner } from "../components/ui";
import { useToast } from "../components/toast";

const VIA: Record<string, string> = {
  open: "No sign-in (everyone is the owner)",
  password: "Admin password",
  oidc: "Pocket ID",
  cloudflare: "Cloudflare Access",
  recovery: "One-time link from the container log",
};

export default function AccountPage({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const toast = useToast();
  const { data: me, error, loading, reload } = useApi<UserView & { hardcoverUser: string | null }>("/me");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      const r = await api<{ hardcoverUser: string | null }>("/me", { method: "PUT", body: { hardcoverToken: value } });
      toast(r.hardcoverUser ? `Connected to Hardcover as @${r.hardcoverUser}` : "Hardcover disconnected");
      setToken("");
      reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    const r = await api<{ redirect?: string | null }>("/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = r?.redirect || "/";
  };

  if (loading) return <LoadingBlock />;
  if (error || !me) return <ErrorBlock message={error ?? "Couldn't load your account"} />;

  return (
    <div className="max-w-3xl">
      <PageTitle
        extra={
          status.authRequired && (
            <button className="btn btn-default" onClick={signOut}>
              <ArrowRightOnRectangleIcon className="h-5 w-5" /> Sign out
            </button>
          )
        }
      >
        My account
      </PageTitle>

      <section className="card p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-bold uppercase text-white">
            {me.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xl font-bold text-white">{me.name}</div>
            <div className="text-sm text-gray-400">
              {me.role === "admin" ? "Admin" : "Reader"}
              {me.isOwner ? " · owner" : ""}
              {me.username ? ` · Audiobookshelf user ${me.username}` : ""}
            </div>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Signed in with</dt>
            <dd className="text-gray-200">{VIA[me.via ?? "open"]}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Email</dt>
            <dd className="text-gray-200">{me.email ?? "None in Audiobookshelf"}</dd>
          </div>
          {me.lastLoginAt && (
            <div>
              <dt className="text-gray-500">Last sign-in</dt>
              <dd className="text-gray-200">{timeAgo(me.lastLoginAt)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-lg font-bold text-white">Hardcover</h2>
        <p className="mt-1 text-sm text-gray-400">
          Connect your own Hardcover account to sync your Audiobookshelf listening to it. Get a token at{" "}
          <a className="text-indigo-400 hover:underline" href="https://hardcover.app/account/api" target="_blank" rel="noreferrer">
            hardcover.app/account/api
          </a>
          . Only you and admins can see your reading.
        </p>
        {me.hasHardcover && (
          <div className="mt-4 flex items-center gap-2 text-sm text-green-300">
            <CheckCircleIcon className="h-5 w-5" /> Connected{me.hardcoverUser ? ` as @${me.hardcoverUser}` : ""}.{" "}
            <Link to={`/reading/${me.id}`} className="text-indigo-400 hover:underline">
              See your reading
            </Link>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            placeholder={me.hasHardcover ? "Paste a new token to replace it" : "Paste your Hardcover API token"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn btn-primary flex-shrink-0" onClick={() => save(token.trim())} disabled={busy || !token.trim()}>
            {busy && <Spinner className="h-4 w-4 text-white" />} {me.hasHardcover ? "Replace" : "Connect"}
          </button>
          {me.ownHardcoverToken && !me.isOwner && (
            <button className="btn btn-default flex-shrink-0" onClick={() => save(null)} disabled={busy}>
              Disconnect
            </button>
          )}
        </div>
        {me.isOwner && <p className="mt-2 text-xs text-gray-500">As the owner, this is also the Hardcover token Shelfhelp uses for collections.</p>}
      </section>
    </div>
  );
}
