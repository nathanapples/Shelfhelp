import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdjustmentsHorizontalIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { hardcoverSignInUrl, isAdmin, listLink, type DiscoverBook, type DiscoverConfig, type DiscoverRowInfo, type RequestOutcome, type SearchHit, type Status, type TagKind, tagLink } from "../lib/api";
import { CustomizeDiscover } from "../components/CustomizeDiscover";
import { useApi, useStoredState } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { BookTile } from "../components/BookTile";
import { RequestModal } from "../components/Request";
import { Spinner } from "../components/ui";
import { withOutcomes } from "./Search";

/** Discover posters: about a third smaller than search results. */
const SMALL = "w-[6.5rem] sm:w-28 md:w-32";

/**
 * After a request finishes: update the book's poster, and the popup only if
 * it's still open on that book (so closing it while waiting keeps it closed).
 */
export function afterRequest<T extends { book: SearchHit; replace?: (b: SearchHit) => void }>(
  requested: T | null,
  setOpen: (f: (cur: T | null) => T | null) => void,
  outcomes: RequestOutcome[],
) {
  if (!requested) return;
  const next = withOutcomes(requested.book, outcomes);
  requested.replace?.(next);
  setOpen((cur) => (cur && cur.book.id === next.id ? { ...cur, book: withOutcomes(cur.book, outcomes) } : cur));
}

/** A Browse section at the bottom of Discover: chips that each open a page. The title opens the page with all of them. */
export function ChipStrip({
  title,
  subtitle,
  to,
  allLabel,
  chips,
}: {
  title: string;
  subtitle: string;
  to: string;
  allLabel: string;
  chips: { key: string; label: string; to: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = () => {
    const el = ref.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [chips.length]);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: "smooth" });
  if (!chips.length) return null;
  const arrow = "rounded-full p-1.5 text-gray-400 ring-1 ring-gray-700 transition hover:bg-gray-700 hover:text-white disabled:opacity-30";
  return (
    <section className="mb-4">
      <div className="mb-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-white sm:text-xl">
            <Link to={to} className="hover:text-indigo-300">
              {title} ›
            </Link>
          </h2>
          <p className="truncate text-xs text-gray-400 sm:text-sm">{subtitle}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button className={arrow} onClick={() => scroll(-1)} disabled={!edges.left} aria-label={`Scroll ${title.toLowerCase()} left`}>
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button className={arrow} onClick={() => scroll(1)} disabled={!edges.right} aria-label={`Scroll ${title.toLowerCase()} right`}>
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        onScroll={update}
        className="hide-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        {chips.map((c) => (
          <Link
            key={c.key}
            to={c.to}
            className="flex-shrink-0 whitespace-nowrap rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 transition hover:bg-gray-700 hover:text-white"
          >
            {c.label}
          </Link>
        ))}
        <Link
          to={to}
          className="flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium text-indigo-300 ring-1 ring-indigo-700 transition hover:bg-indigo-900/40"
        >
          {allLabel} ›
        </Link>
      </div>
    </section>
  );
}

const tagChips = (kind: TagKind, tags: DiscoverRowInfo[]) =>
  tags.map((g) => ({ key: g.key, label: g.name ?? g.title, to: tagLink(kind, { slug: g.tag ?? "", name: g.name ?? g.title }) }));

/** Why a personal row is empty, shown instead of hiding it. */
const EMPTY_NOTES: Record<string, string> = {
  foryou: "No picks yet. Hardcover makes these from your vibes: open hardcover.app and visit Vibes once, then check back in a few minutes.",
  want: "Nothing to show. Books on your Hardcover Want to Read shelf that aren't in Audiobookshelf yet show up here.",
  continue: "Nothing to pick up yet. When you've read a book in a series on Hardcover, the next one shows up here.",
};

