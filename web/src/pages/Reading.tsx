import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  BookOpenIcon,
  CheckIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon as CheckSolid, EyeSlashIcon as EyeSlashSolid, XMarkIcon as XSolid, ArrowUpIcon as ArrowUpSolid, ExclamationTriangleIcon as WarnSolid, PauseIcon as PauseSolid, NoSymbolIcon as NoSymbolSolid, ClockIcon as HourglassIcon } from "@heroicons/react/24/solid";
import {
  api,
  duration,
  sentences,
  shortDate,
  timeAgo,
  type HcBookRef,
  type HcCandidate,
  type ReadingBook,
  type ReadingData,
  type SearchHit,
  type HistoryEntry,
  type Library,
  type MyShelf,
  type Settings,
} from "../lib/api";
import { jobStarted, useApi, useDebounced, useJobs } from "../lib/hooks";
import { JobProgress } from "../components/JobProgress";
import { Cover, Empty, ErrorBlock, LoadingBlock, Modal, PageTitle, ScoreBar, Spinner, Tabs, Toggle } from "../components/ui";
import { useToast } from "../components/toast";

type Tab = "waiting" | "synced" | "issues" | "all" | "history";

/** One line under the tabs saying what each one holds. */
const TAB_HELP: Record<Tab, string> = {
  waiting: "Matched books with a change ready for Hardcover. Nothing is sent until you send it.",
  synced: "Hardcover already matches your listening, or was left as is because the book is already Read there.",
  issues: "Books that won't be synced until something changes. Open one to fix it.",
  all: "Every Audiobookshelf book you've started or finished.",
  history: "Everything sent to Hardcover, newest first. Any change can be undone.",
};

type IssueType = "review" | "notfound" | "dnf" | "skipped" | "under";
const ISSUE_TYPES: IssueType[] = ["review", "notfound", "dnf", "skipped", "under"];
const DEFAULT_ISSUES: IssueType[] = ["review", "notfound", "skipped"];

