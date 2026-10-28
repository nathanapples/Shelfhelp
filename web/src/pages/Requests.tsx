import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, InboxArrowDownIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api, isAdmin, timeAgo, type BookRequest, type RequestStatus, type SearchHit, type Status } from "../lib/api";
import { useApi, useStoredState } from "../lib/hooks";
import { RequestBadge, RequestModal, formatLabel } from "../components/Request";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle, Spinner } from "../components/ui";
import { useToast } from "../components/toast";
import { withOutcomes } from "./Search";

type Tab = "open" | "available" | "failed" | "all";
const OPEN: RequestStatus[] = ["pending", "requested", "downloading", "downloaded"];
const inTab = (t: Tab, r: BookRequest) =>
  t === "all" || (t === "open" ? OPEN.includes(r.status) : t === "available" ? r.status === "available" : r.status === "failed");

function RequestRow({ r, onChanged, onOpen, showWho }: { r: BookRequest; onChanged: () => void; onOpen: () => void; showWho: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"retry" | "forget" | null>(null);

  const retry = async () => {
    setBusy("retry");
    try {
      const res = await api<{ outcomes: { status: RequestStatus; message: string }[] }>(`/requests/${r.id}/retry`, { method: "POST" });
      const o = res.outcomes[0];
      toast(o?.status === "failed" ? `Still failing: ${o.message}` : `Requested ${r.title} again`, o?.status === "failed" ? "error" : "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    setBusy("forget");
    try {
      await api(`/requests/${r.id}`, { method: "DELETE" });
      toast(`Removed ${r.title} from this list. Chaptarr still has it.`, "info");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex gap-3 rounded-xl bg-gray-800 p-3 ring-1 ring-gray-700 sm:gap-4 sm:p-4">
      <button onClick={onOpen} className="flex-shrink-0 rounded-md transition hover:opacity-80" title="Open book">
        <Cover src={r.coverUrl} alt={r.title} className="h-28 w-[4.75rem] rounded-md ring-1 ring-gray-700" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button onClick={onOpen} className="truncate text-left font-semibold text-white hover:underline" title="Open book">
                {r.title}
              </button>
              {r.hcUrl && (
                <a href={r.hcUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-white" title="Open on Hardcover">
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
              )}
            </div>
            <div className="truncate text-sm text-gray-300">{r.authors.join(", ")}</div>
          </div>
          <div className="flex items-center gap-1">
            {(r.status === "failed" || r.status === "requested" || r.status === "pending") && (
              <button className="btn btn-sm btn-ghost" onClick={retry} disabled={!!busy} title="Send to Chaptarr again">
                {busy === "retry" ? <Spinner className="h-4 w-4" /> : <ArrowPathIcon className="h-4 w-4" />}
                <span className="hidden sm:inline">Retry</span>
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={forget} disabled={!!busy} title="Remove from this list (Chaptarr keeps the book)">
              {busy === "forget" ? <Spinner className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="badge badge-dark">{formatLabel[r.format]}</span>
          {r.edition && (
            <span className="badge badge-dark max-w-full truncate" title={`Edition: ${r.edition}`}>
              {r.edition}
            </span>
          )}
          <RequestBadge status={r.status} progress={r.progress} />
          <span className="text-xs text-gray-500">
            Requested {timeAgo(r.requestedAt)}
            {showWho && r.requestedBy.length > 0 ? ` by ${r.requestedBy.join(", ")}` : ""}
          </span>
        </div>
        {r.status === "downloading" && r.progress != null && (
          <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-gray-700">
            <div className="h-full bg-indigo-500" style={{ width: `${r.progress}%` }} />
          </div>
        )}
        {r.message && <p className={`mt-1.5 text-sm ${r.status === "failed" ? "text-red-300" : "text-gray-400"}`}>{r.message}</p>}
      </div>
    </li>
  );
}

type FormatFilter = "all" | "audiobook" | "ebook";
const TABS = ["failed", "open", "available", "all"] as const;
const FORMATS = ["all", "audiobook", "ebook"] as const;

export default function RequestsPage({ status }: { status: Status }) {
  const { data, error, loading, reload } = useApi<{ requests: BookRequest[]; counts: Partial<Record<RequestStatus, number>>; all?: boolean }>("/requests", {
    poll: 15000,
  });
  const [filter, setFilter] = useStoredState<Tab>("requests.status", "failed", TABS);
  const [format, setFormat] = useStoredState<FormatFilter>("requests.format", "all", FORMATS);

  const all = (data?.requests ?? []).filter((r) => format === "all" || r.format === format);
  const count = (t: Tab) => all.filter((r) => inTab(t, r)).length;
  const rows = all.filter((r) => inTab(filter, r));
  const label: Record<Tab, string> = { failed: "Failed", open: "In progress", available: "Available", all: "All requests" };
  const toast = useToast();
  const [open, setOpen] = useState<SearchHit | null>(null);

  // Opens the same book popup as Discover: shows what we have right away, then fills in from Hardcover.
  const openBook = async (r: BookRequest) => {
    const basic: SearchHit = {
      id: r.hcBookId,
      slug: r.slug,
      title: r.title,
      subtitle: null,
      authors: r.authors,
      coverUrl: r.coverUrl,
      releaseYear: r.releaseYear,
      seriesName: null,
      seriesPosition: null,
      hasAudiobook: null,
      absItemId: r.absItemId,
      requests: Object.fromEntries((data?.requests ?? []).filter((x) => x.hcBookId === r.hcBookId).map((x) => [x.format, { id: x.id, status: x.status }])),
    };
    setOpen(basic);
    try {
      const full = await api<SearchHit>(`/hardcover/book?ref=${encodeURIComponent(`hc:${r.hcBookId}`)}`);
      setOpen((cur) => (cur && cur.id === r.hcBookId ? { ...full, seriesPosition: typeof full.seriesPosition === "number" ? full.seriesPosition : null } : cur));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageTitle
        extra={
          <>
            <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Tab)} aria-label="Show">
              {TABS.map((t) => (
                <option key={t} value={t}>
                  {label[t]} ({count(t)})
                </option>
              ))}
            </select>
            <select className="input w-auto" value={format} onChange={(e) => setFormat(e.target.value as FormatFilter)} aria-label="Format">
              <option value="all">Any format</option>
              <option value="audiobook">Audiobooks</option>
              <option value="ebook">Ebooks</option>
            </select>
          </>
        }
      >
        Requests
      </PageTitle>

      {!status.requestsEnabled && (
        <div className="mb-6 rounded-lg bg-yellow-900/20 p-4 text-sm text-yellow-200 ring-1 ring-yellow-800">
          Requests are off.{" "}
          <Link to="/settings?tab=chaptarr" className="font-semibold underline">
            Connect Chaptarr and turn them on in Settings
          </Link>
          .
        </div>
      )}

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && rows.length === 0 && (
        <Empty icon={<InboxArrowDownIcon className="h-16 w-16" />} title={data.requests.length ? `Nothing ${filter === "all" ? "here" : label[filter].toLowerCase()}` : "No requests yet"}>
          {data.requests.length ? "Pick another view above." : "Search for a book or paste a Hardcover link in the search bar to request it."}
        </Empty>
      )}
      <ul className="max-w-4xl space-y-3">
        {rows.map((r) => (
          <RequestRow key={r.id} r={r} onChanged={reload} onOpen={() => openBook(r)} showWho={!!data?.all} />
        ))}
      </ul>
      <RequestModal
        admin={isAdmin(status)}
        book={open}
        enabled={status.requestsEnabled}
        defaultFormat={status.requestFormat}
        onClose={() => setOpen(null)}
        onDone={(o) => {
          const id = o[0]?.request.hcBookId;
          setOpen((b) => (b && b.id === id ? withOutcomes(b, o) : b));
          reload();
        }}
      />
    </div>
  );
}
