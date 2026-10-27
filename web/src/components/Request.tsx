import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";
import { api, type Format, type RequestFormat, type RequestMap, type RequestOutcome, type RequestStatus } from "../lib/api";
import { Cover, Modal, Spinner } from "./ui";
import { useToast } from "./toast";

export const requestMeta: Record<RequestStatus, { label: string; badge: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: "Waiting on author", badge: "badge-warning", icon: ClockIcon },
  requested: { label: "Requested", badge: "badge-default", icon: MagnifyingGlassIcon },
  downloading: { label: "Downloading", badge: "badge-default", icon: ArrowDownTrayIcon },
  downloaded: { label: "Downloaded", badge: "badge-success", icon: CheckCircleIcon },
  available: { label: "Available", badge: "badge-success", icon: CheckCircleIcon },
  failed: { label: "Failed", badge: "badge-danger", icon: ExclamationTriangleIcon },
};

export const formatLabel: Record<Format, string> = { audiobook: "Audiobook", ebook: "Ebook" };

export function RequestBadge({ format, status, progress }: { format?: Format; status: RequestStatus; progress?: number | null }) {
  const m = requestMeta[status];
  const Icon = m.icon;
  return (
    <span className={`badge ${m.badge} inline-flex items-center gap-1`}>
      <Icon className="h-3.5 w-3.5" />
      {format && <span>{formatLabel[format]}:</span>}
      {m.label}
      {status === "downloading" && progress != null ? ` ${progress}%` : ""}
    </span>
  );
}

/** The one status to show on a poster: the most interesting of the formats. */
export function topRequest(map: RequestMap | undefined): RequestStatus | null {
  if (!map) return null;
  const order: RequestStatus[] = ["available", "downloaded", "downloading", "requested", "pending", "failed"];
  const have = Object.values(map).map((r) => r!.status);
  return order.find((s) => have.includes(s)) ?? null;
}

export interface RequestableBook {
  id: number;
  slug: string | null;
  title: string;
  subtitle?: string | null;
  authors: string[];
  coverUrl: string | null;
  releaseYear?: number | null;
  seriesName?: string | null;
  seriesPosition?: number | string | null;
  hasAudiobook?: boolean | null;
  absItemId?: string | null;
  mine?: { statusName: string; progress: number | null } | null;
  requests?: RequestMap;
}

/** Format choice, current request status and the Request button. */
export function RequestControls({
  book,
  enabled,
  defaultFormat,
  onDone,
}: {
  book: RequestableBook;
  enabled: boolean;
  defaultFormat: RequestFormat;
  onDone?: (outcomes: RequestOutcome[]) => void;
}) {
  const toast = useToast();
  const [format, setFormat] = useState<RequestFormat>(defaultFormat);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<RequestOutcome[] | null>(null);
  const existing = book.requests ?? {};
  const wanted: Format[] = format === "both" ? ["audiobook", "ebook"] : [format];
  const already = wanted.filter((f) => existing[f] && existing[f]!.status !== "failed");

  if (!enabled) {
    return (
      <div className="rounded-lg bg-gray-900/50 p-3 text-sm text-gray-400 ring-1 ring-gray-700">
        Requests are off.{" "}
        <Link to="/settings?tab=chaptarr" className="text-indigo-400 hover:underline">
          Set up Chaptarr in Settings
        </Link>{" "}
        to request books.
      </div>
    );
  }

  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ outcomes: RequestOutcome[] }>("/requests", { method: "POST", body: { hcBookId: book.id, format } });
      setOutcomes(r.outcomes);
      const failed = r.outcomes.filter((o) => o.status === "failed");
      if (failed.length) toast(`Request failed: ${failed[0].message}`, "error");
      else toast(`Requested ${book.title}`);
      onDone?.(r.outcomes);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const shown = outcomes ? Object.fromEntries(outcomes.map((o) => [o.format, { status: o.status, message: o.message, progress: o.request.progress }])) : null;

  return (
    <div className="space-y-3">
      {Object.keys(existing).length > 0 && !shown && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(existing) as [Format, { status: RequestStatus }][]).map(([f, r]) => (
            <RequestBadge key={f} format={f} status={r.status} />
          ))}
        </div>
      )}
      {shown && (
        <ul className="space-y-1.5">
          {(Object.entries(shown) as [Format, { status: RequestStatus; message: string; progress: number | null }][]).map(([f, o]) => (
            <li key={f} className="flex flex-wrap items-center gap-2 text-sm">
              <RequestBadge format={f} status={o.status} progress={o.progress} />
              <span className={o.status === "failed" ? "text-red-300" : "text-gray-300"}>{o.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md ring-1 ring-gray-600" role="radiogroup" aria-label="Format">
          {(
            [
              ["audiobook", "Audiobook", SpeakerWaveIcon],
              ["ebook", "Ebook", BookOpenIcon],
              ["both", "Both", null],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={format === id}
              onClick={() => setFormat(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition ${
                format === id ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {Icon && <Icon className="h-4 w-4" />}
              {label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={send} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4 text-white" /> : <ArrowDownTrayIcon className="h-4 w-4" />}
          {busy ? "Requesting..." : already.length ? "Request again" : "Request"}
        </button>
      </div>
      {book.absItemId && wanted.includes("audiobook") && (
        <p className="text-xs text-yellow-300">This audiobook already looks like it's in Audiobookshelf.</p>
      )}
      {book.hasAudiobook === false && wanted.includes("audiobook") && (
        <p className="text-xs text-gray-400">Hardcover doesn't list an audiobook edition, so Chaptarr may not find one.</p>
      )}
    </div>
  );
}

/** Book details with the request controls, opened from search results. */
export function RequestModal({
  book,
  enabled,
  defaultFormat,
  onClose,
  onDone,
}: {
  book: RequestableBook | null;
  enabled: boolean;
  defaultFormat: RequestFormat;
  onClose: () => void;
  onDone?: (outcomes: RequestOutcome[]) => void;
}) {
  if (!book) return null;
  const hcUrl = book.slug ? `https://hardcover.app/books/${book.slug}` : null;
  return (
    <Modal open onClose={onClose} backdrop={book.coverUrl} size="max-w-2xl">
      <div className="flex flex-col gap-5 pt-6 sm:flex-row">
        <Cover src={book.coverUrl} alt={book.title} className="mx-auto h-60 w-40 flex-shrink-0 rounded-lg shadow-lg ring-1 ring-gray-700 sm:mx-0" />
        <div className="min-w-0 flex-1">
          {book.releaseYear && <div className="text-sm text-gray-400">{book.releaseYear}</div>}
          <h2 className="text-2xl font-bold leading-tight text-white">{book.title}</h2>
          {book.subtitle && <div className="mt-0.5 text-gray-300">{book.subtitle}</div>}
          <div className="mt-1 text-gray-300">{book.authors.join(", ")}</div>
          {book.seriesName && (
            <div className="mt-1 text-sm text-gray-400">
              {book.seriesName}
              {book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {book.absItemId && <span className="badge badge-success">In Audiobookshelf</span>}
            {book.mine && <span className="badge badge-dark">Hardcover: {book.mine.statusName}</span>}
            {hcUrl && (
              <a href={hcUrl} target="_blank" rel="noreferrer" className="badge badge-dark inline-flex items-center gap-1 hover:text-white">
                Hardcover <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <div className="mt-5">
            <RequestControls book={book} enabled={enabled} defaultFormat={defaultFormat} onDone={onDone} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
