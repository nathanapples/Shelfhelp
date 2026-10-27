import { useState, type ReactNode } from "react";
import type { BookStatus } from "../lib/api";
import { Cover, StatusDot, statusMeta } from "./ui";

export interface CardBook {
  title: string;
  authors: string[];
  coverUrl: string | null;
  releaseYear?: number | null;
  seriesName?: string | null;
  seriesPosition?: number | null;
  status?: BookStatus | null;
}

/** A Seerr-style poster card: cover, status in the corner, details on hover. */
export function BookCard({
  book,
  onClick,
  actionLabel,
  pill = "Book",
  width = "w-36 sm:w-40 md:w-44",
  corner,
  note,
  fit = "cover",
}: {
  book: CardBook;
  onClick?: () => void;
  actionLabel?: string;
  pill?: string;
  width?: string;
  /** Replaces the status dot in the top corner. */
  corner?: ReactNode;
  /** A line under the title in the hover details. */
  note?: ReactNode;
  /** "contain" for square audiobook covers. */
  fit?: "cover" | "contain";
}) {
  const [hover, setHover] = useState(false);
  return (
    <div className={`${width} flex-shrink-0`}>
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={`relative block w-full transform-gpu cursor-pointer overflow-hidden rounded-xl bg-gray-800 bg-cover text-left outline-none ring-1 transition duration-300 ${
          hover ? "scale-105 shadow-lg ring-gray-500" : "scale-100 shadow ring-gray-700"
        }`}
        style={{ paddingBottom: "150%" }}
      >
        <div className="absolute inset-0 h-full w-full overflow-hidden">
          <Cover src={book.coverUrl} alt={book.title} fit={fit} className={`absolute inset-0 h-full w-full ${fit === "contain" ? "bg-gray-900" : ""}`} />
          <div className="absolute left-0 right-0 flex items-center justify-between p-2">
            <span className="pointer-events-none rounded-full border border-purple-600 bg-purple-600/80 px-2 text-[10px] font-semibold uppercase leading-5 tracking-wider text-white shadow-md">
              {pill}
            </span>
            {corner ?? (book.status && <StatusDot status={book.status} className="h-5 w-5" />)}
          </div>
          <div
            className={`absolute inset-0 flex flex-col justify-end bg-gray-800/80 p-3 transition-opacity duration-300 ${
              hover ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="pb-1">
              {book.releaseYear && <div className="text-sm font-medium text-white">{book.releaseYear}</div>}
              <h3 className="line-clamp-3 text-lg font-bold leading-6 text-white">{book.title}</h3>
              <div className="mt-1 line-clamp-2 text-xs text-gray-300">{book.authors.join(", ")}</div>
              {book.seriesName && (
                <div className="mt-1 line-clamp-1 text-xs text-gray-400">
                  {book.seriesName}
                  {book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}
                </div>
              )}
              {book.status && (
                <div className="mt-2 text-xs font-semibold text-gray-200">{statusMeta[book.status].label}</div>
              )}
              {note && <div className="mt-2 text-xs font-semibold text-gray-200">{note}</div>}
            </div>
            {actionLabel && (
              <span className="btn btn-sm btn-primary mt-2 w-full">{actionLabel}</span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}
