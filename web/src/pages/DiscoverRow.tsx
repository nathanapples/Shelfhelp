import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import { isAdmin, type DiscoverBook, type DiscoverRowInfo, type SearchHit, type Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { BookTile } from "../components/BookTile";
import { RequestModal } from "../components/Request";
import { Empty, ErrorBlock, LoadingBlock, PageTitle } from "../components/ui";
import { afterRequest } from "./Discover";

/** A Discover row on its own page, with more of its books. */
export default function DiscoverRowPage({ status }: { status: Status }) {
  const { key = "" } = useParams();
  const { data, error, loading, setData } = useApi<{ info: DiscoverRowInfo; books: DiscoverBook[] }>(`/discover/${encodeURIComponent(key)}?full=1`);
  const [open, setOpen] = useState<{ book: SearchHit; replace: (b: SearchHit) => void } | null>(null);
  const info = data?.info;
  const replace = (b: SearchHit) => setData((d) => (d ? { ...d, books: d.books.map((x) => (x.id === b.id ? { ...x, ...b } : x)) } : d));
  const hcList = info?.kind === "list" && info.owner && info.slug ? `https://hardcover.app/@${info.owner}/lists/${info.slug}` : null;

  return (
    <div>
      <PageTitle>
        <Link to="/" className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white">
          <ChevronLeftIcon className="h-4 w-4" /> Discover
        </Link>
        {info?.title ?? (loading ? "Loading..." : "Discover")}
      </PageTitle>
      {info && (
        <p className="-mt-3 mb-5 text-sm text-gray-400">
          {info.subtitle}
          {hcList && (
            <>
              {" "}
              <a href={hcList} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                Open on Hardcover
              </a>
            </>
          )}
        </p>
      )}
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && data.books.length === 0 && (
        <Empty title="Nothing here yet">
          {key === "foryou" ? "Open your vibes on hardcover.app once so Hardcover makes your recommendations." : "Hardcover didn't return any books for this."}
        </Empty>
      )}
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] sm:gap-4">
        {data?.books.map((b, i) => (
          <li key={`${b.id}-${b.absItemId ?? i}`}>
            {key === "added" && !b.id ? (
              <BookCard book={{ ...b, status: "matched" }} pill="Added" fit="contain" size="sm" width="w-full" />
            ) : (
              <BookTile
                book={b}
                status={status}
                size="sm"
                width="w-full"
                pill={key === "added" ? "Added" : undefined}
                fit={key === "added" ? "contain" : undefined}
                onOpen={() => setOpen({ book: b, replace })}
              />
            )}
          </li>
        ))}
      </ul>
      <RequestModal
        admin={isAdmin(status)}
        book={open?.book ?? null}
        enabled={status.requestsEnabled}
        defaultFormat={status.requestFormat}
        onClose={() => setOpen(null)}
        onDone={(o) => afterRequest(open, setOpen, o)}
      />
    </div>
  );
}
