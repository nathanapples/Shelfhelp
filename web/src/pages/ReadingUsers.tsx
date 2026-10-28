import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PlusIcon, ArrowPathIcon, BookOpenIcon, ExclamationTriangleIcon, PauseCircleIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { api, isAdmin, timeAgo, type ReadingUser, type Status, type UserView } from "../lib/api";
import { jobStarted, useApi, useJobs } from "../lib/hooks";
import { Cover, Empty, ErrorBlock, LoadingBlock, Modal, PageTitle, Spinner } from "../components/ui";
import { useToast } from "../components/toast";

const SEGMENTS: { key: "synced" | "waiting" | "issues" | "under"; label: string; bar: string; text: string; tab: string }[] = [
  { key: "synced", label: "In sync", bar: "bg-green-500", text: "text-green-400", tab: "synced" },
  { key: "waiting", label: "Waiting", bar: "bg-indigo-500", text: "text-indigo-400", tab: "waiting" },
  { key: "issues", label: "Issues", bar: "bg-yellow-500", text: "text-yellow-400", tab: "issues" },
  { key: "under", label: "Under min", bar: "bg-sky-600", text: "text-sky-400", tab: "issues" },
];

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function Avatar({ user }: { user: ReadingUser }) {
  if (user.image) return <img src={user.image} alt="" className="h-16 w-16 rounded-full object-cover shadow-lg ring-2 ring-gray-700" />;
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-bold uppercase text-white shadow-lg ring-2 ring-gray-700">
      {user.name.slice(0, 1)}
    </div>
  );
}

