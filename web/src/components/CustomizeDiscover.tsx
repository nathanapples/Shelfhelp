import { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, RectangleStackIcon, SparklesIcon, TagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api, type DiscoverConfig, type DiscoverRowInfo, type HcList } from "../lib/api";
import { Modal, Spinner } from "./ui";
import { useToast } from "./toast";

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
  const [rows, setRows] = useState<DiscoverRowInfo[]>(config.rows);
  const [ref, setRef] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asDefault, setAsDefault] = useState(false);
  const [myLists, setMyLists] = useState<HcList[] | null>(null);
  useEffect(() => {
    if (admin) api<HcList[]>("/hardcover/lists").then(setMyLists).catch(() => setMyLists([]));
  }, [admin]);

  const has = (key: string) => rows.some((r) => r.key === key);
  const move = (i: number, d: number) => {
    const next = rows.slice();
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    setRows(next);
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
      await api("/discover/rows", { method: "PUT", body: { rows, asDefault } });
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
      <ul className="divide-y divide-gray-700 overflow-hidden rounded-lg bg-gray-900/40 ring-1 ring-gray-700">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center gap-3 px-3 py-2">
            {r.kind === "list" ? (
              <RectangleStackIcon className="h-5 w-5 flex-shrink-0 text-indigo-400" />
            ) : r.kind === "genre" ? (
              <TagIcon className="h-5 w-5 flex-shrink-0 text-pink-400" />
            ) : (
              <SparklesIcon className="h-5 w-5 flex-shrink-0 text-purple-400" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{r.title}</div>
              <div className="truncate text-xs text-gray-500">{r.subtitle}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <ArrowUpIcon className="h-4 w-4" />
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">
              <ArrowDownIcon className="h-4 w-4" />
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.title}`}>
              <XMarkIcon className="h-4 w-4" />
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-4 text-sm text-gray-500">No rows. Add some below.</li>}
      </ul>

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

      <h4 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">Add a genre</h4>
      <div className="flex flex-wrap gap-2">
        {(config.genres ?? [])
          .filter((g) => !has(g.key))
          .map((g) => (
            <button
              key={g.key}
              onClick={() => setRows([...rows, g])}
              title={g.subtitle}
              className="flex items-center gap-1 rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 hover:bg-gray-700"
            >
              <PlusIcon className="h-4 w-4" /> {g.title.replace(/^Top /, "")}
            </button>
          ))}
      </div>

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
