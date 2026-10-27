import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { RequestOutcome, SearchHit, Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { RequestModal, requestMeta, topRequest } from "../components/Request";
import { Empty, ErrorBlock, LoadingBlock, PageTitle } from "../components/ui";

export default function SearchPage({ status }: { status: Status }) {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, error, loading, setData } = useApi<SearchHit[]>(q ? `/hardcover/search?q=${encodeURIComponent(q)}` : null);
  const [open, setOpen] = useState<SearchHit | null>(null);

  const requested = (hit: SearchHit, outcomes: RequestOutcome[]) => {
    const requests = { ...(hit.requests ?? {}) };
    for (const o of outcomes) requests[o.format] = { id: o.request.id, status: o.status };
    const next = { ...hit, requests };
    setData((d) => d?.map((h) => (h.id === hit.id ? next : h)) ?? d);
    setOpen(next);
  };

  return (
    <div>
      <PageTitle>Search Results</PageTitle>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.length === 0 && (
        <Empty icon={<MagnifyingGlassIcon className="h-16 w-16" />} title="No results">
          Nothing on Hardcover matches "{q}".
        </Empty>
      )}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        {data?.map((b) => {
          const req = topRequest(b.requests);
          const meta = req ? requestMeta[req] : null;
          return (
            <li key={b.id}>
              <BookCard
                width="w-full"
                book={{ ...b, status: b.absItemId ? "matched" : null }}
                actionLabel={status.requestsEnabled ? (req && req !== "failed" ? "Details" : "Request") : "Details"}
                note={meta ? meta.label : null}
                corner={
                  meta && !b.absItemId ? (
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full shadow ring-1 ${req === "failed" ? "bg-red-600 ring-red-400" : req === "pending" ? "bg-yellow-500 ring-yellow-300" : "bg-indigo-500 ring-indigo-300"} text-white`} title={meta.label}>
                      <meta.icon className="h-3.5 w-3.5" />
                    </span>
                  ) : undefined
                }
                onClick={() => setOpen(b)}
              />
            </li>
          );
        })}
      </ul>
      <RequestModal
        book={open}
        enabled={status.requestsEnabled}
        defaultFormat={status.requestFormat}
        onClose={() => setOpen(null)}
        onDone={(o) => open && requested(open, o)}
      />
    </div>
  );
}
