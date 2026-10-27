import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import type { DiscoverBook, DiscoverRowInfo, SearchHit, Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { BookTile } from "../components/BookTile";
import { RequestModal } from "../components/Request";
import { Spinner } from "../components/ui";
import { withOutcomes } from "./Search";

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
  const { data, error, loading, setData } = useApi<DiscoverBook[]>(`/discover/${row.id}?v=${version}`);
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });
  if (!loading && !error && data?.length === 0) return null;
  const replace = (b: SearchHit) => setData((d) => d?.map((x) => (x.id === b.id && x.absItemId === b.absItemId ? { ...x, ...b } : x)) ?? d);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold text-white sm:text-2xl">
            {row.id === "requests" ? (
              <Link to="/requests" className="hover:text-indigo-300">
                {row.title} ›
              </Link>
            ) : (
              row.title
            )}
          </h2>
          <p className="truncate text-sm text-gray-400">{row.subtitle}</p>
        </div>
        <div className="hidden flex-shrink-0 gap-1 sm:flex">
          <button className="rounded-full p-1.5 text-gray-400 ring-1 ring-gray-700 hover:bg-gray-700 hover:text-white" onClick={() => scroll(-1)} aria-label="Scroll left">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button className="rounded-full p-1.5 text-gray-400 ring-1 ring-gray-700 hover:bg-gray-700 hover:text-white" onClick={() => scroll(1)} aria-label="Scroll right">
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      {loading && (
        <div className="flex h-56 items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && <p className="rounded-lg bg-red-900/20 p-3 text-sm text-red-300 ring-1 ring-red-900">{error}</p>}
      <div ref={scroller} className="hide-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 pt-2 sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8">
        {data?.map((b, i) => (
          <div key={`${b.id}-${b.absItemId ?? i}`} className="snap-start">
            {row.id === "added" && !b.id ? (
              <BookCard book={{ ...b, status: "matched" }} pill="Added" fit="contain" note={b.addedAt ? `Added ${new Date(b.addedAt).toLocaleDateString()}` : null} />
            ) : (
              <BookTile book={b} status={status} onOpen={() => onOpen(b, replace)} pill={row.id === "added" ? "Added" : undefined} fit={row.id === "added" ? "contain" : undefined} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DiscoverPage({ status }: { status: Status }) {
  const { data: rows } = useApi<DiscoverRowInfo[]>("/discover");
  const [open, setOpen] = useState<{ book: SearchHit; replace: (b: SearchHit) => void } | null>(null);
  const [version, setVersion] = useState(0);
  const shown = (rows ?? []).filter((r) => r.id !== "requests" || status.configured.chaptarr);

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
      {shown.map((r) => (
        <Shelf key={r.id} row={r} status={status} version={r.id === "requests" ? version : 0} onOpen={(book, replace) => setOpen({ book, replace })} />
      ))}
      <RequestModal
        book={open?.book ?? null}
        enabled={status.requestsEnabled}
        defaultFormat={status.requestFormat}
        onClose={() => setOpen(null)}
        onDone={(o) => {
          if (!open) return;
          const next = withOutcomes(open.book, o);
          open.replace(next);
          setOpen({ ...open, book: next });
          setVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
