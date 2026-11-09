import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import type { DiscoverBook } from "../lib/api";
import { useStoredState } from "../lib/hooks";

/** Rows that hide books already in Audiobookshelf until you show them. */
const HIDE_BY_DEFAULT = new Set(["foryou", "want"]);

/**
 * Per row, remembered in this browser: whether books already in Audiobookshelf show.
 * Discover and the row's own page share the setting.
 */
export function useOwnedFilter(key: string) {
  return useStoredState<"show" | "hide">(`discover.owned.${key}`, HIDE_BY_DEFAULT.has(key) ? "hide" : "show", ["show", "hide"]);
}

/** Eye button: open eye shows books in Audiobookshelf, crossed out hides them. The words appear on hover. */
export function OwnedToggle({ owned, onChange }: { owned: "show" | "hide"; onChange: (v: "show" | "hide") => void }) {
  const showing = owned === "show";
  const Icon = showing ? EyeIcon : EyeSlashIcon;
  return (
    <button
      type="button"
      onClick={() => onChange(showing ? "hide" : "show")}
      aria-pressed={showing}
      aria-label="Show books in Audiobookshelf"
      className={`group relative rounded-full p-1.5 ring-1 transition hover:bg-gray-700 hover:text-white ${
        showing ? "text-gray-300 ring-gray-700" : "text-gray-500 ring-gray-700"
      }`}
    >
      <Icon className="h-5 w-5" />
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-gray-100 opacity-0 shadow-lg ring-1 ring-gray-600 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        Show books in Audiobookshelf
      </span>
    </button>
  );
}

/** Ways to order a Hardcover list row. */
export const LIST_ORDERS = ["list", "newest", "oldest", "title", "author"] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];
const ORDER_LABELS: Record<ListOrder, string> = {
  list: "List order",
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title",
  author: "Author",
};

/** Per list row, remembered in this browser and shared with the row's own page. */
export function useListOrder(key: string) {
  return useStoredState<ListOrder>(`discover.order.${key}`, "list", LIST_ORDERS);
}

const text = (s: string | null | undefined) => (s ?? "").replace(/^(the|a|an)\s+/i, "");
const surname = (b: DiscoverBook) => (b.authors[0] ?? "").split(" ").pop() ?? "";

export function sortBooks(books: DiscoverBook[], order: ListOrder): DiscoverBook[] {
  if (order === "list") return books;
  const out = [...books];
  const year = (b: DiscoverBook, missing: number) => b.releaseYear ?? missing;
  if (order === "newest") out.sort((a, b) => year(b, -Infinity) - year(a, -Infinity));
  if (order === "oldest") out.sort((a, b) => year(a, Infinity) - year(b, Infinity));
  if (order === "title") out.sort((a, b) => text(a.title).localeCompare(text(b.title)));
  if (order === "author") out.sort((a, b) => surname(a).localeCompare(surname(b)) || text(a.title).localeCompare(text(b.title)));
  return out;
}

/** Order picker for a list row. */
export function OrderPicker({ order, onChange }: { order: ListOrder; onChange: (o: ListOrder) => void }) {
  return (
    <select
      value={order}
      onChange={(e) => onChange(e.target.value as ListOrder)}
      aria-label="Order of books"
      className="rounded-full border-0 bg-gray-800 py-1 pl-3 pr-8 text-xs text-gray-200 ring-1 ring-gray-700 focus:ring-indigo-500"
    >
      {LIST_ORDERS.map((o) => (
        <option key={o} value={o}>
          {ORDER_LABELS[o]}
        </option>
      ))}
    </select>
  );
}
