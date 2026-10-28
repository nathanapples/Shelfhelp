import { useEffect, useState } from "react";
import { StarIcon } from "@heroicons/react/20/solid";
import { Link } from "react-router-dom";
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";
import { IssueThread, ReportIssue } from "./Issues";
import { WantIcon, useWantToRead } from "./WantToRead";
import { api, duration, type HcEdition, type Issue, type Similar, type Format, type RequestFormat, type RequestMap, type RequestOutcome, type RequestStatus } from "../lib/api";
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
  rating?: number | null;
  ratingsCount?: number | null;
}

/** Advanced: pick the exact edition (narrator, publisher...) to request for one format. */
function EditionPicker({
  format,
  editions,
  value,
  onChange,
}: {
  format: Format;
  editions: HcEdition[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [all, setAll] = useState(false);
  const list = editions.filter((e) => e.format === format);
  const shown = all ? list : list.slice(0, 6);
  if (!list.length) return <p className="text-xs text-gray-500">Hardcover doesn't list any {format === "audiobook" ? "audiobook" : "ebook"} editions.</p>;
  const row = (id: number | null, title: string, detail: string | null, cover: string | null) => (
    <label
      key={id ?? "any"}
      className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 ring-1 transition ${
        value === id ? "bg-indigo-900/30 ring-indigo-500" : "bg-gray-900/40 ring-gray-700 hover:bg-gray-700/40"
      }`}
    >
      <input type="radio" className="sr-only" checked={value === id} onChange={() => onChange(id)} />
      {id === null ? (
        <span className="flex h-12 w-9 flex-shrink-0 items-center justify-center rounded bg-gray-700 text-[10px] font-semibold uppercase text-gray-300">Any</span>
      ) : (
        <Cover src={cover} alt="" className="h-12 w-9 flex-shrink-0 rounded" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{title}</span>
        {detail && <span className="block truncate text-xs text-gray-400">{detail}</span>}
      </span>
      <span className={`h-4 w-4 flex-shrink-0 rounded-full ring-2 ${value === id ? "bg-indigo-500 ring-indigo-300" : "ring-gray-500"}`} />
    </label>
  );
  return (
    <div className="space-y-1.5">
      {row(null, "Any edition", "Chaptarr picks", null)}
      {shown.map((e) => {
        const main =
          format === "audiobook"
            ? e.narrators.length
              ? `Narrated by ${e.narrators.join(", ")}`
              : (e.publisher ?? e.title ?? "Unknown narrator")
            : (e.publisher ?? e.editionFormat ?? e.title ?? "Ebook");
        const detail = [
          format === "audiobook" && e.narrators.length ? e.publisher : null,
          format === "ebook" && e.publisher ? e.editionFormat : null,
          e.releaseDate?.slice(0, 4),
          format === "audiobook" ? duration(e.audioSeconds) : e.pages ? `${e.pages} pages` : null,
          e.language && !/^english$/i.test(e.language) ? e.language : null,
          e.asin ? `ASIN ${e.asin}` : e.isbn13 ? `ISBN ${e.isbn13}` : null,
          e.readers ? `${e.readers.toLocaleString()} readers` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return row(e.id, main, detail || null, e.coverUrl);
      })}
      {list.length > shown.length && (
        <button type="button" className="text-xs font-medium text-indigo-400 hover:underline" onClick={() => setAll(true)}>
          Show all {list.length} editions
        </button>
      )}
    </div>
  );
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
  const [advanced, setAdvanced] = useState(false);
  const [editions, setEditions] = useState<HcEdition[] | null>(null);
  const [editionError, setEditionError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Partial<Record<Format, number | null>>>({});
  useEffect(() => {
    setAdvanced(false);
    setEditions(null);
    setEditionError(null);
    setPicked({});
  }, [book.id]);
  useEffect(() => {
    if (!advanced || editions) return;
    let alive = true;
    api<HcEdition[]>(`/hardcover/editions?book=${book.id}`)
      .then((e) => alive && setEditions(e))
      .catch((e) => alive && setEditionError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [advanced, editions, book.id]);
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
      const chosen = advanced ? Object.fromEntries(wanted.map((f) => [f, picked[f] ?? null])) : {};
      const r = await api<{ outcomes: RequestOutcome[] }>("/requests", { method: "POST", body: { hcBookId: book.id, format, editions: chosen } });
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
      <div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
        >
          <ChevronDownIcon className={`h-3.5 w-3.5 transition ${advanced ? "rotate-180" : ""}`} />
          Advanced: pick a specific edition
        </button>
        {advanced && (
          <div className="mt-2 space-y-3 rounded-lg bg-gray-900/40 p-3 ring-1 ring-gray-700">
            {editionError ? (
              <p className="text-sm text-red-300">{editionError}</p>
            ) : !editions ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Spinner className="h-4 w-4" /> Loading editions from Hardcover...
              </div>
            ) : (
              wanted.map((f) => (
                <div key={f}>
                  <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{formatLabel[f]} edition</h5>
                  <EditionPicker format={f} editions={editions} value={picked[f] ?? null} onChange={(id) => setPicked((p) => ({ ...p, [f]: id }))} />
                </div>
              ))
            )}
            <p className="text-xs text-gray-500">Chaptarr is asked for this edition. If it doesn't list it, it picks its own.</p>
          </div>
        )}
      </div>
      {book.absItemId && wanted.includes("audiobook") && (
        <p className="text-xs text-yellow-300">This audiobook is already in Audiobookshelf. See below.</p>
      )}
      {book.hasAudiobook === false && wanted.includes("audiobook") && (
        <p className="text-xs text-gray-400">Hardcover doesn't list an audiobook edition, so Chaptarr may not find one.</p>
      )}
    </div>
  );
}

/** What Audiobookshelf already has that matches or looks like this book. */
export function InLibrary({
  book,
  admin,
  onLinked,
  onOwned,
}: {
  book: RequestableBook;
  admin: boolean;
  onLinked?: () => void;
  /** Called with whether Audiobookshelf has this book, each time it's checked. */
  onOwned?: (owned: boolean) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Similar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    const q = new URLSearchParams({ hcBookId: String(book.id), title: book.title, authors: book.authors.join("|") });
    api<Similar>(`/library/similar?${q}`)
      .then((d) => {
        setData(d);
        onOwned?.(d.confirmed.length > 0);
      })
      .catch((e) => setError((e as Error).message));
  };
  useEffect(load, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const same = async (absItemId: string) => {
    setBusy(absItemId);
    try {
      await api("/library/decisions", {
        method: "POST",
        body: {
          absItemId,
          action: "match",
          hcBookId: book.id,
          hcBook: {
            id: book.id,
            slug: book.slug,
            title: book.title,
            authors: book.authors,
            coverUrl: book.coverUrl,
            seriesName: book.seriesName ?? null,
            seriesPosition: typeof book.seriesPosition === "number" ? book.seriesPosition : null,
            releaseYear: book.releaseYear ?? null,
          },
        },
      });
      toast(
        <span>
          Linked as the same book.{" "}
          <button className="font-semibold text-indigo-300 underline" onClick={() => unlink(absItemId, true)}>
            Undo
          </button>
        </span>,
      );
      load();
      onLinked?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  /** "Not the same book". With undo, it's the undo of a "Same book". */
  const unlink = async (absItemId: string, undoing = false) => {
    setBusy(absItemId);
    try {
      await api("/library/unlink", { method: "POST", body: { absItemId, hcBookId: book.id } });
      if (undoing) toast("Undone. They're no longer linked.", "info");
      else
        toast(
          <span>
            Unlinked. Shelfhelp won't treat these as the same book again.{" "}
            <button
              className="font-semibold text-indigo-300 underline"
              onClick={async () => {
                await api("/library/relink", { method: "POST", body: { absItemId, hcBookId: book.id } }).catch(() => {});
                toast("Undone. Shelfhelp may link them again on its next check.", "info");
                load();
              }}
            >
              Undo
            </button>
          </span>,
        );
      load();
      onLinked?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (error) return null;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Spinner className="h-4 w-4" /> Checking Audiobookshelf...
      </div>
    );
  }
  const unchecked = data.linkedCount.unchecked;
  return (
    <div>
      <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-400">In your Audiobookshelf</h4>
      {data.confirmed.length === 0 && data.similar.length === 0 && (
        <p className="mt-1 text-sm text-gray-300">Nothing with this title or author.</p>
      )}
      <ul className="mt-2 space-y-2">
        {data.confirmed.map(({ via, item }) => (
          <li key={item.id} className="flex items-center gap-3 rounded-lg bg-green-900/20 p-2 ring-1 ring-green-800">
            <Cover src={item.coverUrl} alt={item.title} className="h-12 w-12 flex-shrink-0 rounded" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-semibold text-white">{item.title}</div>
              <div className="truncate text-gray-400">
                {[item.authors.join(", "), item.narrators.length ? `read by ${item.narrators.join(", ")}` : null, duration(item.duration)].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-1">
              <span className="badge badge-success">Same book · {via}</span>
              {admin && (
                <button
                  className="text-xs text-gray-400 hover:text-red-300"
                  onClick={() => unlink(item.id)}
                  disabled={!!busy}
                  title="These are different books. Unlink them everywhere in Shelfhelp."
                >
                  {busy === item.id ? "Unlinking..." : "Not the same book"}
                </button>
              )}
            </div>
          </li>
        ))}
        {data.similar.map((s) => (
          <li key={s.absItemId} className="flex items-center gap-3 rounded-lg bg-gray-900/50 p-2 ring-1 ring-gray-700">
            <Cover src={s.item.coverUrl} alt={s.item.title} className="h-12 w-12 flex-shrink-0 rounded" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-semibold text-white">{s.item.title}</div>
              <div className="truncate text-gray-400">
                {[s.item.authors.join(", "), duration(s.item.duration), s.titleSim >= 0.6 ? "similar title" : "same author, different title"].filter(Boolean).join(" · ")}
              </div>
            </div>
            {admin && (
              <button className="btn btn-sm btn-default flex-shrink-0" onClick={() => same(s.absItemId)} disabled={!!busy} title="Link this Audiobookshelf book to this Hardcover book">
                {busy === s.absItemId ? <Spinner className="h-4 w-4" /> : <CheckCircleIcon className="h-4 w-4" />} Same book
              </button>
            )}
          </li>
        ))}
      </ul>
      {unchecked > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {unchecked} Audiobookshelf books aren't linked to Hardcover yet, so this may miss some. <Link to="/library" className="text-indigo-400 hover:underline">Library</Link> shows progress.
        </p>
      )}
    </div>
  );
}

/** Open issues for a book, and a way to report one. */
function BookIssues({ book, admin }: { book: RequestableBook; admin: boolean }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [reporting, setReporting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const load = () => {
    api<{ issues: Issue[] }>(`/issues?status=open&book=${book.id}`)
      .then((d) => setIssues(d.issues))
      .catch(() => setIssues([]));
  };
  useEffect(load, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Issues</h4>
        <button className="btn btn-sm btn-default" onClick={() => setReporting(true)}>
          <ExclamationTriangleIcon className="h-4 w-4" /> Report an issue
        </button>
      </div>
      {issues && issues.length > 0 && (
        <ul className="mt-2 space-y-2">
          {issues.map((i) => (
            <li key={i.id}>
              <button className="flex w-full items-center gap-2 rounded-lg bg-yellow-900/20 p-2 text-left text-sm ring-1 ring-yellow-800 hover:bg-yellow-900/30" onClick={() => setOpenId(i.id)}>
                <span className="badge badge-warning flex-shrink-0">{i.kindLabel}</span>
                <span className="min-w-0 flex-1 truncate text-gray-200">{i.summary}</span>
                <span className="flex-shrink-0 text-xs text-gray-400">{i.comments} comments</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {issues?.length === 0 && <p className="mt-1 text-sm text-gray-500">No open issues.</p>}
      {reporting && (
        <ReportIssue
          book={book}
          onClose={() => setReporting(false)}
          onReported={(i) => {
            setReporting(false);
            load();
            setOpenId(i.id);
          }}
        />
      )}
      {openId !== null && <IssueThread id={openId} admin={admin} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

/** The book's Hardcover description, small and cut off after a few lines (tap More for the rest). */
function Description({ bookId }: { bookId: number }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    setText(null);
    setOpen(false);
    api<{ description: string | null }>(`/hardcover/description?id=${bookId}`)
      .then((d) => alive && setText(d.description))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bookId]);
  if (!text) return null;
  const long = text.length > 220;
  return (
    <div className="mt-3 text-xs leading-relaxed text-gray-300 sm:text-sm">
      <p className={`whitespace-pre-line ${open ? "" : "line-clamp-3"}`}>{text}</p>
      {long && (
        <button type="button" className="mt-0.5 text-xs font-medium text-indigo-400 hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** Which of your Hardcover shelves the book is on, or a Want to Read button. */
function ShelfBadge({ book, hardcover }: { book: RequestableBook; hardcover: boolean }) {
  const want = useWantToRead(book.id, book.title, book.mine);
  if (want.onShelf) return <span className="badge badge-dark">Hardcover: {want.onShelf}</span>;
  if (!hardcover) return null;
  return (
    <button type="button" onClick={want.add} disabled={want.busy} className="badge badge-dark inline-flex items-center gap-1 hover:text-white">
      {want.busy ? <Spinner className="h-3.5 w-3.5" /> : <WantIcon className="h-3.5 w-3.5" />} Want to Read
    </button>
  );
}

/** Book details with the request controls, opened from search results. */
export function RequestModal({
  book,
  enabled,
  defaultFormat,
  onClose,
  onDone,
  admin = false,
  hardcover = false,
}: {
  admin?: boolean;
  /** You've connected Hardcover, so Want to Read can be offered. */
  hardcover?: boolean;
  book: RequestableBook | null;
  enabled: boolean;
  defaultFormat: RequestFormat;
  onClose: () => void;
  onDone?: (outcomes: RequestOutcome[]) => void;
}) {
  const [owned, setOwned] = useState<boolean | null>(null);
  useEffect(() => setOwned(null), [book?.id]);
  if (!book) return null;
  const hcUrl = book.slug ? `https://hardcover.app/books/${book.slug}` : null;
  const shown = { ...book, absItemId: owned === null ? book.absItemId : owned ? (book.absItemId ?? "yes") : null };
  return (
    <Modal open onClose={onClose} backdrop={book.coverUrl} size="max-w-2xl">
      <div className="flex flex-col gap-5 pt-6 sm:flex-row">
        <Cover src={book.coverUrl} alt={book.title} className="mx-auto h-60 w-40 flex-shrink-0 rounded-lg shadow-lg ring-1 ring-gray-700 sm:mx-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 text-sm text-gray-400">
            {book.releaseYear && <span>{book.releaseYear}</span>}
            {book.rating ? (
              <a
                href={hcUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-yellow-300 hover:text-yellow-200"
                title="Average rating on Hardcover"
              >
                <StarIcon className="h-4 w-4" />
                <span className="font-semibold">{book.rating.toFixed(2)}</span>
                {book.ratingsCount ? <span className="text-gray-400">({book.ratingsCount.toLocaleString()} ratings on Hardcover)</span> : null}
              </a>
            ) : (
              <span className="text-gray-500">No Hardcover rating yet</span>
            )}
          </div>
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
            {shown.absItemId && <span className="badge badge-success">In Audiobookshelf</span>}
            <ShelfBadge book={book} hardcover={hardcover} />
            {hcUrl && (
              <a href={hcUrl} target="_blank" rel="noreferrer" className="badge badge-dark inline-flex items-center gap-1 hover:text-white">
                Hardcover <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <Description bookId={book.id} />
          <div className="mt-5">
            <RequestControls book={shown} enabled={enabled} defaultFormat={defaultFormat} onDone={onDone} />
          </div>
        </div>
      </div>
      <div className="mt-6 border-t border-gray-700 pt-4">
        <InLibrary book={book} admin={admin} onOwned={setOwned} />
        <BookIssues book={book} admin={admin} />
      </div>
    </Modal>
  );
}
