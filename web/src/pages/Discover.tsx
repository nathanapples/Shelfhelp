import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdjustmentsHorizontalIcon, ChevronLeftIcon, ChevronRightIcon, TagIcon } from "@heroicons/react/24/outline";
import { isAdmin, type DiscoverBook, type DiscoverConfig, type DiscoverRowInfo, type RequestOutcome, type SearchHit, type Status } from "../lib/api";
import { CustomizeDiscover } from "../components/CustomizeDiscover";
import { useApi } from "../lib/hooks";
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

/** Genre chips that open the genre's page. */
export function GenreStrip({ genres }: { genres: DiscoverRowInfo[] }) {
  if (!genres.length) return <div className="flex-1" />;
  return (
    <div className="hide-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1">
      <span className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
        <TagIcon className="h-4 w-4" /> Genres
      </span>
      {genres.map((g) => (
        <Link
          key={g.key}
          to={`/discover/${g.key}`}
          className="flex-shrink-0 whitespace-nowrap rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 transition hover:bg-gray-700 hover:text-white"
        >
          {g.title.replace(/^Top /, "")}
        </Link>
      ))}
    </div>
  );
}

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
  const { data, error, loading, setData } = useApi<DiscoverBook[]>(`/discover/${row.key}?v=${version}`);
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });
  if (!loading && !error && data?.length === 0) return null;
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
          <Link to={row.key === "requests" ? "/requests" : `/discover/${row.key}`} className="mr-1 whitespace-nowrap text-sm font-medium text-indigo-400 hover:text-indigo-300">
            See all
          </Link>
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
      <div className="mb-4 flex items-center gap-2">
        <GenreStrip genres={config?.genres ?? []} />
        <button className="btn btn-sm btn-ghost flex-shrink-0" onClick={() => setCustomizing(true)} disabled={!config} title="Customize Discover">
          <AdjustmentsHorizontalIcon className="h-4 w-4" /> <span className="hidden sm:inline">Customize</span>
        </button>
      </div>
      {shown.map((r) => (
        <Shelf key={r.key} row={r} status={status} version={r.key === "requests" ? version : 0} onOpen={(book, replace) => setOpen({ book, replace })} />
      ))}
      {config && shown.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-500">No rows. Use Customize to add some.</div>
      )}
      {customizing && config && (
        <CustomizeDiscover config={config} admin={isAdmin(status)} onClose={() => setCustomizing(false)} onSaved={reload} />
      )}
      <RequestModal
        admin={isAdmin(status)}
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
