import { useSearchParams } from "react-router-dom";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { SearchHit } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { Empty, ErrorBlock, LoadingBlock, PageTitle } from "../components/ui";

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, error, loading } = useApi<SearchHit[]>(q ? `/hardcover/search?q=${encodeURIComponent(q)}` : null);

  return (
    <div>
      <PageTitle>Search Results</PageTitle>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.length === 0 && (
        <Empty icon={<MagnifyingGlassIcon className="h-16 w-16" />} title="No results">
          Nothing on Hardcover matches "{q}".
        </Empty>
      )}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        {data?.map((b) => (
          <li key={b.id}>
            <BookCard
              width="w-full"
              book={{ ...b, status: b.absItemId ? "matched" : null }}
              actionLabel="View on Hardcover"
              onClick={() => b.slug && window.open(`https://hardcover.app/books/${b.slug}`, "_blank", "noreferrer")}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
