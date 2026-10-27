import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, ClipboardDocumentCheckIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api, type Book } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookModal } from "../components/BookModal";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle, ScoreBar } from "../components/ui";
import { useToast } from "../components/toast";

/** One book waiting for a decision, laid out like a Seerr request row. */
function ReviewRow({ book, onOpen, onDone }: { book: Book; onOpen: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const decide = async (action: "match" | "missing") => {
    setBusy(true);
    try {
      await api("/decisions", {
        method: "POST",
        body: { hcBookId: book.hcBookId, libraryId: book.libraryId, action, absItemId: action === "match" ? book.absItemId : undefined },
      });
      toast(action === "match" ? `Matched "${book.title}"` : `Marked "${book.title}" as not in your library`);
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };
  const item = book.absItem;
  const candidate = book.candidates.find((c) => c.absItemId === book.absItemId);

  return (
    <div className="relative flex w-full flex-col overflow-hidden rounded-xl bg-gray-800 text-gray-400 shadow-md ring-1 ring-gray-700 xl:flex-row xl:items-center">
      {book.coverUrl && (
        <div className="pointer-events-none absolute inset-0 z-0 w-full xl:w-2/3">
          <img src={book.coverUrl} alt="" className="h-full w-full object-cover opacity-25 blur-md" />
          <div className="row-backdrop absolute inset-0" />
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-4 p-4 xl:w-[38%] xl:flex-none">
        <button onClick={onOpen} className="flex-shrink-0">
          <Cover src={book.coverUrl} alt={book.title} className="h-24 w-16 rounded-md shadow ring-1 ring-gray-700 transition hover:scale-105 sm:h-28 sm:w-20" />
        </button>
        <div className="min-w-0">
          <button onClick={onOpen} className="block max-w-full truncate text-left text-lg font-bold text-white hover:underline xl:text-xl">
            {book.title}
          </button>
          <div className="truncate text-sm text-gray-300">{book.authors.join(", ")}</div>
          {book.seriesName && (
            <div className="truncate text-xs text-gray-400">
              {book.seriesName}
              {book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {book.lists?.map((l) => (
              <Link key={l.id} to={`/lists/${l.id}`} className="badge badge-dark hover:border-gray-500">
                {l.name}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-4 border-t border-gray-700 p-4 xl:border-l xl:border-t-0">
        {item ? (
          <>
            <Cover src={item.coverUrl} alt={item.title} className="h-20 w-20 flex-shrink-0 rounded-md ring-1 ring-gray-700" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Best guess in your library</div>
              <div className="truncate font-semibold text-white">{item.title}</div>
              <div className="truncate text-sm text-gray-300">{item.authors.join(", ") || "No author"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {candidate && <ScoreBar score={candidate.score} />}
                <span className="line-clamp-1 text-xs text-gray-400">{book.reasons[0]}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-400">No good guess. Search your library to pick one.</div>
        )}
      </div>

      <div className="relative z-10 flex flex-shrink-0 flex-wrap gap-2 p-4 pt-0 xl:flex-col xl:pt-4">
        {item && (
          <button className="btn btn-sm btn-success flex-1" disabled={busy} onClick={() => decide("match")}>
            <CheckIcon className="h-4 w-4" /> Approve
          </button>
        )}
        <button className="btn btn-sm btn-default flex-1" disabled={busy} onClick={onOpen}>
          <MagnifyingGlassIcon className="h-4 w-4" /> Choose
        </button>
        <button className="btn btn-sm btn-default flex-1" disabled={busy} onClick={() => decide("missing")}>
          <XMarkIcon className="h-4 w-4" /> Not mine
        </button>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { data, error, loading, reload } = useApi<Book[]>("/review");
  const [open, setOpen] = useState<Book | null>(null);

  return (
    <div>
      <PageTitle>Review</PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-gray-400">
        These books might be in your library, but Shelfhelper isn't sure enough to add them on its own. Your choice applies to every
        list the book is on and is remembered for future syncs.
      </p>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.length === 0 && (
        <Empty icon={<ClipboardDocumentCheckIcon className="h-16 w-16" />} title="All caught up">
          Nothing needs a decision right now.
        </Empty>
      )}
      <div className="space-y-4">
        {data?.map((b) => (
          <ReviewRow key={`${b.hcBookId}:${b.libraryId}`} book={b} onOpen={() => setOpen(b)} onDone={reload} />
        ))}
      </div>
      <BookModal book={open} libraryId={open?.libraryId ?? ""} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