/** Filter chips for the Issues tab. Each one is also the legend for its icon. */
function IssueFilters({
  min,
  on,
  counts,
  toggle,
}: {
  min: number;
  on: Set<IssueType>;
  counts: Record<IssueType, number>;
  toggle: (t: IssueType) => void;
}) {
  const dot = (cls: string, child: React.ReactNode) => (
    <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full shadow ring-1 ${cls}`}>{child}</span>
  );
  const chips: Record<IssueType, [React.ReactNode, string]> = {
    review: [dot("bg-yellow-500 ring-yellow-400 text-yellow-100", <span className="text-[0.8em] font-black leading-none">?</span>), "Not sure which book"],
    notfound: [dot("bg-red-600 ring-red-500 text-red-100", <XSolid className="h-3/4 w-3/4" />), "Not found"],
    dnf: [dot("bg-orange-500 ring-orange-400 text-orange-50", <NoSymbolSolid className="h-3/4 w-3/4" />), "Did not finish"],
    skipped: [dot("bg-gray-600 ring-gray-500 text-gray-200", <PauseSolid className="h-3/4 w-3/4" />), "Skipped"],
    under: [dot("bg-sky-600 ring-sky-400 text-sky-50", <HourglassIcon className="h-3/4 w-3/4" />), `Under ${min}%`],
  };
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {ISSUE_TYPES.map((t) => {
        const active = on.has(t);
        const [icon, label] = chips[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            aria-pressed={active}
            className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium ring-1 transition ${
              active ? "bg-gray-700 text-white ring-gray-500" : "bg-transparent text-gray-500 ring-gray-700 hover:text-gray-300"
            }`}
          >
            <span className={active ? "" : "opacity-40 grayscale"}>{icon}</span>
            {label}
            <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-gray-900/60 text-gray-200" : "text-gray-600"}`}>{counts[t]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One state per card, combining "is it matched?" and "is it in sync?". */
function cardState(b: ReadingBook) {
  if (b.matchStatus === "ignored") return { key: "skipped", label: "Not synced (your choice)", dot: "bg-gray-600 ring-gray-500 text-gray-200", Icon: EyeSlashSolid };
  if (b.matchStatus === "missing") return { key: "notfound", label: "Not found on Hardcover", dot: "bg-red-600 ring-red-500 text-red-100", Icon: XSolid };
  if (b.matchStatus === "review") return { key: "review", label: "Needs review", dot: "bg-yellow-500 ring-yellow-400 text-yellow-100", Icon: null };
  if (b.hcStatus === 5) return { key: "dnf", label: "Did Not Finish on Hardcover", dot: "bg-orange-500 ring-orange-400 text-orange-50", Icon: NoSymbolSolid };
  if (b.syncStatus === "pending") return { key: "waiting", label: "Waiting to send", dot: "bg-indigo-500 ring-indigo-400 text-indigo-100", Icon: ArrowUpSolid };
  if (b.syncStatus === "held" && b.heldReason === "threshold") return { key: "under", label: b.syncAction ?? "Under the minimum", dot: "bg-sky-600 ring-sky-400 text-sky-50", Icon: HourglassIcon };
  if (b.syncStatus === "held") return { key: "skipped", label: b.syncAction ?? "Not synced", dot: "bg-gray-600 ring-gray-500 text-gray-200", Icon: PauseSolid };
  if (b.syncStatus === "error") return { key: "waiting", label: "Couldn't send", dot: "bg-red-600 ring-red-500 text-red-100", Icon: WarnSolid };
  return { key: "synced", label: b.syncStatus === "skipped" ? "Left as is on Hardcover" : "In sync", dot: "bg-green-400 ring-green-500 text-green-100", Icon: CheckSolid };
}

function StateDot({ book, className = "h-5 w-5" }: { book: ReadingBook; className?: string }) {
  const s = cardState(book);
  return (
    <span className={`flex items-center justify-center rounded-full shadow ring-1 ${s.dot} ${className}`} title={s.label}>
      {s.Icon ? <s.Icon className="h-3/4 w-3/4" /> : <span className="text-[0.8em] font-black leading-none">?</span>}
    </span>
  );
}

function ProgressBar({ book, className = "" }: { book: ReadingBook; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-gray-700 ${className}`}>
      <div className={book.isFinished ? "h-full bg-green-500" : "h-full bg-indigo-500"} style={{ width: `${Math.max(2, book.progress)}%` }} />
    </div>
  );
}

function absLine(b: ReadingBook) {
  return b.isFinished ? `Finished${b.finishedAt ? ` ${shortDate(b.finishedAt)}` : ""}` : `${Math.round(b.progress)}% listened`;
}

function hcLine(b: ReadingBook) {
  if (b.matchStatus !== "matched") return cardState(b).label;
  if (b.syncStatus === "pending") return b.syncAction ?? "Waiting to send";
  if (b.syncStatus === "held") return b.syncAction ?? "Held back";
  if (!b.hcStatusName) return "Not on your Hardcover shelves";
  return `${b.hcStatusName}${b.hcStatus === 2 && b.hcProgress != null ? ` ${Math.round(b.hcProgress)}%` : ""}`;
}

function ReadingCard({ book, onOpen }: { book: ReadingBook; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group w-full text-left outline-none"
    >
      <div
        className={`relative overflow-hidden rounded-xl bg-gray-800 ring-1 transition duration-300 ${
          hover ? "scale-105 shadow-lg ring-gray-500" : "shadow ring-gray-700"
        }`}
        style={{ paddingBottom: "100%" }}
      >
        <Cover src={book.coverUrl} alt={book.title} className="absolute inset-0 h-full w-full" />
        <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-2">
          {book.hcStatus === 5 ? (
            <span className="rounded-full border border-orange-500 bg-orange-600/90 px-2 text-[10px] font-semibold uppercase leading-5 tracking-wider text-white shadow-md">
              DNF
            </span>
          ) : book.heldReason === "threshold" ? (
            <span className="rounded-full border border-sky-500 bg-sky-600/90 px-2 text-[10px] font-semibold uppercase leading-5 tracking-wider text-white shadow-md">
              {(book.syncAction ?? "Under minimum").replace(/ listened$/, "")}
            </span>
          ) : (
            <span className="rounded-full border border-purple-600 bg-purple-600/80 px-2 text-[10px] font-semibold uppercase leading-5 tracking-wider text-white shadow-md">
              {book.isFinished ? "Finished" : "Listening"}
            </span>
          )}
          <StateDot book={book} />
        </div>
        <div className={`absolute inset-0 flex flex-col justify-end bg-gray-800/85 p-3 transition-opacity duration-300 ${hover ? "opacity-100" : "opacity-0"}`}>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Hardcover</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">{book.hcBook?.title ?? "No match yet"}</div>
          <div className="mt-1 line-clamp-2 text-xs text-gray-300">{hcLine(book)}</div>
          <span className="btn btn-sm btn-primary mt-3 w-full">{book.matchStatus === "review" ? "Review" : "Details"}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2">
          <ProgressBar book={book} className="shadow" />
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <div className="truncate text-sm font-semibold text-white">{book.title}</div>
        <div className="truncate text-xs text-gray-400">{absLine(book)}</div>
      </div>
    </button>
  );
}

function Stat({ label, value, sub, accent, onClick }: { label: string; value: number | string; sub: string; accent?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="card h-full p-4 text-left transition hover:ring-gray-500 sm:p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${accent ?? "text-white"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{sub}</div>
    </button>
  );
}

function ShelfBadge({ mine }: { mine: MyShelf | null | undefined }) {
  if (!mine) return <span className="badge badge-dark">Not on your shelves</span>;
  const color = mine.status === 3 ? "badge-success" : mine.status === 2 ? "badge-default" : mine.status === 5 ? "badge-danger" : "badge-dark";
  return (
    <span className={`badge ${color}`}>
      {mine.statusName}
      {mine.status === 2 && mine.progress != null ? ` ${Math.round(mine.progress)}%` : ""}
    </span>
  );
}

export function HcRow({
  book,
  candidate,
  current,
  busy,
  onUse,
  mine,
}: {
  book: HcBookRef;
  mine?: MyShelf | null;
  candidate?: HcCandidate;
  current?: boolean;
  busy?: boolean;
  onUse?: () => void;
}) {
  return (
    <div className={`flex gap-3 rounded-lg p-3 ring-1 ${current ? "bg-green-900/20 ring-green-700" : "bg-gray-900/40 ring-gray-700"}`}>
      <Cover src={book.coverUrl} alt={book.title} className="h-24 w-16 flex-shrink-0 rounded-md ring-1 ring-gray-700" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{book.title}</div>
            <div className="truncate text-sm text-gray-300">{book.authors.join(", ") || "No author"}</div>
            <div className="my-1">
              <ShelfBadge mine={mine} />
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-gray-400">
              {book.seriesName && (
                <span>
                  {book.seriesName}
                  {book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}
                </span>
              )}
              {book.releaseYear && <span>{book.releaseYear}</span>}
              {book.slug && (
                <a
                  href={`https://hardcover.app/books/${book.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
                >
                  Hardcover <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {onUse && (
            <button className="btn btn-sm btn-primary flex-shrink-0" onClick={onUse} disabled={busy}>
              <CheckIcon className="h-4 w-4" /> Use this
            </button>
          )}
          {current && <span className="badge badge-success flex-shrink-0">Current</span>}
        </div>
        {candidate && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ScoreBar score={candidate.score} />
            <span className="text-xs text-gray-400">Title {Math.round(candidate.titleSim * 100)}%</span>
            <span className="text-xs text-gray-400">Author {candidate.authorSim === null ? "n/a" : `${Math.round(candidate.authorSim * 100)}%`}</span>
            {candidate.idVia.map((v) => (
              <span key={v} className="badge badge-default">
                {v.toUpperCase()} match
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadingModal({ book, onClose, onChanged }: { book: ReadingBook | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 450);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setQ("");
    setResults(null);
  }, [book?.absItemId]);
  useEffect(() => {
    if (!dq.trim()) return setResults(null);
    setSearching(true);
    api<SearchHit[]>(`/hardcover/search?q=${encodeURIComponent(dq)}`)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [dq]);

  if (!book) return null;

  const decide = async (action: "match" | "ignore" | "missing" | "reset", hc?: HcBookRef) => {
    setBusy(true);
    try {
      await api("/reading/decisions", { method: "POST", body: { absItemId: book.absItemId, action, hcBookId: hc?.id, hcBook: hc } });
      toast(
        action === "match"
          ? `Matched to "${hc?.title}" on Hardcover`
          : action === "ignore"
            ? `Won't sync "${book.title}"`
            : action === "missing"
              ? `Marked "${book.title}" as not on Hardcover`
              : `"${book.title}" is back to automatic matching`,
      );
      setTimeout(onChanged, 600);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const sendOne = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: number; failed: number; changed: number }>("/reading/send", { method: "POST", body: { ids: [book.absItemId] } });
      toast(
        r.sent ? `Sent to Hardcover: ${book.syncAction}` : r.changed ? "Hardcover changed since you looked; check the new plan" : "Couldn't send it",
        r.sent ? "success" : "error",
      );
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const matchAgain = async () => {
    setBusy(true);
    try {
      const r = await api<{ started: boolean; running: boolean }>("/reading/rematch", { method: "POST", body: { absItemId: book.absItemId } });
      jobStarted();
      toast(
        r.running
          ? `A check is running. Click Check Now after it finishes to match "${book.title}" again.`
          : `Matching "${book.title}" again. It will update when the check finishes.`,
        "info",
      );
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const skipOne = async () => {
    await api("/reading/skip", { method: "POST", body: { id: book.absItemId } });
    toast(`Skipped. "${book.title}" will come back if your progress changes.`, "info");
    onChanged();
    onClose();
  };

  const state = cardState(book);
  const current = book.candidates.find((c) => c.id === book.hcBookId);
  const others = book.candidates.filter((c) => c.id !== book.hcBookId);

  return (
    <Modal
      open
      onClose={onClose}
      size="max-w-3xl"
      backdrop={book.coverUrl}
      footer={
        <>
          <button className="btn btn-default" onClick={matchAgain} disabled={busy} title="Forget this match and look it up on Hardcover again">
            <ArrowPathIcon className="h-4 w-4" /> Match again
          </button>
          {book.matchStatus !== "missing" && (
            <button className="btn btn-default" onClick={() => decide("missing")} disabled={busy}>
              <XMarkIcon className="h-4 w-4" /> Not on Hardcover
            </button>
          )}
          {book.matchStatus !== "ignored" ? (
            <button className="btn btn-default" onClick={() => decide("ignore")} disabled={busy}>
              <EyeSlashIcon className="h-4 w-4" /> Don't sync
            </button>
          ) : (
            <button className="btn btn-default" onClick={() => decide("reset")} disabled={busy}>
              <EyeIcon className="h-4 w-4" /> Sync again
            </button>
          )}
          {book.matchStatus === "review" && book.hcBook && (
            <button className="btn btn-success" onClick={() => decide("match", book.hcBook!)} disabled={busy}>
              <CheckIcon className="h-4 w-4" /> Approve match
            </button>
          )}
          {book.matchStatus === "matched" && book.syncStatus === "pending" && (
            <>
              <button className="btn btn-default" onClick={skipOne} disabled={busy}>
                Skip this change
              </button>
              <button className="btn btn-primary" onClick={sendOne} disabled={busy}>
                <ArrowUpIcon className="h-4 w-4" /> Send this change
              </button>
            </>
          )}
        </>
      }
    >
      <div className="flex gap-4 pt-5 sm:gap-6">
        <Cover src={book.coverUrl} alt={book.title} className="h-28 w-28 flex-shrink-0 rounded-lg shadow-lg ring-1 ring-gray-700 sm:h-36 sm:w-36" />
        <div className="min-w-0 flex-1 pr-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">In Audiobookshelf</div>
          <h2 className="mt-1 text-2xl font-bold leading-tight text-white">{book.title}</h2>
          <div className="text-gray-300">{book.authors.join(", ")}</div>
          {book.narrators.length > 0 && <div className="text-sm text-gray-400">Narrated by {book.narrators.join(", ")}</div>}
          <ProgressBar book={book} className="mt-3 max-w-sm" />
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-gray-400">
            <span>{absLine(book)}</span>
            {book.startedAt && <span>Started {shortDate(book.startedAt)}</span>}
            {!book.isFinished && book.lastUpdate && <span>Last listened {timeAgo(new Date(book.lastUpdate).toISOString())}</span>}
            {duration(book.duration) && <span>{duration(book.duration)}</span>}
            {book.asin && <span>ASIN {book.asin}</span>}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-gray-900/40 p-4 ring-1 ring-gray-700">
        <div className="flex items-center gap-2">
          <StateDot book={book} className="h-5 w-5" />
          <span className="font-semibold text-white">{state.label}</span>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {book.matchStatus === "matched"
            ? book.syncStatus === "pending"
              ? `Ready to send: ${book.syncAction}.`
              : book.syncStatus === "error"
                ? book.syncAction
                : book.syncStatus === "held"
                  ? book.heldReason === "threshold"
                    ? "Nothing is sent until you pass the minimum progress set in Reading settings."
                    : "Nothing is sent. Turn on Add new books in Reading settings (the gear button) to add it, or put it on a shelf on Hardcover first."
                : book.hcStatus === 5
                  ? "Marked Did Not Finish on Hardcover. Shelfhelp won't change it or send progress. Change the status on Hardcover and syncing picks up again on the next check."
                : book.syncStatus === "skipped"
                  ? `${book.syncAction}. Shelfhelp never moves a book backward.`
                  : `Hardcover shows ${hcLine(book)}${book.syncedAt ? `, updated ${timeAgo(book.syncedAt)}` : ""}.`
            : sentences(book.reasons)}
        </p>
      </div>

      {book.hcBook && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
            {book.matchStatus === "matched" ? "Matched on Hardcover" : "Best guess on Hardcover"}
          </h4>
          <HcRow book={book.hcBook} mine={book.mine} candidate={current} current={book.matchStatus === "matched"} />
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Other possibilities</h4>
          <div className="space-y-2">
            {others.map((c) => (
              <HcRow key={c.id} book={c} mine={c.mine} candidate={c} busy={busy} onUse={() => decide("match", c)} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Search Hardcover</h4>
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input className="input pl-10" placeholder="Title or author" value={q} onChange={(e) => setQ(e.target.value)} />
          {searching && <Spinner className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />}
        </div>
        {results && (
          <div className="mt-3 space-y-2">
            {results.length === 0 && <div className="text-sm text-gray-500">No books on Hardcover match that.</div>}
            {results.map((h) => (
              <HcRow
                key={h.id}
                book={h}
                mine={h.mine}
                busy={busy}
                current={h.id === book.hcBookId && book.matchStatus === "matched"}
                onUse={h.id === book.hcBookId && book.matchStatus === "matched" ? undefined : () => decide("match", h)}
              />
            ))}
          </div>
        )}
      </div>
      <p className="mt-6 text-xs text-gray-500">
        Changing a match here also updates your collections. It doesn't undo anything already sent to Hardcover.
      </p>
    </Modal>
  );
}

/** The exact list of changes that will go to Hardcover, with a checkbox for each. */
function SendModal({ books, onClose, onSent }: { books: ReadingBook[]; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(books.map((b) => b.absItemId)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const go = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: number; failed: number; changed: number }>("/reading/send", { method: "POST", body: { ids: [...picked] } });
      toast(
        `Sent ${r.sent} change${r.sent === 1 ? "" : "s"} to Hardcover${r.failed ? `, ${r.failed} failed` : ""}${r.changed ? `, ${r.changed} changed since you looked` : ""}`,
        r.failed ? "error" : "success",
      );
      onSent();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Send to Hardcover"
      subtitle="Only the checked changes are sent. Each one can be undone from History."
      footer={
        <>
          <button className="btn btn-default mr-auto" onClick={() => setPicked(picked.size === books.length ? new Set() : new Set(books.map((b) => b.absItemId)))}>
            {picked.size === books.length ? "Uncheck all" : "Check all"}
          </button>
          <button className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={go} disabled={busy || !picked.size}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : <ArrowUpIcon className="h-4 w-4" />} Send {picked.size} change{picked.size === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <p className="mb-3 mt-1 text-sm text-yellow-200/80">Hardcover shows status changes in your followers' feeds.</p>
      <ul className="divide-y divide-gray-700 overflow-hidden rounded-lg ring-1 ring-gray-700">
        {books.map((b) => (
          <li key={b.absItemId}>
            <label className="flex cursor-pointer items-center gap-3 bg-gray-900/40 px-3 py-2.5 hover:bg-gray-700/40">
              <input
                type="checkbox"
                checked={picked.has(b.absItemId)}
                onChange={() => toggle(b.absItemId)}
                className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              <Cover src={b.coverUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded ring-1 ring-gray-700" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{b.hcBook?.title ?? b.title}</div>
                <div className="truncate text-xs text-indigo-300">{b.syncAction}</div>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function HistoryList({ onUndone }: { onUndone: () => void }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<HistoryEntry[]>("/reading/history");
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<HistoryEntry | null>(null);

  const doUndo = async (h: HistoryEntry) => {
    setBusy(h.id);
    setConfirm(null);
    try {
      const r = await api<{ note: string }>(`/reading/history/${h.id}/undo`, { method: "POST" });
      toast(`"${h.title}": ${r.note}`);
      reload();
      onUndone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingBlock />;
  if (!data?.length) return <div className="py-16 text-center text-sm text-gray-500">Nothing has been sent to Hardcover yet.</div>;
  return (
    <>
      <div className="card overflow-hidden">
        <ul className="divide-y divide-gray-700">
          {data.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Cover src={h.coverUrl} alt="" className="h-12 w-12 flex-shrink-0 rounded ring-1 ring-gray-700" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{h.title}</div>
                <div className={`truncate text-sm ${h.undoneAt ? "text-gray-500 line-through" : "text-gray-300"}`}>{h.description}</div>
                {h.undoneAt && <div className="truncate text-xs text-gray-400">Undone: {h.undoNote}</div>}
              </div>
              <time className="hidden flex-shrink-0 text-xs text-gray-500 sm:block">{timeAgo(h.ts)}</time>
              {!h.undoneAt && (
                <button className="btn btn-sm btn-default flex-shrink-0" onClick={() => setConfirm(h)} disabled={busy === h.id}>
                  {busy === h.id ? <Spinner className="h-4 w-4" /> : <ArrowUturnLeftIcon className="h-4 w-4" />} Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title="Undo this change?"
          subtitle={confirm.title}
          footer={
            <>
              <button className="btn btn-default" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => doUndo(confirm)}>
                <ArrowUturnLeftIcon className="h-4 w-4" /> Undo
              </button>
            </>
          }
        >
          <p className="mt-2 text-sm text-gray-300">
            {confirm.kind === "add"
              ? "Shelfhelp added this book to your Hardcover library. Undo removes it from your library, including its reading dates."
              : confirm.kind === "status"
                ? "This sets the book back to its old status on Hardcover and removes the reading session the change started."
                : confirm.kind === "dates"
                  ? "This sets the reading dates on Hardcover back to what they were."
                  : "This sets your Hardcover progress (and any reading dates it changed) back to what they were."}
          </p>
          <p className="mt-2 text-sm text-gray-400">It won't be sent again unless your listening progress changes.</p>
        </Modal>
      )}
    </>
  );
}

/** Reading settings, opened from the gear on this page. */
function ReadingSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [libs, setLibs] = useState<(Library & { selected: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Settings>("/settings").then(setS).catch((e) => toast(e.message, "error"));
    api<(Library & { selected: boolean })[]>("/abs/libraries?all=1").then(setLibs).catch(() => setLibs([]));
  }, [toast]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => s && setS({ ...s, [k]: v });

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const chosen = libs?.filter((l) => l.selected).map((l) => l.id) ?? [];
      await api("/settings", {
        method: "PUT",
        body: {
          readingEnabled: s.readingEnabled,
          readingAutoSend: s.readingAutoSend,
          readingMinProgress: s.readingMinProgress,
          readingMarkOwned: s.readingMarkOwned,
          // Every library checked is saved as "all", so new libraries are included too.
          ...(libs ? { absLibraries: libs.every((l) => l.selected) ? [] : chosen } : {}),
        },
      });
      toast("Reading settings saved");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, tip: string, control: React.ReactNode) => (
    <div className="flex items-start justify-between gap-6 py-4">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="mt-0.5 text-xs text-gray-400">{tip}</div>
      </div>
      <div className="flex-shrink-0 pt-0.5">{control}</div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Reading Settings"
      subtitle="Books never move backward: Read and Did Not Finish are left alone, and progress is never lowered."
      footer={
        <>
          <button className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !s || (libs?.length ? libs.every((l) => !l.selected) : false)}>
            Save Changes
          </button>
        </>
      }
    >
      {!s ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="divide-y divide-gray-700">
          {row("Sync reading progress", "Turn the whole Reading feature on or off.", <Toggle checked={s.readingEnabled} onChange={(v) => set("readingEnabled", v)} />)}
          {row(
            "Send automatically",
            "Off: changes wait here until you send them. On: they go out on each sync. Either way, everything sent can be undone from History.",
            <Toggle checked={s.readingAutoSend} onChange={(v) => set("readingAutoSend", v)} />,
          )}
          {row(
            "Minimum progress",
            "Books with less than this listened aren't synced. Finished books always are.",
            <div className="flex items-center gap-2">
              <input
                className="input w-20 text-right"
                type="number"
                min={0}
                max={100}
                value={s.readingMinProgress}
                onChange={(e) => set("readingMinProgress", Number(e.target.value))}
              />
              <span className="text-gray-400">%</span>
            </div>,
          )}
          {row(
            "Mark as owned",
            "Also mark the audiobook edition as Owned on Hardcover when a book is synced.",
            <Toggle checked={s.readingMarkOwned} onChange={(v) => set("readingMarkOwned", v)} />,
          )}
          {libs && libs.length > 0 && (
            <div className="py-4">
              <div className="text-sm font-medium text-white">Libraries</div>
              <div className="mt-0.5 text-xs text-gray-400">Every library Shelfhelp finds is used unless you uncheck it. This also applies to collections.</div>
              <div className="mt-3 space-y-2.5">
                {libs.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                      checked={l.selected}
                      onChange={() => setLibs(libs.map((x) => (x.id === l.id ? { ...x, selected: !x.selected } : x)))}
                    />
                    <span className="text-sm text-white">{l.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function ReadingPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [issueTypes, setIssueTypes] = useState<Set<IssueType>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("shelfhelp.issueTypes") ?? "null");
      if (Array.isArray(saved)) return new Set(saved.filter((t) => ISSUE_TYPES.includes(t)));
    } catch {
      /* private mode or bad value */
    }
    return new Set(DEFAULT_ISSUES);
  });
  const toggleIssue = (t: IssueType) => {
    const next = new Set(issueTypes);
    next.has(t) ? next.delete(t) : next.add(t);
    setIssueTypes(next);
    try {
      localStorage.setItem("shelfhelp.issueTypes", JSON.stringify([...next]));
    } catch {
      /* private mode */
    }
  };
  const [poll, setPoll] = useState<number | false>(false);
  const { data, error, loading, reload } = useApi<ReadingData>("/reading", { poll });
  const [openId, setOpenId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => setPoll(data?.running ? 2000 : 30000), [data?.running]);
  const jobs = useJobs();
  const lastRun = jobs?.last.reading?.finishedAt ?? 0;
  const lastSend = jobs?.last["reading-send"]?.finishedAt ?? 0;
  // Reload the books as soon as a sync finishes.
  useEffect(() => {
    if (lastRun || lastSend) reload();
  }, [lastRun, lastSend, reload]);

  // Opens on Waiting, or on Issues when changes are sent automatically.
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && asked in TAB_HELP ? asked : data?.autoSend ? "issues" : "waiting";
  const books = useMemo(() => {
    const all = data?.books ?? [];
    return tab === "all" ? all : all.filter((b) => cardState(b).key === tab);
  }, [data, tab]);
  // One list, most pressing first; the icons say what each one needs.
  const issues = useMemo(() => {
    const order = ISSUE_TYPES.filter((t) => issueTypes.has(t)) as string[];
    return (data?.books ?? [])
      .filter((b) => order.includes(cardState(b).key))
      .sort((a, b) => order.indexOf(cardState(a).key) - order.indexOf(cardState(b).key));
  }, [data, issueTypes]);
  const open = data?.books.find((b) => b.absItemId === openId) ?? null;
  const pending = useMemo(() => (data?.books ?? []).filter((b) => b.matchStatus === "matched" && b.syncStatus === "pending"), [data]);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={error ?? "Couldn't load reading progress"} />;
  const c = data.counts;
  const countOf = (key: string) => data.books.filter((b) => cardState(b).key === key).length;
  // Did Not Finish books are left out of the totals, like books under the minimum.
  const dnf = data.books.filter((b) => cardState(b).key === "dnf");
  const waiting = c.pending + c.errors;

  const sync = async () => {
    try {
      const r = await api<{ started: boolean; running?: boolean }>("/reading/sync", { method: "POST" });
      if (r.running) {
        const job = jobs?.running.find((j) => j.id === "reading");
        toast(`Already checking${job ? `: ${job.phase.toLowerCase()}` : ""}. Progress is shown below.`, "info");
      }
      jobStarted();
      setTimeout(reload, 500);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <PageTitle
        extra={
          <>
            <button className="btn btn-default" onClick={() => setSettingsOpen(true)} title="Reading settings">
              <Cog6ToothIcon className="h-5 w-5" />
            </button>
            <button className="btn btn-default" onClick={sync} disabled={data.running}>
              {data.running ? <Spinner className="h-5 w-5" /> : <ArrowPathIcon className="h-5 w-5" />} {data.running ? "Checking" : "Check Now"}
            </button>
            {pending.length > 0 && (
              <button className="btn btn-primary" onClick={() => setSending(true)} disabled={data.running}>
                <ArrowUpIcon className="h-5 w-5" /> Review and send ({pending.length})
              </button>
            )}
          </>
        }
      >
        Reading
      </PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-gray-400">
        Your Audiobookshelf listening progress, sent to Hardcover.
        {data.enabled && (data.autoSend ? " Changes are sent automatically." : " Nothing is sent until you send it.")}
      </p>
      <JobProgress jobs={jobs} id="reading" />
      <JobProgress jobs={jobs} id="reading-send" idle={false} />

      {!data.enabled && (
        <div className="mb-6 rounded-xl bg-gray-800 p-4 text-sm text-gray-300 ring-1 ring-gray-700">
          Reading progress is off.{" "}
          <button className="text-indigo-400 hover:underline" onClick={() => setSettingsOpen(true)}>
            Turn it on
          </button>
        </div>
      )}

      {c.total === 0 ? (
        <Empty icon={<BookOpenIcon className="h-16 w-16" />} title={data.running ? "Looking for progress..." : "No listening progress yet"}>
          Books you've started in Audiobookshelf show up here.
        </Empty>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat
              label="With progress"
              value={c.total - countOf("under") - dnf.length}
              sub={`${c.listening - countOf("under") - dnf.filter((b) => !b.isFinished).length} listening, ${c.finished - dnf.filter((b) => b.isFinished).length} finished`}
              onClick={() => setTab("all")}
            />
            <Stat label="In sync" value={countOf("synced")} sub={`of ${c.matched - dnf.length} matched`} accent="text-green-400" onClick={() => setTab("synced")} />
            <Stat
              label="Waiting"
              value={waiting}
              sub={c.errors ? `${c.errors} couldn't be sent` : data.autoSend ? "sends on the next sync" : "waiting for you"}
              accent={waiting ? "text-indigo-400" : undefined}
              onClick={() => setTab("waiting")}
            />
            <Stat
              label="To review"
              value={c.review}
              sub={`${c.missing} not found on Hardcover`}
              accent={c.review ? "text-yellow-400" : undefined}
              onClick={() => setTab("issues")}
            />
          </div>

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "waiting", label: "Waiting", count: waiting },
              { id: "issues", label: "Issues", count: ISSUE_TYPES.filter((t) => issueTypes.has(t)).reduce((n, t) => n + countOf(t), 0) },
              { id: "synced", label: "In Sync", count: countOf("synced") },
              { id: "all", label: "All", count: c.total },
              { id: "history", label: "History" },
            ]}
          />
          <div className="-mt-3 mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-400">{TAB_HELP[tab]}</p>
          </div>

          {tab === "history" ? (
            <HistoryList onUndone={reload} />
          ) : tab === "issues" ? (
            <>
              <IssueFilters
                min={data.minProgress}
                on={issueTypes}
                toggle={toggleIssue}
                counts={Object.fromEntries(ISSUE_TYPES.map((t) => [t, countOf(t)])) as Record<IssueType, number>}
              />
              {issues.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-500">{issueTypes.size ? "No issues of the selected kinds." : "Pick a kind of issue above to see it."}</div>
              ) : (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
                  {issues.map((b) => (
                    <li key={b.absItemId}>
                      <ReadingCard book={b} onOpen={() => setOpenId(b.absItemId)} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : books.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">Nothing here.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
              {books.map((b) => (
                <li key={b.absItemId}>
                  <ReadingCard book={b} onOpen={() => setOpenId(b.absItemId)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {data.counts.errors > 0 && tab === "waiting" && (
        <p className="mt-6 flex items-center gap-2 text-sm text-red-300">
          <ExclamationTriangleIcon className="h-5 w-5" /> Some changes couldn't be sent. Open one to see why.
        </p>
      )}

      <ReadingModal book={open} onClose={() => setOpenId(null)} onChanged={reload} />
      {settingsOpen && <ReadingSettings onClose={() => setSettingsOpen(false)} onSaved={() => setTimeout(reload, 800)} />}
      {sending && <SendModal books={pending} onClose={() => setSending(false)} onSent={reload} />}
    </div>
  );
}
