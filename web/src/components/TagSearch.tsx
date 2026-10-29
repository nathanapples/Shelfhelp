import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/24/outline";
import { api, type HcTag, type TagKind } from "../lib/api";
import { Spinner } from "./ui";

const lists: Partial<Record<TagKind, Promise<HcTag[]>>> = {};

/** Every genre or mood on Hardcover (most books first), loaded once per page visit. */
export function useAllTags(kind: TagKind, load = true) {
  const [tags, setTags] = useState<HcTag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!load) return;
    let alive = true;
    setTags(null);
    lists[kind] ??= api<HcTag[]>(`/tags/${kind}`).catch((e) => {
      delete lists[kind];
      throw e;
    });
    lists[kind]!.then((t) => alive && setTags(t)).catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [kind, load]);
  return { tags, error };
}

/** Type to find any Hardcover genre or mood, then pick it. */
export function TagSearch({
  kind,
  exclude,
  onPick,
  placeholder,
}: {
  kind: TagKind;
  exclude: string[];
  onPick: (t: { slug: string; name: string }) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { tags, error } = useAllTags(kind, focused || !!q);
  const matches = useMemo(() => {
    const want = q.trim().toLowerCase();
    if (!tags || !want) return [];
    return tags.filter((t) => !exclude.includes(t.slug) && t.name.toLowerCase().includes(want)).slice(0, 8);
  }, [tags, q, exclude]);
  return (
    <div ref={box} className="relative max-w-sm">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
      <input
        className="input py-1.5 pl-9 text-sm"
        value={q}
        placeholder={placeholder ?? `Find any ${kind} on Hardcover`}
        onChange={(e) => {
          setQ(e.target.value);
          // Keep the matches in view inside a scrolling popup.
          requestAnimationFrame(() => box.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {q.trim() && focused && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-gray-800 py-1 shadow-xl ring-1 ring-gray-600">
          {error && <li className="px-3 py-2 text-sm text-red-300">{error}</li>}
          {!tags && !error && (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400">
              <Spinner className="h-4 w-4" /> Loading from Hardcover...
            </li>
          )}
          {tags && matches.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">No {kind} matches.</li>}
          {matches.map((t) => (
            <li key={t.slug}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick({ slug: t.slug, name: t.name });
                  setQ("");
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700"
              >
                <PlusIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs text-gray-500">{t.count.toLocaleString()} books</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
