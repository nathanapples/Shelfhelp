import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bars3Icon, FaceSmileIcon, MagnifyingGlassIcon, PlusIcon, RectangleStackIcon, SparklesIcon, TagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api, tagRowInfo, type DiscoverConfig, type DiscoverRowInfo, type HcList, type TagKind } from "../lib/api";
import { TagSearch, useAllTags } from "./TagSearch";
import { Modal, Spinner } from "./ui";
import { useToast } from "./toast";

type Hit = { key: string; label: string; detail: string | null; type: "Row" | "Genre" | "Mood" | "List"; pick: () => void };

const TYPE_STYLE: Record<Hit["type"], string> = {
  Row: "bg-purple-900/50 text-purple-200 ring-purple-700",
  Genre: "bg-pink-900/50 text-pink-200 ring-pink-700",
  Mood: "bg-amber-900/50 text-amber-200 ring-amber-700",
  List: "bg-indigo-900/50 text-indigo-200 ring-indigo-700",
};

/** A Hardcover list link (or just `@user/lists/slug`). */
const looksLikeList = (q: string) => /@[^/\s]+\/lists\/[^/?#\s]+/i.test(q.trim());

/**
 * One search for every kind of row: built-in rows, any Hardcover genre or
 * mood, your Hardcover lists, or a pasted list link. Each result says what it is.
 */
function RowSearch({
  has,
  lists,
  builtins,
  adding,
  onAddRow,
  onAddList,
}: {
  has: (key: string) => boolean;
  lists: HcList[];
  builtins: DiscoverRowInfo[];
  adding: boolean;
  onAddRow: (r: DiscoverRowInfo) => void;
  onAddList: (ref: string) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = focused || !!q;
  const genres = useAllTags("genre", load);
  const moods = useAllTags("mood", load);
  const link = looksLikeList(q);
  const hits = useMemo<Hit[]>(() => {
    const want = q.trim().toLowerCase();
    if (!want || link) return [];
    const starts = (s: string) => (s.toLowerCase().startsWith(want) ? 0 : 1);
    const match = (s: string) => s.toLowerCase().includes(want);
    const all: (Hit & { rank: number })[] = [
      ...builtins
        .filter((b) => !has(b.key) && match(b.title))
        .map((b) => ({ key: b.key, label: b.title, detail: b.subtitle, type: "Row" as const, pick: () => onAddRow(b), rank: starts(b.title) })),
      ...lists
        .filter((l) => !has(`list-${l.id}`) && match(l.name))
        .map((l) => ({ key: `list-${l.id}`, label: l.name, detail: `${l.booksCount} books`, type: "List" as const, pick: () => void onAddList(String(l.id)), rank: starts(l.name) })),
      ...(["genre", "mood"] as const).flatMap((kind) =>
        ((kind === "genre" ? genres.tags : moods.tags) ?? [])
          .filter((t) => !has(`${kind}-${t.slug}`) && match(t.name))
          .slice(0, 25)
          .map((t) => ({
            key: `${kind}-${t.slug}`,
            label: t.name,
            detail: `${t.count.toLocaleString()} books`,
            type: kind === "genre" ? ("Genre" as const) : ("Mood" as const),
            pick: () => onAddRow(tagRowInfo(kind, t)),
            rank: starts(t.name),
          })),
      ),
    ];
    // Names that start with what you typed first, then the order above.
    return all
      .map((h, i) => ({ h, i }))
      .sort((a, b) => a.h.rank - b.h.rank || a.i - b.i)
      .slice(0, 12)
      .map(({ h }) => h);
  }, [q, link, builtins, lists, genres.tags, moods.tags, has, onAddRow, onAddList]);
  const loading = !link && !!q.trim() && (!genres.tags || !moods.tags) && !genres.error && !moods.error;

  const submit = async () => {
    if (link) {
      if (await onAddList(q)) setQ("");
    } else if (hits[0]) {
      hits[0].pick();
      setQ("");
    }
  };

  return (
    <div ref={box} className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
      <input
        className="input py-1.5 pl-9 text-sm"
        value={q}
        placeholder="Search genres, moods and lists, or paste a Hardcover list link"
        onChange={(e) => {
          setQ(e.target.value);
          requestAnimationFrame(() => box.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
        }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {q.trim() && focused && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-gray-800 py-1 shadow-xl ring-1 ring-gray-600">
          {link ? (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
                disabled={adding}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
              >
                <span className={`flex-shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${TYPE_STYLE.List}`}>List</span>
                <span className="min-w-0 flex-1 truncate">Add the list at this link</span>
                {adding ? <Spinner className="h-4 w-4" /> : <PlusIcon className="h-4 w-4 text-gray-400" />}
              </button>
            </li>
          ) : (
            <>
              {hits.map((h) => (
                <li key={h.key}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      h.pick();
                      setQ("");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700"
                  >
                    <span className={`w-12 flex-shrink-0 rounded px-1.5 text-center text-[10px] font-semibold uppercase tracking-wide ring-1 ${TYPE_STYLE[h.type]}`}>
                      {h.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{h.label}</span>
                    {h.detail && <span className="hidden flex-shrink-0 text-xs text-gray-500 sm:inline">{h.detail}</span>}
                  </button>
                </li>
              ))}
              {loading && (
                <li className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400">
                  <Spinner className="h-4 w-4" /> Loading genres and moods from Hardcover...
                </li>
              )}
              {!loading && hits.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Nothing matches. Paste a Hardcover list link to add a list.</li>}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

/** Rows only move up and down. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** One row in the list, dragged by its handle. */
function SortableRow({ row: r, onRemove }: { row: DiscoverRowInfo; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: r.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex items-center gap-3 px-3 py-2 ${isDragging ? "z-10 bg-gray-700 shadow-lg ring-1 ring-indigo-500" : "bg-transparent"}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="-ml-1 cursor-grab touch-none rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-white active:cursor-grabbing"
        aria-label={`Drag to move ${r.title}`}
      >
        <Bars3Icon className="h-5 w-5" />
      </button>
      {r.kind === "list" ? (
        <RectangleStackIcon className="h-5 w-5 flex-shrink-0 text-indigo-400" />
      ) : r.kind === "genre" ? (
        <TagIcon className="h-5 w-5 flex-shrink-0 text-pink-400" />
      ) : r.kind === "mood" ? (
        <FaceSmileIcon className="h-5 w-5 flex-shrink-0 text-amber-400" />
      ) : (
        <SparklesIcon className="h-5 w-5 flex-shrink-0 text-purple-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{r.title}</div>
        <div className="truncate text-xs text-gray-500">{r.subtitle}</div>
      </div>
      <button className="btn btn-sm btn-ghost" onClick={onRemove} aria-label={`Remove ${r.title}`}>
        <XMarkIcon className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Pick, order and add rows for Discover. Admins can save them as everyone's default. */
export function CustomizeDiscover({
  config,
  admin,
  onClose,
  onSaved,
}: {
  config: DiscoverConfig;
  admin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<DiscoverRowInfo[]>(config.allRows ?? config.rows);
  const toTags = (list: DiscoverRowInfo[] | undefined) => (list ?? []).map((g) => ({ slug: g.tag ?? "", name: g.name ?? g.title }));
  const [chips, setChips] = useState<Record<TagKind, { slug: string; name: string }[]>>({ genre: toTags(config.genres), mood: toTags(config.moods) });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asDefault, setAsDefault] = useState(false);
  const [myLists, setMyLists] = useState<HcList[] | null>(null);
  useEffect(() => {
    if (admin) api<HcList[]>("/hardcover/lists").then(setMyLists).catch(() => setMyLists([]));
  }, [admin]);

  const has = (key: string) => rows.some((r) => r.key === key);
  // Mouse drags start after a few pixels; touch drags after a short press, so the list still scrolls.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.key === active.id);
    const to = rows.findIndex((r) => r.key === over.id);
    if (from >= 0 && to >= 0) setRows(arrayMove(rows, from, to));
  };
  const addList = async (input: string): Promise<boolean> => {
    if (!input.trim()) return false;
    setAdding(true);
    try {
      const row = await api<DiscoverRowInfo>("/discover/list", { method: "POST", body: { ref: input.trim() } });
      if (has(row.key)) toast(`${row.title} is already a row`, "info");
      else setRows((cur) => [...cur, row]);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setAdding(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api("/discover/rows", { method: "PUT", body: { rows, asDefault, tags: chips } });
      toast(asDefault ? "Saved as everyone's default" : "Discover saved");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api("/discover/rows", { method: "DELETE" });
      toast("Back to the default rows");
      onSaved();
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
      title="Customize Discover"
      subtitle={admin ? "Your rows, or the default rows for everyone." : "Pick the rows you see and their order."}
      size="max-w-2xl"
      footer={
        <>
          {config.custom && !asDefault && (
            <button className="btn btn-default mr-auto" onClick={reset} disabled={busy}>
              Use the defaults
            </button>
          )}
          <button className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || rows.length === 0}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Save
          </button>
        </>
      }
    >
      <h4 className="mb-2 mt-3 text-sm font-semibold uppercase tracking-wider text-gray-400">Your rows</h4>
      <p className="-mt-1 mb-2 text-xs text-gray-500">Drag rows by the handle to reorder them.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-gray-700 overflow-hidden rounded-lg bg-gray-900/40 ring-1 ring-gray-700">
            {rows.map((r) => (
              <SortableRow key={r.key} row={r} onRemove={() => setRows(rows.filter((x) => x.key !== r.key))} />
            ))}
            {rows.length === 0 && <li className="px-3 py-4 text-sm text-gray-500">No rows. Add some below.</li>}
          </ul>
        </SortableContext>
      </DndContext>

      <h4 className="mb-1 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Add a row</h4>
      <p className="mb-2 text-xs text-gray-500">
        Search for a genre, mood or Hardcover list to add it as a row, or paste a link to any public Hardcover list.
      </p>
      <RowSearch
        has={has}
        lists={myLists ?? []}
        builtins={config.builtins}
        adding={adding}
        onAddRow={(r) => setRows([...rows, r])}
        onAddList={addList}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {config.builtins
          .filter((b) => !has(b.key))
          .map((b) => (
            <button
              key={b.key}
              onClick={() => setRows([...rows, b])}
              title={b.subtitle}
              className="flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 hover:bg-gray-700"
            >
              <PlusIcon className="h-4 w-4" /> {b.title}
            </button>
          ))}
      </div>

      <h4 className="mb-1 mt-8 text-sm font-semibold uppercase tracking-wider text-gray-400">Genres and moods to browse</h4>
      <p className="mb-3 text-xs text-gray-500">
        The chips in Browse by genre and Browse by mood at the bottom of Discover. Each opens that genre or mood's page; they don't add rows.
      </p>
      {(["genre", "mood"] as const).map((kind) => (
        <div key={kind} className="mb-4">
          <div className="mb-1.5 text-xs font-semibold text-gray-300">{kind === "genre" ? "Genres" : "Moods"}</div>
          <div className="flex flex-wrap gap-2">
            {chips[kind].map((t) => (
              <span key={t.slug} className="flex items-center gap-1 rounded-full bg-gray-800 py-1 pl-3 pr-1 text-sm text-gray-200 ring-1 ring-gray-600">
                {t.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-gray-400 hover:bg-gray-700 hover:text-white"
                  onClick={() => setChips({ ...chips, [kind]: chips[kind].filter((x) => x.slug !== t.slug) })}
                  aria-label={`Remove ${t.name}`}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {chips[kind].length === 0 && <span className="text-sm text-gray-500">None. The section is hidden.</span>}
          </div>
          <div className="mt-2">
            <TagSearch
              kind={kind}
              exclude={chips[kind].map((t) => t.slug)}
              onPick={(t) => setChips({ ...chips, [kind]: [...chips[kind], t] })}
              placeholder={`Add a ${kind} to browse`}
            />
          </div>
        </div>
      ))}

      {admin && (
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg bg-indigo-900/20 p-3 ring-1 ring-indigo-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
            checked={asDefault}
            onChange={(e) => setAsDefault(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium text-white">Make these the default for everyone</span>
            <span className="block text-xs text-gray-400">People who've picked their own rows keep theirs.</span>
          </span>
        </label>
      )}
    </Modal>
  );
}