function UserCard({ user, onChecked }: { user: ReadingUser; onChecked: () => void }) {
  const lastRun = user.lastRun;
  const navigate = useNavigate();
  const toast = useToast();
  const c = user.counts;
  const barTotal = c.synced + c.waiting + c.issues + c.under;
  const go = (tab?: string) => navigate(`/reading/${user.id}${tab ? `?tab=${tab}` : ""}`);

  const check = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api(`/reading/sync?user=${user.id}`, { method: "POST" });
      jobStarted();
      toast(`Checking ${user.name}'s progress`, "info");
      setTimeout(onChecked, 500);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => go()}
      onKeyDown={(e) => e.key === "Enter" && go()}
      className="card group relative flex cursor-pointer flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-gray-500"
    >
      <div className="relative flex items-center gap-4 p-4 sm:p-5">
        {user.covers[0] && (
          <div className="pointer-events-none absolute inset-0">
            <img src={user.covers[0]} alt="" className="h-full w-full scale-110 object-cover opacity-25 blur-md" />
            <div className="row-backdrop absolute inset-0" />
          </div>
        )}
        <div className="relative flex-shrink-0">
          <Avatar user={user} />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <UserCircleIcon className="h-3.5 w-3.5 text-indigo-400" />
            {user.role === "admin" ? "Admin" : "Reader"}
            {user.you && <span className="normal-case tracking-normal text-gray-500">· you</span>}
          </div>
          <h2 className="truncate text-xl font-bold text-white group-hover:underline">{user.name}</h2>
          <div className="truncate text-sm text-gray-400">
            {user.hardcoverUser ? `Hardcover @${user.hardcoverUser}` : user.hasHardcover ? "Hardcover connected" : "Hardcover not connected"}
            {user.enabled ? (user.autoSend ? " · sends automatically" : " · changes wait for review") : ""}
          </div>
        </div>
        <div className="relative hidden text-right sm:block">
          <div className="text-3xl font-bold tabular-nums text-white">{pct(c.synced, barTotal)}%</div>
          <div className="text-xs text-gray-400">in sync</div>
        </div>
      </div>

      {user.nowListening && (
        <div className="flex items-center gap-3 border-t border-gray-700 px-4 py-3 sm:px-5">
          <Cover src={user.nowListening.coverUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">Listening to</div>
            <div className="truncate text-sm text-gray-200">{user.nowListening.title}</div>
          </div>
          <div className="w-24 flex-shrink-0">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-700">
              <div className="h-full bg-indigo-500" style={{ width: `${user.nowListening.progress}%` }} />
            </div>
            <div className="mt-0.5 text-right text-[11px] tabular-nums text-gray-400">{user.nowListening.progress}%</div>
          </div>
        </div>
      )}

      <div className="border-t border-gray-700 px-4 pb-4 pt-4 sm:px-5">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-700">
          {SEGMENTS.map((s) => (c[s.key] ? <div key={s.key} className={s.bar} style={{ width: `${pct(c[s.key], barTotal)}%` }} /> : null))}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {SEGMENTS.map((s) => (
            <Link
              key={s.key}
              to={`/reading/${user.id}?tab=${s.tab}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded-md px-1 py-1 transition hover:bg-gray-700/60"
            >
              <div className={`text-lg font-bold tabular-nums ${c[s.key] ? s.text : "text-gray-600"}`}>{c[s.key]}</div>
              <div className="text-[11px] leading-tight text-gray-400">{s.key === "under" ? `Under ${user.minProgress}%` : s.label}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-700 bg-gray-800/60 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-gray-400">
          {!user.hasHardcover ? (
            <span>{user.you ? "Connect Hardcover in My account to start" : "Waiting for them to connect Hardcover"}</span>
          ) : user.running ? (
            <>
              <Spinner className="h-4 w-4" /> Checking now
            </>
          ) : !user.enabled ? (
            <span className="flex items-center gap-1">
              <PauseCircleIcon className="h-4 w-4" /> Reading sync is off
            </span>
          ) : lastRun && !lastRun.ok ? (
            <span className="flex min-w-0 items-center gap-1 text-red-400" title={lastRun.message}>
              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Check failed {timeAgo(new Date(lastRun.finishedAt).toISOString())}</span>
            </span>
          ) : (
            <span className="truncate">
              {c.listening} listening, {c.finished} finished
              {lastRun ? ` · checked ${timeAgo(new Date(lastRun.finishedAt).toISOString())}` : ""}
              {c.dnf ? ` · ${c.dnf} did not finish` : ""}
            </span>
          )}
        </div>
        <button className="btn btn-sm btn-default" onClick={check} disabled={user.running || !user.enabled || !user.hasHardcover}>
          <ArrowPathIcon className="h-4 w-4" /> Check
        </button>
      </div>
    </div>
  );
}

function AddReader({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const { data } = useApi<{ users: UserView[]; absUsers: { id: string; username: string; email: string | null; type: string; shelfhelpId: number | null }[] }>(
    "/users",
  );
  const [absUserId, setAbsUserId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const readerIds = new Set((data?.users ?? []).filter((u) => u.hasHardcover).map((u) => u.id));
  const choices = (data?.absUsers ?? []).filter((a) => !a.shelfhelpId || !readerIds.has(a.shelfhelpId));

  const add = async () => {
    setBusy(true);
    try {
      await api("/users", { method: "POST", body: { absUserId, hardcoverToken: token.trim() || undefined } });
      toast("Reader added");
      onAdded();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a reader"
      subtitle="Sync someone's Audiobookshelf listening to their Hardcover account."
      footer={
        <>
          <button className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={add} disabled={busy || !absUserId}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Add reader
          </button>
        </>
      }
    >
      <label className="mt-2 block text-sm font-medium text-gray-300">Audiobookshelf user</label>
      <select className="input mt-1" value={absUserId} onChange={(e) => setAbsUserId(e.target.value)}>
        <option value="">Pick someone</option>
        {choices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.username}
            {a.email ? ` (${a.email})` : ""}
          </option>
        ))}
      </select>
      <label className="mt-4 block text-sm font-medium text-gray-300">Their Hardcover API token</label>
      <input className="input mt-1 font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
      <p className="mt-2 text-xs text-gray-400">
        Optional. Leave it empty and they can connect Hardcover themselves under My account once they sign in. Tokens are at
        hardcover.app/account/api.
      </p>
    </Modal>
  );
}

export default function ReadingUsersPage({ status }: { status: Status }) {
  const jobs = useJobs();
  const running = !!jobs?.running.some((j) => j.id.startsWith("reading-"));
  const { data, error, loading, reload } = useApi<{ users: ReadingUser[] }>("/reading/users", { poll: running ? 3000 : 30000 });
  const [adding, setAdding] = useState(false);
  const admin = isAdmin(status);

  return (
    <div>
      <PageTitle
        extra={
          admin && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon className="h-5 w-5" /> Add reader
            </button>
          )
        }
      >
        Reading
      </PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-gray-400">
        {admin
          ? "Audiobookshelf listening progress sent to each person's Hardcover account. Open a reader to see their books and send changes."
          : "Your Audiobookshelf listening progress, sent to your Hardcover account."}
      </p>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.users.length === 0 && <Empty icon={<BookOpenIcon className="h-16 w-16" />} title="No readers yet" />}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2 2xl:grid-cols-3">
        {data?.users.map((u) => <UserCard key={u.id} user={u} onChecked={reload} />)}
      </div>
      {adding && <AddReader onClose={() => setAdding(false)} onAdded={reload} />}
    </div>
  );
}
