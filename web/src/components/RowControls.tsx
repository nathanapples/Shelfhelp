import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
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

/** Ways to order a Hardcover list row. The server sorts the whole list, then trims it. */
export const LIST_ORDERS = ["list", "newest", "oldest", "title", "author", "random"] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];
export const ORDER_LABELS: Record<ListOrder, string> = {
  list: "List order",
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title",
  author: "Author",
  random: "Random",
};

/** One shuffle per visit, so a Random row and its full page show the same order until you reload. */
export const SHUFFLE_SEED = Math.floor(Math.random() * 1_000_000_000) + 1;

/**
 * Per list row: the order picked on Discover or the row's page, remembered in
 * this browser. Until you pick one, the row's default from Customize.
 */
export function useListOrder(key: string, fallback: ListOrder = "list") {
  return useStoredState<ListOrder>(`discover.order.${key}`, fallback, LIST_ORDERS);
}

/** Forgets an order picked in this browser, so the row follows its default again. */
export function forgetListOrder(key: string) {
  try {
    localStorage.removeItem(`shelfhelp.discover.order.${key}`);
  } catch {
    /* private mode */
  }
}

/** Query string for a list row's books in this order. */
export const orderQuery = (order: ListOrder) => `order=${order}${order === "random" ? `&seed=${SHUFFLE_SEED}` : ""}`;

/** Order picker for a list row. */
export function OrderPicker({ order, onChange, label = "Order of books" }: { order: ListOrder; onChange: (o: ListOrder) => void; label?: string }) {
  return (
    <select
      value={order}
      onChange={(e) => onChange(e.target.value as ListOrder)}
      aria-label={label}
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
