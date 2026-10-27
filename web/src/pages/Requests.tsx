import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, InboxArrowDownIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, type BookRequest, type RequestStatus, type Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { RequestBadge, formatLabel } from "../components/Request";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle, Spinner } from "../components/ui";
import { useToast } from "../components/toast";

type Tab = "open" | "available" | "failed" | "all";
const OPEN: RequestStatus[] = ["pending", "requested", "downloading", "downloaded"];
const inTab = (t: Tab, r: BookRequest) =>
  t === "all" || (t === "open" ? OPEN.includes(r.status) : t === "available" ? r.status === "available" : r.status === "failed");

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

type FormatFilter = "all" | "audiobook" | "ebook";

function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 transition ${
        active ? "bg-indigo-600 text-white ring-indigo-500" : "bg-gray-800 text-gray-300 ring-gray-600 hover:bg-gray-700"
      }`}
    >
      {children}
      {count !== undefined && <span className={`rounded-full px-1.5 text-xs ${active ? "bg-indigo-400/40" : "bg-gray-700"}`}>{count}</span>}
    </button>
  );
}

export default function RequestsPage({ status }: { status: Status }) {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<{ requests: BookRequest[]; counts: Partial<Record<RequestStatus, number>> }>("/requests", {
    poll: 15000,
  });
  const [filter, setFilter] = useState<Tab>("all");
  const [format, setFormat] = useState<FormatFilter>("all");
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

  const all = (data?.requests ?? []).filter((r) => format === "all" || r.format === format);
  const count = (t: Tab) => all.filter((r) => inTab(t, r)).length;
  const rows = all.filter((r) => inTab(filter, r));

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
      <p className="-mt-3 mb-5 max-w-3xl text-sm text-gray-400">
        Books you've asked Chaptarr for. To request one, search for it or paste a Hardcover link into the search bar. Audiobooks become Available once
        they show up in Audiobookshelf.
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

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All"],
            ["open", "In progress"],
            ["available", "Available"],
            ["failed", "Failed"],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} active={filter === id} onClick={() => setFilter(id)} count={count(id)}>
            {label}
          </Chip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-gray-600 sm:block" />
        {(
          [
            ["all", "Any format"],
            ["audiobook", "Audiobooks"],
            ["ebook", "Ebooks"],
          ] as const
        ).map(([id, label]) => (
          <Chip key={id} active={format === id} onClick={() => setFormat(id)}>
            {label}
          </Chip>
        ))}
      </div>

      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && rows.length === 0 && (
        <Empty icon={<InboxArrowDownIcon className="h-16 w-16" />} title={data.requests.length ? "Nothing matches" : "No requests yet"}>
          {data.requests.length ? "Try another filter." : "Search for a book or paste a Hardcover link in the search bar to request it."}
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
