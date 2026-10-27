import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookmarkIcon, CheckCircleIcon, LinkIcon } from "@heroicons/react/24/outline";
import { api, type HcList, type Library, type List } from "../lib/api";
import { Cover, Modal, Spinner, Toggle } from "./ui";
import { useToast } from "./toast";

function Covers({ urls }: { urls: string[] }) {
  return (
    <div className="flex h-16 w-24 flex-shrink-0 -space-x-6">
      {[0, 1, 2].map((i) => (
        <Cover
          key={i}
          src={urls[i]}
          alt=""
          className="h-16 w-11 rounded-md shadow-lg ring-2 ring-gray-800"
        />
      ))}
    </div>
  );
}

export function AddListModal({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: List[] }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [lists, setLists] = useState<HcList[] | null>(null);
  const [shelves, setShelves] = useState<HcList[] | null>(null);
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [picked, setPicked] = useState<HcList | null>(null);
  const [libraryId, setLibraryId] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [removeMissing, setRemoveMissing] = useState(true);
  const [keepOrder, setKeepOrder] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setUrl("");
    setLoadError(null);
    api<HcList[]>("/hardcover/lists").then(setLists).catch((e) => setLoadError(e.message));
    api<HcList[]>("/hardcover/shelves").then(setShelves).catch(() => setShelves([]));
    api<Library[]>("/abs/libraries")
      .then((l) => {
        setLibraries(l);
        setLibraryId((cur) => cur || l[0]?.id || "");
      })
      .catch((e) => setLoadError(e.message));
  }, [open]);

  const pick = (l: HcList) => {
    setPicked(l);
    setCollectionName(l.defaultCollectionName ?? l.name);
  };

  const resolve = async () => {
    if (!url.trim()) return;
    setResolving(true);
    try {
      pick(await api<HcList>("/hardcover/resolve", { method: "POST", body: { url } }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setResolving(false);
    }
  };

  const save = async () => {
    if (!picked || !libraryId) return;
    setSaving(true);
    try {
      const list = await api<List>("/lists", {
        method: "POST",
        body: { sourceType: picked.sourceType ?? "hardcover_list", hcListId: picked.id, hcOwner: picked.owner, absLibraryId: libraryId, collectionName, removeMissing, keepOrder },
      });
      toast(`Syncing "${list.name}"`);
      onClose();
      navigate(`/lists/${list.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const key = (type: string | undefined, id: number) => `${type ?? "hardcover_list"}:${id}`;
  const synced = new Set(existing.filter((l) => l.absLibraryId === libraryId).map((l) => key(l.sourceType, l.hcListId)));

  const row = (l: HcList, sub: string) => (
    <button
      key={key(l.sourceType, l.id)}
      onClick={() => pick(l)}
      className="flex w-full items-center gap-4 rounded-lg bg-gray-900/40 p-3 text-left ring-1 ring-gray-700 transition hover:bg-gray-700/60 hover:ring-gray-500"
    >
      <Covers urls={l.coverUrls} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 truncate font-semibold text-white">
          {l.sourceType === "hardcover_status" && <BookmarkIcon className="h-4 w-4 flex-shrink-0 text-purple-400" />}
          {l.name}
        </div>
        <div className="text-xs text-gray-400">{sub}</div>
      </div>
      {synced.has(key(l.sourceType, l.id)) && <CheckCircleIcon className="h-6 w-6 text-green-400" title="Already synced" />}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={picked ? `Sync "${picked.name}"` : "New Collection"}
      subtitle={picked ? `${picked.booksCount} books` : "Pick a Hardcover shelf or list, or paste a link to anyone's public list."}
      footer={
        picked ? (
          <>
            <button className="btn btn-default" onClick={() => setPicked(null)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !libraryId || !collectionName.trim()}>
              {saving && <Spinner className="h-4 w-4 text-white" />} Start syncing
            </button>
          </>
        ) : undefined
      }
    >
      {loadError && <div className="mt-4 rounded-md bg-red-900/30 p-3 text-sm text-red-200 ring-1 ring-red-800">{loadError}</div>}

      {!picked && (
        <>
          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-10"
                placeholder="https://hardcover.app/@someone/lists/best-sci-fi"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resolve()}
              />
            </div>
            <button className="btn btn-primary" onClick={resolve} disabled={resolving || !url.trim()}>
              {resolving ? <Spinner className="h-4 w-4 text-white" /> : "Find"}
            </button>
          </div>

          <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Your shelves</h4>
          {!shelves && !loadError && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}
          <div className="space-y-2">{shelves?.map((l) => row(l, `${l.booksCount} books`))}</div>

          <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Your lists</h4>
          {!lists && !loadError && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {lists?.length === 0 && <div className="text-sm text-gray-500">You don't have any lists on Hardcover yet.</div>}
          <div className="space-y-2">{lists?.map((l) => row(l, `${l.booksCount} books${l.followed ? " · followed" : ""}`))}</div>
        </>
      )}

      {picked && (
        <div className="pt-2">
          <div className="form-row">
            <label>Audiobookshelf library</label>
            <div className="form-input-area">
              <select className="input" value={libraryId} onChange={(e) => setLibraryId(e.target.value)}>
                {libraries?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label>Collection name</label>
            <div className="form-input-area">
              <input className="input" value={collectionName} onChange={(e) => setCollectionName(e.target.value)} />
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
          <p className="mt-6 text-sm text-gray-400">
            Only confident matches are added. Anything uncertain waits in Review for you.
          </p>
        </div>
      )}
    </Modal>
  );
}
