import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bars3Icon, FaceSmileIcon, PlusIcon, RectangleStackIcon, SparklesIcon, TagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api, tagRowInfo, type DiscoverConfig, type DiscoverRowInfo, type HcList, type TagKind } from "../lib/api";
import { TagSearch } from "./TagSearch";
import { Modal, Spinner } from "./ui";
import { useToast } from "./toast";

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
  const [ref, setRef] = useState("");
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
  const addList = async (input: string) => {
    if (!input.trim()) return;
    setAdding(true);
    try {
      const row = await api<DiscoverRowInfo>("/discover/list", { method: "POST", body: { ref: input.trim() } });
      if (!has(row.key)) setRows([...rows, row]);
      setRef("");
    } catch (e) {
      toast((e as Error).message, "error");
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

      <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Add a row</h4>
      <div className="flex flex-wrap gap-2">
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

      {(["genre", "mood"] as const).map((kind) => {
        const offered = (kind === "genre" ? config.genres : config.moods) ?? [];
        return (
          <div key={kind}>
            <h4 className="mb-1 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Add a {kind} row</h4>
            <p className="mb-2 text-xs text-gray-500">
              Adds a row of the top {kind === "genre" ? "books in that genre" : "books with that mood"} to Discover, like the rows above.
            </p>
            <div className="flex flex-wrap gap-2">
              {offered
                .filter((g) => !has(g.key))
                .map((g) => (
                  <button
                    key={g.key}
                    onClick={() => setRows([...rows, g])}
                    title={g.subtitle}
                    className="flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 hover:bg-gray-700"
                  >
                    <PlusIcon className="h-4 w-4" /> {g.name ?? g.title}
                  </button>
                ))}
            </div>
            <div className="mt-2">
              <TagSearch
                kind={kind}
                exclude={rows.filter((r) => r.kind === kind).map((r) => r.tag ?? "")}
                onPick={(t) => setRows([...rows, tagRowInfo(kind, t)])}
                placeholder={`Add a row for any ${kind} on Hardcover`}
              />
            </div>
          </div>
        );
      })}

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

      <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Add a Hardcover list</h4>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="https://hardcover.app/@someone/lists/best-sci-fi"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addList(ref)}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button className="btn btn-default flex-shrink-0" onClick={() => addList(ref)} disabled={adding || !ref.trim()}>
          {adding ? <Spinner className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />} Add
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">Any public list on Hardcover works.</p>
      {myLists && myLists.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {myLists
            .filter((l) => !has(`list-${l.id}`))
            .slice(0, 12)
            .map((l) => (
              <button
                key={l.id}
                onClick={() => addList(String(l.id))}
                className="flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 hover:bg-gray-700"
              >
                <PlusIcon className="h-4 w-4" /> {l.name}
              </button>
            ))}
        </div>
      )}

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
