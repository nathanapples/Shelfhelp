import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeftIcon, HeartIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { listLink, tagLink, type TagKind, type TopList } from "../lib/api";
import { useAllTags } from "../components/TagSearch";
import { useApi, useDebounced } from "../lib/hooks";
import { Cover, ErrorBlock, LoadingBlock, PageTitle, Spinner, Tabs } from "../components/ui";

type Kind = TagKind | "lists";

/** Hardcover's top 30 lists, or lists matching a search. Each opens as a Discover row page. */
function Lists() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const { data, error, loading } = useApi<TopList[]>(dq ? `/browse/lists?q=${encodeURIComponent(dq)}` : "/browse/lists");
  return (
    <>
      <div className="relative my-4 max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="Search all Hardcover lists" value={q} onChange={(e) => setQ(e.target.value)} />
        {loading && data && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />}
      </div>
      {error && <ErrorBlock message={error} />}
      {!data && !error && <LoadingBlock />}
      {data && data.length === 0 && <p className="text-sm text-gray-500">No lists match "{dq}".</p>}
      <ul className="grid max-w-5xl gap-2 sm:grid-cols-2">
        {data?.map((l) => (
          <li key={l.id}>
            <Link to={listLink(l)} className="flex items-center gap-3 rounded-xl bg-gray-800 p-3 ring-1 ring-gray-700 transition hover:bg-gray-700/70">
              {l.coverUrls.length > 0 && (
                <div className="flex flex-shrink-0 -space-x-5">
                  {l.coverUrls.slice(0, 3).map((u, i) => (
                    <Cover key={i} src={u} alt="" className="h-14 w-10 rounded ring-2 ring-gray-800" />
                  ))}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-white">{l.name}</div>
                <div className="flex items-center gap-2 truncate text-xs text-gray-400">
                  {l.owner && <span>@{l.owner}</span>}
                  <span>{l.booksCount.toLocaleString()} books</span>
                  {l.likesCount > 0 && (
                    <span className="flex items-center gap-0.5">
                      <HeartIcon className="h-3.5 w-3.5" /> {l.likesCount.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Tags({ kind }: { kind: TagKind }) {
  const { tags, error } = useAllTags(kind);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const want = q.trim().toLowerCase();
    return (tags ?? []).filter((t) => !want || t.name.toLowerCase().includes(want));
  }, [tags, q]);
  return (
    <>
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
    </>
  );
}

/** Every genre or mood on Hardcover, or its top lists. Each opens its own page of books. */
export default function BrowsePage() {
  const { kind: k = "genre" } = useParams();
  const kind: Kind = k === "mood" ? "mood" : k === "lists" ? "lists" : "genre";
  const navigate = useNavigate();
  const title = kind === "genre" ? "All genres" : kind === "mood" ? "All moods" : "All lists";
  const blurb =
    kind === "lists"
      ? "Hardcover's 30 most liked lists. Search to find any other list."
      : `Every ${kind} on Hardcover with at least a few books, most books first. Pick one to see its top books.`;

  return (
    <div>
      <PageTitle>
        <Link to="/" className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white">
          <ChevronLeftIcon className="h-4 w-4" /> Discover
        </Link>
        {title}
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-gray-400">{blurb}</p>
      <Tabs<Kind>
        value={kind}
        onChange={(v) => navigate(`/browse/${v}`, { replace: true })}
        tabs={[
          { id: "genre", label: "Genres" },
          { id: "mood", label: "Moods" },
          { id: "lists", label: "Lists" },
        ]}
      />
      {kind === "lists" ? <Lists /> : <Tags key={kind} kind={kind} />}
    </div>
  );
}
