import type { SearchHit, Status } from "../lib/api";
import { BookCard } from "./BookCard";
import { WantIcon, useWantToRead } from "./WantToRead";
import { requestMeta, topRequest } from "./Request";

/** A Hardcover book as a poster, with its library and request status. */
export function BookTile({
  book,
  status,
  onOpen,
  width,
  pill,
  fit,
  size,
}: {
  book: SearchHit;
  status: Status;
  onOpen: () => void;
  width?: string;
  pill?: string;
  fit?: "cover" | "contain";
  size?: "sm" | "md";
}) {
  const req = topRequest(book.requests);
  const want = useWantToRead(book.id, book.title, book.mine);
  // Only for people who've connected Hardcover, and books not on any of their shelves yet.
  const canWant = !!status.user?.hasHardcover && book.id > 0 && !want.onShelf;
  const meta = req ? requestMeta[req] : null;
  return (
    <BookCard
      width={width}
      pill={pill}
      fit={fit}
      size={size}
      secondary={canWant ? { label: want.busy ? "Adding..." : "Want to Read", icon: <WantIcon className="h-3.5 w-3.5" />, onClick: want.add, disabled: want.busy } : null}
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
