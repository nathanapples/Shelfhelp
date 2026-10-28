import { useEffect, useState } from "react";
import { BookmarkIcon } from "@heroicons/react/24/outline";
import { api } from "../lib/api";
import { useToast } from "./toast";

type Shelf = { statusName: string; progress?: number | null } | null | undefined;

/**
 * Adds a book to your own Hardcover Want to Read shelf. `shelf` is what
 * Shelfhelp already knows; once the book is on any shelf there's nothing to add.
 */
export function useWantToRead(bookId: number, title: string, shelf: Shelf) {
  const toast = useToast();
  const [onShelf, setOnShelf] = useState<string | null>(shelf?.statusName ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOnShelf(shelf?.statusName ?? null), [bookId, shelf?.statusName]);
  const add = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: boolean; statusName: string }>("/me/want-to-read", { method: "POST", body: { hcBookId: bookId } });
      setOnShelf(r.statusName);
      toast(r.added ? `Added ${title} to your Want to Read` : `${title} is already on your ${r.statusName} shelf`, r.added ? "success" : "info");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return { onShelf, busy, add };
}

export const WantIcon = ({ className = "h-4 w-4" }: { className?: string }) => <BookmarkIcon className={className} />;
