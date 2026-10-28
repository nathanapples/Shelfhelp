import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowPathIcon,
  BookmarkIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
  PlusIcon,
  RectangleStackIcon,
} from "@heroicons/react/24/outline";
import { api, timeAgo, type BookStatus, type List, type Status } from "../lib/api";
import { jobStarted, useApi } from "../lib/hooks";
import { AddListModal } from "../components/AddListModal";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle, Spinner } from "../components/ui";
import { useToast } from "../components/toast";

const SEGMENTS: { key: BookStatus; label: string; bar: string; text: string }[] = [
  { key: "matched", label: "In library", bar: "bg-green-500", text: "text-green-400" },
  { key: "review", label: "To review", bar: "bg-yellow-500", text: "text-yellow-400" },
  { key: "missing", label: "Not in library", bar: "bg-red-500", text: "text-red-400" },
  { key: "ignored", label: "Ignored", bar: "bg-gray-500", text: "text-gray-400" },
];

function pct(n: number, total: number) {
  return total ? Math.round((n / total) * 100) : 0;
}

function ListCard({ list, onSynced }: { list: List; onSynced: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { counts } = list;
  const inLibrary = pct(counts.matched, counts.total);
  const isShelf = list.sourceType === "hardcover_status";

  const sync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api(`/lists/${list.id}/sync`, { method: "POST" });
      toast(`Syncing "${list.name}"`, "info");
      setTimeout(onSynced, 400);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/lists/${list.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/lists/${list.id}`)}
      className="card group relative flex cursor-pointer flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-gray-500"
    >
      {/* Header with a blurred cover behind it, like a Seerr request card */}
      <div className="relative flex items-center gap-4 p-4 sm:p-5">
        {list.covers[0] && (
          <div className="pointer-events-none absolute inset-0">
            <img src={list.covers[0]} alt="" className="h-full w-full scale-110 object-cover opacity-25 blur-md" />
            <div className="row-backdrop absolute inset-0" />
          </div>
        )}
        <div className="relative flex h-20 w-[4.5rem] flex-shrink-0">
          {[2, 1, 0].map((i) => (
            <div
              key={i}
              className="absolute bottom-0 left-0 h-20 w-14 origin-bottom-left"
              style={{ transform: `translateX(${i * 7}px) rotate(${i * 4}deg)` }}
            >
              <Cover src={list.covers[i]} alt="" className="h-full w-full rounded shadow-lg ring-1 ring-gray-700" />
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {isShelf ? <BookmarkIcon className="h-3.5 w-3.5 text-purple-400" /> : <RectangleStackIcon className="h-3.5 w-3.5 text-indigo-400" />}
            {isShelf ? "Shelf" : "List"}
          </div>
          <h2 className="truncate text-xl font-bold text-white group-hover:underline">{list.name}</h2>
          <div className="truncate text-sm text-gray-400">Collection "{list.collectionName}"</div>
        </div>
        <div className="relative hidden text-right sm:block">
          <div className="text-3xl font-bold tabular-nums text-white">{inLibrary}%</div>
          <div className="text-xs text-gray-400">in library</div>
        </div>
      </div>

      {/* Match breakdown */}
      <div className="border-t border-gray-700 px-4 pb-4 pt-4 sm:px-5">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-700">
          {SEGMENTS.map((s) =>
            counts[s.key] ? <div key={s.key} className={s.bar} style={{ width: `${pct(counts[s.key], counts.total)}%` }} /> : null,
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {SEGMENTS.map((s) => (
            <Link
              key={s.key}
              to={`/lists/${list.id}?filter=${s.key}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded-md px-1 py-1 transition hover:bg-gray-700/60"
            >
              <div className={`text-lg font-bold tabular-nums ${counts[s.key] ? s.text : "text-gray-600"}`}>{counts[s.key]}</div>
              <div className="text-[11px] leading-tight text-gray-400">{s.label}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-700 bg-gray-800/60 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-gray-400">
          {list.syncing ? (
            <>
              <Spinner className="h-4 w-4" /> Syncing now
            </>
          ) : list.lastStatus === "error" ? (
            <span className="flex min-w-0 items-center gap-1 text-red-400" title={list.lastError ?? ""}>
              <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Sync failed {timeAgo(list.lastSyncedAt)}</span>
            </span>
          ) : !list.enabled ? (
            <span className="flex items-center gap-1">
              <PauseCircleIcon className="h-4 w-4" /> Paused
            </span>
          ) : (
            <span>
              {counts.total} books · synced {timeAgo(list.lastSyncedAt)}
            </span>
          )}
        </div>
        <button className="btn btn-sm btn-default" onClick={sync} disabled={list.syncing}>
          <ArrowPathIcon className="h-4 w-4" /> Sync
        </button>
      </div>
    </div>
  );
}

export default function ListsPage({ status }: { status: Status }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [poll, setPoll] = useState<number | false>(false);
  const { data: lists, error, loading, reload } = useApi<List[]>("/lists", { poll });
  useEffect(() => {
    setPoll(lists?.some((x) => x.syncing) ? 3000 : 20000);
  }, [lists]);

  const configured = status.configured.hardcover && status.configured.abs;
  const syncAll = async () => {
    try {
      await api("/sync", { method: "POST" });
      jobStarted();
      setTimeout(reload, 500);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (!configured) {
    return (
      <Empty icon={<Cog6ToothIcon className="h-16 w-16" />} title="Welcome to Shelfhelp">
        <p>Connect Hardcover and Audiobookshelf to start turning your Hardcover lists into collections.</p>
        <Link to="/settings" className="btn btn-primary mt-6">
          Open Settings
        </Link>
      </Empty>
    );
  }

  return (
    <div>
      <PageTitle
        extra={
          <>
            {lists && lists.length > 0 && (
              <button className="btn btn-default" onClick={syncAll} title="Sync every collection now">
                <ArrowPathIcon className="h-5 w-5" /> Sync All
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <PlusIcon className="h-5 w-5" /> Add Collection
            </button>
          </>
        }
      >
        Collections
      </PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-gray-400">
        Add a Hardcover list or shelf and Shelfhelp automatically makes a matching collection in Audiobookshelf with the books you
        own, then keeps it up to date as the list changes.
      </p>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {lists?.length === 0 && (
        <Empty icon={<RectangleStackIcon className="h-16 w-16" />} title="No collections yet">
          <p>Add a Hardcover list or shelf and Shelfhelp will keep an Audiobookshelf collection in step with it.</p>
          <button className="btn btn-primary mt-6" onClick={() => setAdding(true)}>
            <PlusIcon className="h-5 w-5" /> Add your first collection
          </button>
        </Empty>
      )}

      {lists && lists.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2 2xl:grid-cols-3">
            {lists.map((l) => (
              <ListCard key={l.id} list={l} onSynced={reload} />
            ))}
        </div>
      )}

      <AddListModal
        open={adding}
        onClose={() => {
          setAdding(false);
          reload();
        }}
        existing={lists ?? []}
      />
    </div>
  );
}
