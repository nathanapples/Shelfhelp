import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeftIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { tagLink, type TagKind } from "../lib/api";
import { useAllTags } from "../components/TagSearch";
import { ErrorBlock, LoadingBlock, PageTitle, Tabs } from "../components/ui";

/** Every genre or mood on Hardcover. Each opens its own page of top books. */
export default function BrowsePage() {
  const { kind: k = "genre" } = useParams();
  const kind: TagKind = k === "mood" ? "mood" : "genre";
  const navigate = useNavigate();
  const { tags, error } = useAllTags(kind);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const want = q.trim().toLowerCase();
    return (tags ?? []).filter((t) => !want || t.name.toLowerCase().includes(want));
  }, [tags, q]);

  return (
    <div>
      <PageTitle>
        <Link to="/" className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white">
          <ChevronLeftIcon className="h-4 w-4" /> Discover
        </Link>
        {kind === "genre" ? "All genres" : "All moods"}
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-gray-400">
        Every {kind} on Hardcover with at least a few books, most books first. Pick one to see its top books.
      </p>
      <Tabs<TagKind>
        value={kind}
        onChange={(v) => navigate(`/browse/${v}`, { replace: true })}
        tabs={[
          { id: "genre", label: "Genres" },
          { id: "mood", label: "Moods" },
        ]}
      />
      <div className="relative my-4 max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder={`Filter ${kind === "genre" ? "genres" : "moods"}`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorBlock message={error} />}
      {!tags && !error && <LoadingBlock />}
      {tags && shown.length === 0 && <p className="text-sm text-gray-500">Nothing matches "{q}".</p>}
      <div className="flex flex-wrap gap-2">
        {shown.map((t) => (
          <Link
            key={t.slug}
            to={tagLink(kind, t)}
            className="flex items-center gap-2 rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-200 ring-1 ring-gray-600 transition hover:bg-gray-700 hover:text-white"
          >
            {t.name}
            <span className="text-xs text-gray-500">{t.count.toLocaleString()}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