function Shelf({
  row,
  status,
  onOpen,
  version,
}: {
  row: DiscoverRowInfo;
  status: Status;
  onOpen: (b: SearchHit, replace: (b: SearchHit) => void) => void;
  version: number;
}) {
  const { data: all, error, loading, setData } = useApi<DiscoverBook[]>(`/discover/${row.key}?v=${version}`);
  // Per row, remembered in this browser: whether books already in Audiobookshelf show.
  const [owned, setOwned] = useStoredState<"show" | "hide">(`discover.owned.${row.key}`, "show", ["show", "hide"]);
  const hasOwned = !!all?.some((b) => b.absItemId);
  const data = owned === "hide" ? all?.filter((b) => !b.absItemId) : all;
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });
  // Your own rows stay, with a line saying why they're empty; other empty rows are hidden.
  const emptyNote = EMPTY_NOTES[row.key];
  if (!loading && !error && all?.length === 0 && !emptyNote) return null;
  const replace = (b: SearchHit) => setData((d) => d?.map((x) => (x.id === b.id && x.absItemId === b.absItemId ? { ...x, ...b } : x)) ?? d);

  return (
    <section className="mb-4">
      <div className="mb-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-white sm:text-xl">
            <Link to={row.key === "requests" ? "/requests" : `/discover/${row.key}`} className="hover:text-indigo-300">
              {row.title} ›
            </Link>
          </h2>
          <p className="truncate text-xs text-gray-400 sm:text-sm">{row.subtitle}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {(hasOwned || owned === "hide") && row.key !== "added" && (
            <label
              className="mr-1 flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-xs text-gray-400 hover:text-gray-200"
              title="Show books you already have in Audiobookshelf"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                checked={owned === "show"}
                onChange={(e) => setOwned(e.target.checked ? "show" : "hide")}
              />
              Show owned
            </label>
          )}
          <button className="hidden rounded-full p-1.5 text-gray-400 ring-1 ring-gray-700 hover:bg-gray-700 hover:text-white sm:block" onClick={() => scroll(-1)} aria-label="Scroll left">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button className="hidden rounded-full p-1.5 text-gray-400 ring-1 ring-gray-700 hover:bg-gray-700 hover:text-white sm:block" onClick={() => scroll(1)} aria-label="Scroll right">
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      {loading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && <p className="rounded-lg bg-red-900/20 p-3 text-sm text-red-300 ring-1 ring-red-900">{error}</p>}
      {!loading && !error && all?.length === 0 && emptyNote && (
        <p className="rounded-lg bg-gray-800/60 p-3 text-sm text-gray-400 ring-1 ring-gray-700">{emptyNote}</p>
      )}
      {!loading && !error && !!all?.length && data?.length === 0 && (
        <p className="rounded-lg bg-gray-800/60 p-3 text-sm text-gray-400 ring-1 ring-gray-700">You already have everything in this row.</p>
      )}
      <div ref={scroller} className="hide-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-2 pt-1.5 sm:-mx-6 sm:scroll-px-6 sm:gap-2.5 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8">
        {data?.map((b, i) => (
          <div key={`${b.id}-${b.absItemId ?? i}`} className="snap-start">
            {row.key === "added" && !b.id ? (
              <BookCard
                book={{ ...b, status: "matched" }}
                pill="Added"
                fit="contain"
                size="sm"
                width={SMALL}
                note={b.addedAt ? `Added ${new Date(b.addedAt).toLocaleDateString()}` : null}
              />
            ) : (
              <BookTile
                book={b}
                status={status}
                size="sm"
                width={SMALL}
                onOpen={() => onOpen(b, replace)}
                pill={row.key === "added" ? "Added" : undefined}
                fit={row.key === "added" ? "contain" : undefined}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DiscoverPage({ status }: { status: Status }) {
  const { data: config, reload } = useApi<DiscoverConfig>("/discover");
  const [open, setOpen] = useState<{ book: SearchHit; replace: (b: SearchHit) => void } | null>(null);
  const [version, setVersion] = useState(0);
  const [customizing, setCustomizing] = useState(false);
  const shown = config?.rows ?? [];

  if (!status.configured.hardcover) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="text-2xl font-bold text-white">Welcome to Shelfhelp</h1>
        <p className="mt-2 text-gray-400">Connect Hardcover to start discovering books.</p>
        <Link to="/settings?tab=hardcover" className="btn btn-primary mt-6">
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-2">
      {config?.hardcoverProblem && (
        <div className="mb-5 rounded-xl bg-yellow-900/20 p-4 text-sm text-yellow-100 ring-1 ring-yellow-800">
          {config.hardcoverProblem}{" "}
          <Link to="/account" className="font-semibold underline">
            Open My account
          </Link>
        </div>
      )}
      {config?.needsHardcover && (
        <div className="mb-5 rounded-xl bg-indigo-900/20 p-4 text-sm text-indigo-100 ring-1 ring-indigo-800">
          Connect your Hardcover account to see Top picks for you, your Want to Read and series to pick up where you left off.{" "}
          {status.hardcoverSignIn ? (
            <a href={hardcoverSignInUrl("/")} className="font-semibold underline">
              Connect with Hardcover
            </a>
          ) : (
            <Link to="/account" className="font-semibold underline">
              Open My account
            </Link>
          )}
        </div>
      )}
      {shown.map((r) => (
        <Shelf key={r.key} row={r} status={status} version={r.key === "requests" ? version : 0} onOpen={(book, replace) => setOpen({ book, replace })} />
      ))}
      {config && shown.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-500">No rows. Use Customize this page to add some.</div>
      )}
      {config && (
        <div className="mt-2">
          {config.show?.genre !== false && (
            <ChipStrip title="Browse by genre" subtitle="The top books in each genre on Hardcover" to="/browse/genre" allLabel="All genres" chips={tagChips("genre", config.genres ?? [])} />
          )}
          {config.show?.mood !== false && (
            <ChipStrip title="Browse by mood" subtitle="The top books readers give each mood on Hardcover" to="/browse/mood" allLabel="All moods" chips={tagChips("mood", config.moods ?? [])} />
          )}
          {config.show?.list !== false && (
            <ChipStrip
              title="Browse lists"
              subtitle="Hardcover's most liked lists"
              to="/browse/lists"
              allLabel="All lists"
              chips={(config.lists ?? []).map((l) => ({ key: `list-${l.id}`, label: l.name, to: listLink(l) }))}
            />
          )}
        </div>
      )}
      {config && (
        <div className="mt-6 flex justify-center border-t border-gray-800 pt-6">
          <button className="btn btn-default" onClick={() => setCustomizing(true)}>
            <AdjustmentsHorizontalIcon className="h-4 w-4" /> Customize this page
          </button>
        </div>
      )}
      {customizing && config && (
        <CustomizeDiscover config={config} admin={isAdmin(status)} onClose={() => setCustomizing(false)} onSaved={reload} />
      )}
      <RequestModal
        admin={isAdmin(status)}
        hardcover={!!status.user?.hasHardcover}
        book={open?.book ?? null}
        enabled={status.requestsEnabled}
        defaultFormat={status.requestFormat}
        onClose={() => setOpen(null)}
        onDone={(o) => {
          afterRequest(open, setOpen, o);
          setVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
