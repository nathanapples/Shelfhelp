import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, InboxArrowDownIcon, LinkIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, type BookRequest, type RequestStatus, type Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { RequestBadge, RequestControls, formatLabel, type RequestableBook } from "../components/Request";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle, Spinner, Tabs } from "../components/ui";
import { useToast } from "../components/toast";

type Tab = "open" | "available" | "failed" | "all";
const OPEN: RequestStatus[] = ["pending", "requested", "downloading", "downloaded"];
const inTab = (t: Tab, r: BookRequest) =>
  t === "all" || (t === "open" ? OPEN.includes(r.status) : t === "available" ? r.status === "available" : r.status === "failed");

function AddByLink({ status, onRequested }: { status: Status; onRequested: () => void }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState<RequestableBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ref.trim()) return;
    setBusy(true);
    setError(null);
    setBook(null);
    try {
      setBook(await api<RequestableBook>(`/hardcover/book?ref=${encodeURIComponent(ref.trim())}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 rounded-xl bg-gray-800 p-4 ring-1 ring-gray-700 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white">
        <LinkIcon className="h-5 w-5 text-indigo-400" /> Request from a Hardcover link
      </h2>
      <p className="mt-1 text-sm text-gray-400">Paste a hardcover.app book link or a Hardcover book id. You can also search for a book in the bar above.</p>
      <form onSubmit={find} className="mt-3 flex gap-2">
        <input
          className="input"
          placeholder="https://hardcover.app/books/project-hail-mary"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button className="btn btn-default flex-shrink-0" disabled={busy || !ref.trim()}>
          {busy && <Spinner className="h-4 w-4" />} Find
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {book && (
        <div className="mt-4 flex gap-4 rounded-lg bg-gray-900/50 p-3 ring-1 ring-gray-700">
          <Cover src={book.coverUrl} alt={book.title} className="h-32 w-[5.5rem] flex-shrink-0 rounded-md ring-1 ring-gray-700" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-white">{book.title}</div>
            <div className="text-sm text-gray-300">{book.authors.join(", ")}</div>
            <div className="mt-0.5 text-xs text-gray-500">
              {[book.releaseYear, book.seriesName && `${book.seriesName}${book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}`, `hc:${book.id}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="mt-3">
              <RequestControls book={book} enabled={status.requestsEnabled} defaultFormat={status.requestFormat} onDone={onRequested} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({ r, onChanged }: { r: BookRequest; onChanged: () => void }) {
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
      <Cover src={r.coverUrl} alt={r.title} className="h-28 w-[4.75rem] flex-shrink-0 rounded-md ring-1 ring-gray-700" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-white">{r.title}</span>
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
          <RequestBadge status={r.status} progress={r.progress} />
          <span className="text-xs text-gray-500">Requested {timeAgo(r.requestedAt)}</span>
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

export default function RequestsPage({ status }: { status: Status }) {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<{ requests: BookRequest[]; counts: Partial<Record<RequestStatus, number>> }>("/requests", {
    poll: 15000,
  });
  const [tab, setTab] = useState<Tab>("open");
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setData(await api("/requests/refresh", { method: "POST" }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setChecking(false);
    }
  };

  const all = data?.requests ?? [];
  const count = (t: Tab) => all.filter((r) => inTab(t, r)).length;
  const rows = all.filter((r) => inTab(tab, r));

  return (
    <div>
      <PageTitle
        extra={
          status.configured.chaptarr && (
            <button className="btn btn-default" onClick={check} disabled={checking}>
              <ArrowPathIcon className={`h-5 w-5 ${checking ? "animate-spin" : ""}`} /> {checking ? "Checking..." : "Check Chaptarr"}
            </button>
          )
        }
      >
        Requests
      </PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-gray-400">
        Books you've asked Chaptarr for. Shelfhelp checks on them every few minutes and marks audiobooks Available once they show up in Audiobookshelf.
      </p>

      {!status.requestsEnabled && (
        <div className="mb-6 rounded-lg bg-yellow-900/20 p-4 text-sm text-yellow-200 ring-1 ring-yellow-800">
          Requests are off.{" "}
          <Link to="/settings?tab=chaptarr" className="font-semibold underline">
            Connect Chaptarr and turn them on in Settings
          </Link>
          .
        </div>
      )}

      <AddByLink status={status} onRequested={reload} />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "open", label: "In Progress", count: count("open") },
          { id: "available", label: "Available", count: count("available") },
          { id: "failed", label: "Failed", count: count("failed") },
          { id: "all", label: "All", count: all.length },
        ]}
      />
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && rows.length === 0 && (
        <Empty icon={<InboxArrowDownIcon className="h-16 w-16" />} title={all.length ? "Nothing here" : "No requests yet"}>
          {all.length ? "No requests in this group." : "Search for a book or paste a Hardcover link to request it."}
        </Empty>
      )}
      <ul className="max-w-4xl space-y-3">
        {rows.map((r) => (
          <RequestRow key={r.id} r={r} onChanged={reload} />
        ))}
      </ul>
    </div>
  );
}
