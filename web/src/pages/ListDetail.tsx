import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, Cog6ToothIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, type BookStatus, type ListDetail } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { BookModal } from "../components/BookModal";
import { Cover, ErrorBlock, LoadingBlock, Modal, Spinner, Tabs, Toggle } from "../components/ui";
import { useToast } from "../components/toast";

type Filter = "all" | BookStatus;

function ListSettings({ list, open, onClose, onSaved }: { list: ListDetail; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(list.collectionName);
  const [removeMissing, setRemoveMissing] = useState(list.removeMissing);
  const [keepOrder, setKeepOrder] = useState(list.keepOrder);
  const [enabled, setEnabled] = useState(list.enabled);
  const [confirm, setConfirm] = useState(false);
  const [deleteCollection, setDeleteCollection] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/lists/${list.id}`, { method: "PATCH", body: { collectionName: name, removeMissing, keepOrder, enabled } });
      toast("List settings saved");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/lists/${list.id}?deleteCollection=${deleteCollection ? 1 : 0}`, { method: "DELETE" });
      toast(`Stopped syncing "${list.name}"`);
      navigate("/");
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="List Settings"
      subtitle={list.name}
      footer={
        confirm ? (
          <>
            <button className="btn btn-default" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={remove} disabled={busy}>
              Stop syncing
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-danger mr-auto" onClick={() => setConfirm(true)}>
              <TrashIcon className="h-4 w-4" /> Remove
            </button>
            <button className="btn btn-default" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              Save Changes
            </button>
          </>
        )
      }
    >
      {confirm ? (
        <div className="pt-4 text-sm text-gray-300">
          <p>Shelfhelper will stop syncing this list. Your decisions about individual books are kept.</p>
          <label className="mt-4 flex items-center gap-3">
            <Toggle checked={deleteCollection} onChange={setDeleteCollection} />
            <span>Also delete the "{list.collectionName}" collection in Audiobookshelf</span>
          </label>
        </div>
      ) : (
        <>
          <div className="form-row">
            <label>Collection name</label>
            <div className="form-input-area">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label>
              Sync this list
              <span className="label-tip">Paused lists keep their collection but stop updating.</span>
            </label>
            <div className="form-input-area sm:pt-2">
              <Toggle checked={enabled} onChange={setEnabled} />
            </div>
          </div>
          <div className="form-row">
            <label>
              Remove books
              <span className="label-tip">Take books out of the collection when they leave the list.</span>
            </label>
            <div className="form-input-area sm:pt-2">
              <Toggle checked={removeMissing} onChange={setRemoveMissing} />
            </div>
          </div>
          <div className="form-row">
            <label>
              Keep list order
              <span className="label-tip">Order the collection the same way as the list.</span>
            </label>
            <div className="form-input-area sm:pt-2">
              <Toggle checked={keepOrder} onChange={setKeepOrder} />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function ListDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [poll, setPoll] = useState<number | false>(false);
  const { data: list, error, loading, reload } = useApi<ListDetail>(`/lists/${id}`, { poll });

  if (list && !!poll !== list.syncing) setPoll(list.syncing ? 2500 : false);

  const bookId = Number(params.get("book"));
  const selected = useMemo(() => list?.books.find((b) => b.hcBookId === bookId) ?? null, [list, bookId]);
  const books = useMemo(() => (list?.books ?? []).filter((b) => filter === "all" || b.status === filter), [list, filter]);

  if (loading) return <LoadingBlock />;
  if (error || !list) return <ErrorBlock message={error ?? "Not found"} />;

  const backdrop = list.covers[0] ?? null;
  const sync = async () => {
    await api(`/lists/${list.id}/sync`, { method: "POST" });
    toast(`Syncing "${list.name}"`, "info");
    setTimeout(reload, 400);
  };

  return (
    <div className="-mx-4 -mt-16 sm:-mx-6 lg:-mx-8">
      {/* Backdrop */}
      <div className="absolute inset-x-0 top-0 -z-0 h-[28rem] overflow-hidden">
        {backdrop && <img src={backdrop} alt="" className="h-full w-full scale-110 object-cover opacity-40 blur-xl" />}
        <div className="media-backdrop absolute inset-0" />
      </div>

      <div className="relative px-4 pt-24 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-end">
          <div className="relative h-48 w-40 flex-shrink-0 sm:h-56 sm:w-48">
            {[2, 1, 0].map((i) => (
              <div
                key={i}
                className="absolute bottom-0 left-0 h-full w-32 origin-bottom-left sm:w-36"
                style={{ transform: `translateX(${i * 12}px) rotate(${i * 4}deg)` }}
              >
                <Cover src={list.covers[i]} alt={list.name} className="h-full w-full rounded-md shadow-2xl ring-1 ring-gray-700" />
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 text-center lg:text-left">
            <div className="flex flex-wrap justify-center gap-1.5 lg:justify-start">
              {!list.enabled && <span className="badge badge-dark">Paused</span>}
              <span className="badge badge-success">{list.counts.matched} in library</span>
              {list.counts.review > 0 && <span className="badge badge-warning">{list.counts.review} to review</span>}
              {list.counts.missing > 0 && <span className="badge badge-danger">{list.counts.missing} not in library</span>}
              {list.counts.ignored > 0 && <span className="badge badge-dark">{list.counts.ignored} ignored</span>}
            </div>
            <h1 className="mt-2 text-3xl font-bold leading-tight text-white lg:text-4xl">{list.name}</h1>
            <div className="mt-1 text-sm text-gray-400">
              Collection "{list.collectionName}" · {list.syncing ? "syncing now" : `synced ${timeAgo(list.lastSyncedAt)}`}
            </div>
            {list.description && <p className="mx-auto mt-3 line-clamp-3 max-w-3xl text-sm text-gray-300 lg:mx-0">{list.description}</p>}
            {list.lastStatus === "error" && list.lastError && (
              <div className="mt-3 rounded-md bg-red-900/40 p-2 text-sm text-red-200 ring-1 ring-red-800">{list.lastError}</div>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-wrap justify-center gap-2">
            {list.hcUrl && (
              <a href={list.hcUrl} target="_blank" rel="noreferrer" className="btn btn-default">
                <ArrowTopRightOnSquareIcon className="h-5 w-5" /> Hardcover
              </a>
            )}
            <button className="btn btn-default" onClick={() => setSettingsOpen(true)}>
              <Cog6ToothIcon className="h-5 w-5" />
            </button>
            <button className="btn btn-primary" onClick={sync} disabled={list.syncing}>
              {list.syncing ? <Spinner className="h-5 w-5 text-white" /> : <ArrowPathIcon className="h-5 w-5" />}
              {list.syncing ? "Syncing" : "Sync Now"}
            </button>
          </div>
        </div>

        <div className="mt-10">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: "all", label: "All", count: list.counts.total },
              { id: "matched", label: "In Library", count: list.counts.matched },
              { id: "review", label: "Review", count: list.counts.review },
              { id: "missing", label: "Not in Library", count: list.counts.missing },
              { id: "ignored", label: "Ignored", count: list.counts.ignored },
            ]}
          />
          {books.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">{list.syncing ? "Working on it..." : "Nothing here."}</div>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
              {books.map((b) => (
                <li key={b.hcBookId} className="flex justify-center">
                  <BookCard
                    book={b}
                    width="w-full"
                    actionLabel={b.status === "review" ? "Review" : "Details"}
                    onClick={() => setParams({ book: String(b.hcBookId) })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <BookModal
        book={selected}
        libraryId={list.absLibraryId}
        onClose={() => setParams({})}
        onChanged={reload}
      />
      {settingsOpen && <ListSettings list={list} open onClose={() => setSettingsOpen(false)} onSaved={reload} />}
    </div>
  );
}
