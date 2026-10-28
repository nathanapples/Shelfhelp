import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { isAdmin, type RequestOutcome, type SearchHit, type Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookTile } from "../components/BookTile";
import { RequestModal } from "../components/Request";
import { Empty, ErrorBlock, LoadingBlock, PageTitle } from "../components/ui";

export function withOutcomes(hit: SearchHit, outcomes: RequestOutcome[]): SearchHit {
  const requests = { ...(hit.requests ?? {}) };
  for (const o of outcomes) requests[o.format] = { id: o.request.id, status: o.status };
  return { ...hit, requests };
}

export default function SearchPage({ status }: { status: Status }) {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, error, loading, setData } = useApi<SearchHit[]>(q ? `/hardcover/search?q=${encodeURIComponent(q)}` : null);
  const [open, setOpen] = useState<SearchHit | null>(null);
  const isLink = /hardcover\.app\/books\/|^hc:\d+$/i.test(q.trim());

  return (
    <div>
      <PageTitle>{isLink ? "Hardcover Book" : "Search Results"}</PageTitle>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.length === 0 && (
        <Empty icon={<MagnifyingGlassIcon className="h-16 w-16" />} title="No results">
          {isLink ? "Hardcover has no book at that link." : `Nothing on Hardcover matches "${q}".`}
        </Empty>
      )}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        {data?.map((b) => (
          <li key={b.id}>
            <BookTile width="w-full" book={b} status={status} onOpen={() => setOpen(b)} />
          </li>
        ))}
      </ul>
      <RequestModal
        admin={isAdmin(status)}
        book={open}
        enabled={status.requestsEnabled}
        defaultFormat={status.requestFormat}
        onClose={() => setOpen(null)}
        onDone={(o) => {
          if (!open) return;
          const next = withOutcomes(open, o);
          setData((d) => d?.map((h) => (h.id === next.id ? next : h)) ?? d);
          // Only refresh the popup if it's still open on this book.
          setOpen((cur) => (cur && cur.id === next.id ? next : cur));
        }}
      />
    </div>
  );
}
