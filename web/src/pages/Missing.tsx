import { useState } from "react";
import { CheckBadgeIcon } from "@heroicons/react/24/outline";
import type { Book } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { BookModal } from "../components/BookModal";
import { Empty, ErrorBlock, LoadingBlock, PageTitle, Tabs } from "../components/ui";

export default function MissingPage() {
  const [tab, setTab] = useState<"missing" | "ignored">("missing");
  const { data, error, loading, reload } = useApi<Book[]>(`/${tab}`);
  const counts = useApi<Record<string, number>>("/counts");
  const [open, setOpen] = useState<Book | null>(null);

  return (
    <div>
      <PageTitle>Not in Library</PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-gray-400">
        Books on your lists that Shelfhelper couldn't find in Audiobookshelf. If one is actually there, open it and pick the right
        item. Requesting missing books through Chaptarr is planned.
      </p>
      <Tabs
        value={tab}
        onChange={(t) => setTab(t)}
        tabs={[
          { id: "missing", label: "Not in Library", count: counts.data?.missing ?? 0 },
          { id: "ignored", label: "Ignored", count: counts.data?.ignored ?? 0 },
        ]}
      />
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.length === 0 && (
        <Empty icon={<CheckBadgeIcon className="h-16 w-16" />} title={tab === "missing" ? "You have everything" : "Nothing ignored"}>
          {tab === "missing" ? "Every book on your lists is in your library or waiting for review." : "Books you ignore show up here."}
        </Empty>
      )}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        {data?.map((b) => (
          <li key={`${b.hcBookId}:${b.libraryId}`}>
            <BookCard book={b} width="w-full" actionLabel="Details" onClick={() => setOpen(b)} />
          </li>
        ))}
      </ul>
      <BookModal
        book={open}
        libraryId={open?.libraryId ?? ""}
        onClose={() => setOpen(null)}
        onChanged={() => {
          reload();
          counts.reload();
        }}
      />
    </div>
  );
}
