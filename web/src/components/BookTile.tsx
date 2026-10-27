import type { SearchHit, Status } from "../lib/api";
import { BookCard } from "./BookCard";
import { requestMeta, topRequest } from "./Request";

/** A Hardcover book as a poster, with its library and request status. */
export function BookTile({
  book,
  status,
  onOpen,
  width,
  pill,
  fit,
}: {
  book: SearchHit;
  status: Status;
  onOpen: () => void;
  width?: string;
  pill?: string;
  fit?: "cover" | "contain";
}) {
  const req = topRequest(book.requests);
  const meta = req ? requestMeta[req] : null;
  return (
    <BookCard
      width={width}
      pill={pill}
      fit={fit}
      book={{ ...book, status: book.absItemId ? "matched" : null }}
      actionLabel={book.absItemId ? "In your library" : status.requestsEnabled && (!req || req === "failed") ? "Request" : "Details"}
      note={!book.absItemId && meta ? meta.label : null}
      corner={
        meta && !book.absItemId ? (
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-white shadow ring-1 ${
              req === "failed" ? "bg-red-600 ring-red-400" : req === "pending" ? "bg-yellow-500 ring-yellow-300" : "bg-indigo-500 ring-indigo-300"
            }`}
            title={meta.label}
          >
            <meta.icon className="h-3.5 w-3.5" />
          </span>
        ) : undefined
      }
      onClick={onOpen}
    />
  );
}
