import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookmarkIcon, CheckCircleIcon, FaceSmileIcon, InboxArrowDownIcon, MagnifyingGlassIcon, TagIcon } from "@heroicons/react/24/outline";
import { api, type HcList, type HcTag, type Library, type List, type TagKind } from "../lib/api";
import { useAllTags } from "./TagSearch";
import { Cover, Modal, Spinner, Toggle } from "./ui";
import { useToast } from "./toast";

/** A Hardcover list link (or just `@user/lists/slug`). */
const looksLikeList = (q: string) => /@[^/\s]+\/lists\/[^/?#\s]+/i.test(q.trim());

/** A public Hardcover list from search. */
type ListHit = { id: number; name: string; owner: string | null; booksCount: number };

/** A genre or mood collection's name, matching the server's. */
const tagCollectionName = (kind: TagKind, name: string, range: number) => (range === 1 ? `Trending ${name}` : kind === "genre" ? `Top ${name}` : `${name} reads`);

/** A genre or mood as something to pick, shaped like a list. `slug` holds "genre:<slug>". */
const tagPick = (kind: TagKind, t: HcTag): HcList => ({
  id: 0,
  slug: `${kind}:${t.slug}`,
  name: t.name,
  description: null,
  booksCount: t.count,
  owner: null,
  coverUrls: [],
  sourceType: "hardcover_tag",
});

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
  const [requestLists, setRequestLists] = useState<HcList[] | null>(null);
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
  /** For a genre or mood: 0 = top books of all time, 1 = trending this month. */
  const [range, setRange] = useState(0);
  // Public lists from all of Hardcover, searched a moment after typing stops.
  const [found, setFound] = useState<{ q: string; lists: ListHit[] } | null>(null);
  const q = url.trim();
  const link = looksLikeList(q);
  useEffect(() => {
    if (link || q.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      api<ListHit[]>(`/discover/list-search?q=${encodeURIComponent(q)}`)
        .catch(() => [] as ListHit[])
        .then((lists) => !stale && setFound({ q, lists }));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, link]);
  const searching = !link && q.length >= 2 && found?.q !== q;
  const genres = useAllTags("genre", open);
  const moods = useAllTags("mood", open);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setUrl("");
    setLoadError(null);
    api<HcList[]>("/hardcover/lists").then(setLists).catch((e) => setLoadError(e.message));
    api<HcList[]>("/hardcover/shelves").then(setShelves).catch(() => setShelves([]));
    api<HcList[]>("/requests/sources").then(setRequestLists).catch(() => setRequestLists([]));
    api<Library[]>("/abs/libraries")
      .then((l) => {
        setLibraries(l);
        setLibraryId((cur) => cur || l[0]?.id || "");
      })
      .catch((e) => setLoadError(e.message));
  }, [open]);

  const pick = (l: HcList) => {
    setPicked(l);
    setRange(0);
    const tag = l.sourceType === "hardcover_tag" ? (l.slug?.split(":")[0] as TagKind) : null;
    setCollectionName(tag ? tagCollectionName(tag, l.name, 0) : (l.defaultCollectionName ?? l.name));
  };
  const pickedTag = picked?.sourceType === "hardcover_tag" ? (picked.slug?.split(":")[0] as TagKind) : null;

  const resolve = async (ref = url, owner?: string | null) => {
    if (!ref.trim()) return;
    setResolving(true);
    try {
      const l = await api<HcList>("/hardcover/resolve", { method: "POST", body: { url: ref } });
      pick(owner === undefined ? l : { ...l, owner });
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
        body: {
          sourceType: picked.sourceType ?? "hardcover_list",
          hcListId: pickedTag ? range : picked.id,
          tagRef: pickedTag ? picked.slug : undefined,
          hcOwner: picked.owner,
          absLibraryId: libraryId,
          collectionName,
          removeMissing,
          keepOrder,
        },
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

  // Shelves first, then your lists, then the ones you follow.
  const mine = useMemo(() => [...(shelves ?? []), ...(lists ?? []).filter((l) => !l.followed), ...(lists ?? []).filter((l) => l.followed)], [shelves, lists]);
  const sub = (l: HcList) =>
    l.sourceType === "requests"
      ? `${l.booksCount} requested · books join as they arrive in Audiobookshelf`
      : `${l.booksCount} books${l.sourceType === "hardcover_status" ? " · shelf" : l.followed ? " · followed" : ""}`;
  const want = q.toLowerCase();
  const matches = q && !link ? [...mine, ...(requestLists ?? [])].filter((l) => l.name.toLowerCase().includes(want)) : [];
  const tagMatches = (kind: TagKind, tags: HcTag[] | null) =>
    q && !link ? (tags ?? []).filter((t) => t.name.toLowerCase().includes(want)).sort((a, b) => Number(!a.name.toLowerCase().startsWith(want)) - Number(!b.name.toLowerCase().startsWith(want))).slice(0, 6) : [];
  const genreHits = tagMatches("genre", genres.tags);
  const moodHits = tagMatches("mood", moods.tags);
  const ownIds = new Set((lists ?? []).map((l) => l.id));
  const others = found?.q === q && !link ? found.lists.filter((h) => !ownIds.has(h.id)) : [];

  const key = (type: string | undefined, id: number) => `${type ?? "hardcover_list"}:${id}`;
  const synced = new Set(existing.filter((l) => l.absLibraryId === libraryId).map((l) => key(l.sourceType, l.hcListId)));
  const syncedTags = new Set(existing.filter((l) => l.absLibraryId === libraryId && l.sourceType === "hardcover_tag").map((l) => l.hcSlug));

  const tagRow = (kind: TagKind, t: HcTag) => (
    <button
      key={`${kind}:${t.slug}`}
      onClick={() => pick(tagPick(kind, t))}
      className="flex w-full items-center gap-3 rounded-lg bg-gray-900/40 p-3 text-left ring-1 ring-gray-700 transition hover:bg-gray-700/60 hover:ring-gray-500"
    >
      {kind === "genre" ? <TagIcon className="h-5 w-5 flex-shrink-0 text-pink-400" /> : <FaceSmileIcon className="h-5 w-5 flex-shrink-0 text-amber-400" />}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{t.name}</div>
        <div className="text-xs text-gray-400">
          {kind === "genre" ? "Genre" : "Mood"} · {t.count.toLocaleString()} books
        </div>
      </div>
      {syncedTags.has(`${kind}:${t.slug}`) && <CheckCircleIcon className="h-6 w-6 text-green-400" title="Already synced" />}
    </button>
  );

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
          {l.sourceType === "requests" && <InboxArrowDownIcon className="h-4 w-4 flex-shrink-0 text-indigo-400" />}
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
      subtitle={picked ? (pickedTag ? `${pickedTag === "genre" ? "Genre" : "Mood"} · up to 100 books` : `${picked.booksCount} books`) : "Pick one of your shelves or lists, someone's requests, or search Hardcover's public lists, genres and moods."}
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
          <div className="relative mt-4">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-10"
              placeholder="Search your shelves and lists, Hardcover's lists, genres and moods, or paste a list link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && link && resolve()}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>

          {link && (
            <button
              className="mt-4 flex w-full items-center gap-3 rounded-lg bg-gray-900/40 p-3 text-left text-sm text-gray-200 ring-1 ring-gray-700 hover:bg-gray-700/60"
              onClick={() => resolve()}
              disabled={resolving}
            >
              {resolving ? <Spinner className="h-4 w-4" /> : <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />}
              Open the list at this link
            </button>
          )}

          {q && !link && (
            <>
              {matches.length > 0 && (
                <>
                  <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Yours</h4>
                  <div className="space-y-2">{matches.map((l) => row(l, sub(l)))}</div>
                </>
              )}
              {genreHits.length + moodHits.length > 0 && (
                <>
                  <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Genres and moods</h4>
                  <div className="space-y-2">
                    {genreHits.map((t) => tagRow("genre", t))}
                    {moodHits.map((t) => tagRow("mood", t))}
                  </div>
                </>
              )}
              <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Lists on Hardcover</h4>
              {searching && (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                  <Spinner className="h-4 w-4" /> Searching Hardcover lists...
                </div>
              )}
              {!searching && others.length === 0 && <div className="text-sm text-gray-500">No public lists match.</div>}
              <div className="space-y-2">
                {others.map((h) => (
                  <button
                    key={`hit:${h.id}`}
                    onClick={() => resolve(String(h.id), h.owner)}
                    disabled={resolving}
                    className="flex w-full items-center gap-4 rounded-lg bg-gray-900/40 p-3 text-left ring-1 ring-gray-700 transition hover:bg-gray-700/60 hover:ring-gray-500"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">{h.name}</div>
                      <div className="text-xs text-gray-400">
                        {h.owner ? `@${h.owner} · ` : ""}
                        {h.booksCount.toLocaleString()} books
                      </div>
                    </div>
                    {synced.has(key("hardcover_list", h.id)) && <CheckCircleIcon className="h-6 w-6 text-green-400" title="Already synced" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {!q && (
            <>
              <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Your shelves and lists</h4>
              {(!shelves || !lists) && !loadError && (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              )}
              <div className="space-y-2">{shelves && lists && mine.map((l) => row(l, sub(l)))}</div>

              {requestLists && requestLists.length > 1 && (
                <>
                  <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Requests</h4>
                  <div className="space-y-2">{requestLists.map((l) => row(l, sub(l)))}</div>
                </>
              )}
            </>
          )}
        </>
      )}

      {picked && (
        <div className="pt-2">
          {pickedTag && (
            <div className="form-row">
              <label>
                Books
                <span className="label-tip">Which {pickedTag} books the collection follows. Up to 100.</span>
              </label>
              <div className="form-input-area">
                <select
                  className="input"
                  value={range}
                  onChange={(e) => {
                    const r = Number(e.target.value);
                    // Keep the name in step unless it was changed by hand.
                    if (collectionName === tagCollectionName(pickedTag, picked!.name, range)) setCollectionName(tagCollectionName(pickedTag, picked!.name, r));
                    setRange(r);
                  }}
                >
                  <option value={0}>Top, all time</option>
                  <option value={1}>Trending this month</option>
                </select>
              </div>
            </div>
          )}
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
