import { Link, useNavigate } from "react-router-dom";
import { ArrowPathIcon, BookOpenIcon, ExclamationTriangleIcon, PauseCircleIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, type ReadingUser } from "../lib/api";
import { jobStarted, useApi, useJobs } from "../lib/hooks";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle, Spinner } from "../components/ui";
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

function UserCard({ user, lastRun, onChecked }: { user: ReadingUser; lastRun: { ok: boolean; message: string; finishedAt: number } | null; onChecked: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const c = user.counts;
  const barTotal = c.synced + c.waiting + c.issues + c.under;
  const go = (tab?: string) => navigate(`/reading/${user.id}${tab ? `?tab=${tab}` : ""}`);

  const check = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api("/reading/sync", { method: "POST" });
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
            {user.role === "admin" ? "Admin" : "User"}
            {user.you && <span className="normal-case tracking-normal text-gray-500">· you</span>}
          </div>
          <h2 className="truncate text-xl font-bold text-white group-hover:underline">{user.name}</h2>
          <div className="truncate text-sm text-gray-400">
            {user.hardcoverUser ? `Hardcover @${user.hardcoverUser}` : "Hardcover not connected"}
            {user.enabled ? (user.autoSend ? " · auto-send" : " · you approve") : ""}
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
          {user.running ? (
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
        <button className="btn btn-sm btn-default" onClick={check} disabled={user.running || !user.enabled}>
          <ArrowPathIcon className="h-4 w-4" /> Check
        </button>
      </div>
    </div>
  );
}

export default function ReadingUsersPage() {
  const jobs = useJobs();
  const running = !!jobs?.running.some((j) => j.id === "reading");
  const { data, error, loading, reload } = useApi<{ users: ReadingUser[] }>("/reading/users", { poll: running ? 3000 : 30000 });
  const lastRun = jobs?.last.reading ?? null;

  return (
    <div>
      <PageTitle>Reading</PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-gray-400">
        Audiobookshelf listening progress sent to each person's Hardcover account. Open a reader to see their books and send changes.
      </p>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.users.length === 0 && <Empty icon={<BookOpenIcon className="h-16 w-16" />} title="No readers yet" />}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2 2xl:grid-cols-3">
        {data?.users.map((u) => <UserCard key={u.id} user={u} lastRun={lastRun} onChecked={reload} />)}
      </div>
    </div>
  );
}
