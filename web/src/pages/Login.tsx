import { useState } from "react";
import { api } from "../lib/api";
import { Logo } from "../components/Layout";
import { Spinner } from "../components/ui";

export default function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: { password } });
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-600/30 to-purple-600/30 blur-3xl" />
      <Logo className="relative mb-8 scale-125" />
      <form onSubmit={submit} className="relative w-full max-w-md rounded-xl bg-gray-800/80 p-6 shadow-xl ring-1 ring-gray-700 backdrop-blur">
        <h1 className="text-xl font-bold text-white">Sign in</h1>
        <label className="mt-5 block text-sm font-medium text-gray-300">Password</label>
        <input className="input mt-2" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
        <button className="btn btn-primary mt-6 w-full" disabled={busy || !password}>
          {busy && <Spinner className="h-4 w-4 text-white" />} Sign In
        </button>
      </form>
    </div>
  );
}
