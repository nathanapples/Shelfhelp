import { useState } from "react";
import { ExclamationTriangleIcon, KeyIcon } from "@heroicons/react/24/outline";
import { api, type Status } from "../lib/api";
import { Logo } from "../components/Layout";
import { Spinner } from "../components/ui";

export default function LoginPage({ status, onSignedIn }: { status: Status; onSignedIn: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("signin_error"));
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(status.authMode === "none");
  const [recovery, setRecovery] = useState<"sent" | "wait" | null>(null);
  const askRecovery = async () => {
    try {
      setRecovery((await api<{ result: "sent" | "wait" }>("/auth/recovery", { method: "POST" })).result);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: { password } });
      window.history.replaceState(null, "", "/");
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = window.location.pathname === "/" ? "/" : window.location.pathname + window.location.search;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-600/30 to-purple-600/30 blur-3xl" />
      <Logo className="relative mb-8 scale-125" />
      <div className="relative w-full max-w-md rounded-xl bg-gray-800/80 p-6 shadow-xl ring-1 ring-gray-700 backdrop-blur">
        <h1 className="text-xl font-bold text-white">Sign in</h1>
        {error && (
          <div className="mt-4 flex gap-2 rounded-md bg-red-900/30 p-3 text-sm text-red-200 ring-1 ring-red-800">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" /> {error}
          </div>
        )}

        {status.authMode === "oidc" && (
          <a href={`/api/auth/oidc/start?back=${encodeURIComponent(back)}`} className="btn btn-primary mt-5 w-full py-3 text-base">
            <KeyIcon className="h-5 w-5" /> Sign in with {status.oidcLabel}
          </a>
        )}

        {status.authMode === "cloudflare" && (
          <div className="mt-4 text-sm text-gray-300">
            <p>Shelfhelp signs you in through Cloudflare Access, but it couldn't tell who you are.</p>
            {status.signinProblem && <p className="mt-2 text-yellow-300">{status.signinProblem}</p>}
            <button className="btn btn-default mt-4 w-full" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        )}

        {status.passwordLogin && (
          <>
            {!showPassword ? (
              <button className="mt-5 w-full text-center text-xs text-gray-400 hover:text-gray-200" onClick={() => setShowPassword(true)}>
                Use the admin password instead
              </button>
            ) : (
              <form onSubmit={submit} className={status.authMode === "none" ? "" : "mt-6 border-t border-gray-700 pt-5"}>
                <label className="mt-2 block text-sm font-medium text-gray-300">{status.authMode === "none" ? "Password" : "Admin password"}</label>
                <input className="input mt-2" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                <button className={`btn ${status.authMode === "none" ? "btn-primary" : "btn-default"} mt-4 w-full`} disabled={busy || !password}>
                  {busy && <Spinner className="h-4 w-4" />} Sign in
                </button>
              </form>
            )}
          </>
        )}
        {status.authMode !== "none" && (
          <div className="mt-6 border-t border-gray-700 pt-4 text-center text-xs text-gray-400">
            {recovery === "sent" ? (
              <p className="text-gray-300">
                A one-time sign-in link is in the container log. Run <code className="text-white">docker logs shelfhelp</code> and open the link. It
                works once, for 15 minutes.
              </p>
            ) : recovery === "wait" ? (
              <p>A link was just made. Check the container log, or try again in a minute.</p>
            ) : (
              <button className="hover:text-gray-200" onClick={askRecovery}>
                Can't sign in? Put a one-time link in the container log
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
