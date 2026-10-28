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

/** A second button on the hover details, such as "Want to Read". */
export interface CardAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/** A Seerr-style poster card: cover, status in the corner, details on hover. */
export function BookCard({
  book,
  onClick,
  actionLabel,
  secondary,
  pill = "Book",
  width = "w-36 sm:w-40 md:w-44",
  corner,
  note,
  fit = "cover",
  size = "md",
}: {
  book: CardBook;
  onClick?: () => void;
  actionLabel?: string;
  secondary?: CardAction | null;
  pill?: string;
  width?: string;
  /** Replaces the status dot in the top corner. */
  corner?: ReactNode;
  /** A line under the title in the hover details. */
  note?: ReactNode;
  /** "contain" for square audiobook covers. */
  fit?: "cover" | "contain";
  /** "sm" for the smaller posters on Discover. */
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  const [hover, setHover] = useState(false);
  // The card and its buttons are siblings (not nested), so each button works on its own.
  return (
    <div className={`${width} flex-shrink-0`}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHover(false)}
        className={`relative w-full transform-gpu overflow-hidden rounded-xl bg-gray-800 ring-1 transition duration-300 ${
          hover ? "scale-105 shadow-lg ring-gray-500" : "scale-100 shadow ring-gray-700"
        }`}
        style={{ paddingBottom: "150%" }}
      >
        <button type="button" onClick={onClick} className="absolute inset-0 block h-full w-full cursor-pointer overflow-hidden text-left outline-none" aria-label={book.title}>
          <Cover src={book.coverUrl} alt={book.title} fit={fit} className={`absolute inset-0 h-full w-full ${fit === "contain" ? "bg-gray-900" : ""}`} />
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-2">
            <span
              className={`pointer-events-none rounded-full border border-purple-600 bg-purple-600/80 font-semibold uppercase tracking-wider text-white shadow-md ${
                sm ? "px-1.5 text-[8px] leading-4" : "px-2 text-[10px] leading-5"
              }`}
            >
              {pill}
            </span>
            {corner ?? (book.status && <StatusDot status={book.status} className={sm ? "h-4 w-4" : "h-5 w-5"} />)}
          </div>
          <div
            className={`absolute inset-0 flex flex-col justify-end bg-gray-800/80 transition-opacity duration-300 ${sm ? "p-2" : "p-3"} ${
              hover ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="pb-1">
              {book.releaseYear && <div className={`font-medium text-white ${sm ? "text-[11px]" : "text-sm"}`}>{book.releaseYear}</div>}
              <h3 className={`font-bold text-white ${sm ? "line-clamp-3 text-sm leading-4" : "line-clamp-3 text-lg leading-6"}`}>{book.title}</h3>
              <div className={`mt-1 line-clamp-2 text-gray-300 ${sm ? "text-[10px] leading-3" : "text-xs"}`}>{book.authors.join(", ")}</div>
              {book.seriesName && !sm && (
                <div className="mt-1 line-clamp-1 text-xs text-gray-400">
                  {book.seriesName}
                  {book.seriesPosition != null ? ` #${book.seriesPosition}` : ""}
                </div>
              )}
              {book.status && (
                <div className={`font-semibold text-gray-200 ${sm ? "mt-1 text-[10px]" : "mt-2 text-xs"}`}>{statusMeta[book.status].label}</div>
              )}
              {note && <div className={`font-semibold text-gray-200 ${sm ? "mt-1 text-[10px]" : "mt-2 text-xs"}`}>{note}</div>}
            </div>
            {/* Room for the buttons below, which sit outside this button. */}
            {actionLabel && <div className={sm ? "h-6" : "h-8"} />}
            {secondary && <div className={sm ? "h-6" : "h-8"} />}
          </div>
        </button>
        {(actionLabel || secondary) && (
          <div
            className={`absolute bottom-0 left-0 right-0 flex flex-col gap-1 transition-opacity duration-300 ${sm ? "p-2 pt-0" : "p-3 pt-0"} ${
              hover ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {actionLabel && (
              <button type="button" tabIndex={-1} onClick={onClick} className={`btn btn-sm btn-primary w-full ${sm ? "px-1 py-0.5 text-[11px]" : ""}`}>
                {actionLabel}
              </button>
            )}
            {secondary && (
              <button
                type="button"
                onClick={secondary.onClick}
                disabled={secondary.disabled}
                className={`btn btn-sm btn-default w-full ${sm ? "px-1 py-0.5 text-[11px]" : ""}`}
              >
                {secondary.icon}
                {secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
