import { useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, CheckIcon, EyeSlashIcon, MagnifyingGlassIcon, ArrowUturnLeftIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api, duration, sentences, type AbsItem, type Book, type Candidate } from "../lib/api";
import { useDebounced } from "../lib/hooks";
import { Cover, Modal, ScoreBar, Spinner, StatusBadge } from "./ui";
import { useToast } from "./toast";

function viaLabel(v: string) {
  return { asin: "ASIN", isbn: "ISBN", audible: "Audible ID", amazon: "Amazon ID" }[v] ?? v;
}

function ItemRow({
  item,
  candidate,
  current,
  busy,
  onUse,
}: {
  item: AbsItem;
  candidate?: Candidate;
  current?: boolean;
  busy?: boolean;
  onUse?: () => void;
}) {
  const series = item.series.map((s) => `${s.name}${s.sequence != null ? ` #${s.sequence}` : ""}`).join(", ");
  return (
    <div className={`flex gap-3 rounded-lg p-3 ring-1 ${current ? "bg-green-900/20 ring-green-700" : "bg-gray-900/40 ring-gray-700"}`}>
      <Cover src={item.coverUrl} alt={item.title} className="h-20 w-20 flex-shrink-0 rounded-md ring-1 ring-gray-700" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{item.title}</div>
            {item.subtitle && <div className="truncate text-xs text-gray-400">{item.subtitle}</div>}
            <div className="truncate text-sm text-gray-300">{item.authors.join(", ") || "No author"}</div>
          </div>
          {onUse && (
            <button className="btn btn-sm btn-primary flex-shrink-0" onClick={onUse} disabled={busy}>
              <CheckIcon className="h-4 w-4" /> Use this
            </button>
          )}
          {current && <span className="badge badge-success flex-shrink-0">Current</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
          {series && <span>{series}</span>}
          {item.narrators.length > 0 && <span>Narrated by {item.narrators.join(", ")}</span>}
          {duration(item.duration) && <span>{duration(item.duration)}</span>}
          {item.asin && <span>ASIN {item.asin}</span>}
          {item.isbn && <span>ISBN {item.isbn}</span>}
        </div>
        {candidate && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ScoreBar score={candidate.score} />
            <span className="text-xs text-gray-400">Title {Math.round(candidate.titleSim * 100)}%</span>
            <span className="text-xs text-gray-400">
              Author {candidate.authorSim === null ? "n/a" : `${Math.round(candidate.authorSim * 100)}%`}
            </span>
            {candidate.idVia.map((v) => (
              <span key={v} className="badge badge-default">
                {viaLabel(v)} match
              </span>
            ))}
          </div>
        )}
        {candidate && candidate.notes.length > 0 && (
          <div className="mt-1 text-xs text-gray-500">{candidate.notes.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

export function BookModal({
  book,
  libraryId,
  onClose,
  onChanged,
}: {
  book: Book | null;
  libraryId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [results, setResults] = useState<AbsItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setQ("");
    setResults(null);
  }, [book?.hcBookId]);

  useEffect(() => {
    if (!dq.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    api<AbsItem[]>(`/abs/search?libraryId=${encodeURIComponent(libraryId)}&q=${encodeURIComponent(dq)}`)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [dq, libraryId]);

  if (!book) return null;

  const decide = async (action: "match" | "ignore" | "missing" | "reset", absItemId?: string) => {
    setBusy(true);
    try {
      await api("/decisions", { method: "POST", body: { hcBookId: book.hcBookId, libraryId, action, absItemId } });
      toast(
        action === "match"
          ? `Matched "${book.title}"`
          : action === "ignore"
            ? `Ignoring "${book.title}"`
            : action === "missing"
              ? `Marked "${book.title}" as not in your library`
              : `"${book.title}" is back to automatic matching`,
      );
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const others = book.candidates.filter((c) => c.item && c.absItemId !== book.absItemId);

  return (
    <Modal
      open={!!book}
      onClose={onClose}
      size="max-w-3xl"
      backdrop={book.coverUrl}
      footer={
        <>
          {book.matchSource === "manual" && (
            <button className="btn btn-default" onClick={() => decide("reset")} disabled={busy}>
              <ArrowUturnLeftIcon className="h-4 w-4" /> Back to automatic
            </button>
          )}
          {book.status !== "missing" && (
            <button className="btn btn-default" onClick={() => decide("missing")} disabled={busy}>
              <XMarkIcon className="h-4 w-4" /> Not in my library
            </button>
          )}
          {book.status !== "ignored" && (
            <button className="btn btn-default" onClick={() => decide("ignore")} disabled={busy}>
              <EyeSlashIcon className="h-4 w-4" /> Ignore
            </button>
          )}
          {book.status === "review" && book.absItemId && (
            <button className="btn btn-success" onClick={() => decide("match", book.absItemId!)} disabled={busy}>
              <CheckIcon className="h-4 w-4" /> Approve match
            </button>
          )}
        </>
      }
    >
      <div className="flex gap-4 pt-5 sm:gap-6">
        <Cover src={book.coverUrl} alt={book.title} className="w-24 flex-shrink-0 rounded-lg shadow-lg ring-1 ring-gray-700 sm:w-32" />
        <div className="min-w-0 flex-1">
          <StatusBadge status={book.status} />
          {book.matchSource === "manual" && <span className="badge badge-default ml-2">Your decision</span>}
          <h2 className="mt-2 text-2xl font-bold leading-tight text-white sm:text-3xl">{book.title}</h2>
          {book.subtitle && <div className="text-gray-400">{book.subtitle}</div>}
          <div className="mt-1 text-gray-300">{book.authors.join(", ")}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-gray-400">
            {book.seriesName && (
              <span>
                {book.seriesName}
                {book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}
              </span>
            )}
            {book.releaseYear && <span>{book.releaseYear}</span>}
            {book.hcUrl && (
              <a href={book.hcUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300">
                Hardcover <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          {book.reasons.length > 0 && <p className="mt-3 text-sm text-gray-400">{sentences(book.reasons)}</p>}
        </div>
      </div>

      {book.absItem && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
            {book.status === "matched" ? "Matched to" : "Best guess"}
          </h4>
          <ItemRow
            item={book.absItem}
            candidate={book.candidates.find((c) => c.absItemId === book.absItemId)}
            current={book.status === "matched"}
          />
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Other possibilities</h4>
          <div className="space-y-2">
            {others.map((c) => (
              <ItemRow key={c.absItemId} item={c.item!} candidate={c} busy={busy} onUse={() => decide("match", c.absItemId)} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Find it in your library</h4>
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-10"
            placeholder="Title, author, series, ASIN or ISBN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching && <Spinner className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />}
        </div>
        {results && (
          <div className="mt-3 space-y-2">
            {results.length === 0 && <div className="text-sm text-gray-500">Nothing in the library matches that.</div>}
            {results.map((item) => (
              <ItemRow key={item.id} item={item} busy={busy} onUse={() => decide("match", item.id)} current={item.id === book.absItemId && book.status === "matched"} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
