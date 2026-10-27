import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PlusIcon, RectangleStackIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { timeAgo, type List, type ListDetail, type Status } from "../lib/api";
import { useApi } from "../lib/hooks";
import { BookCard } from "../components/BookCard";
import { Slider } from "../components/Slider";
import { AddListModal } from "../components/AddListModal";
import { Empty, ErrorBlock, LoadingBlock, PageTitle, Spinner } from "../components/ui";

function Counts({ list }: { list: List }) {
  return (
    <div className="hidden flex-wrap items-center gap-1.5 md:flex">
      <span className="badge badge-success">{list.counts.matched} in library</span>
      {list.counts.review > 0 && <span className="badge badge-warning">{list.counts.review} to review</span>}
      {list.counts.missing > 0 && <span className="badge badge-dark">{list.counts.missing} missing</span>}
      {list.syncing ? (
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Spinner className="h-3.5 w-3.5" /> syncing
        </span>
      ) : list.lastStatus === "error" ? (
        <span className="badge badge-danger" title={list.lastError ?? ""}>
          sync failed
        </span>
      ) : (
        <span className="text-xs text-gray-500">synced {timeAgo(list.lastSyncedAt)}</span>
      )}
    </div>
  );
}

function ListRow({ list }: { list: List }) {
  const navigate = useNavigate();
  const { data } = useApi<ListDetail>(`/lists/${list.id}`, { poll: list.syncing ? 3000 : false });
  const books = data?.books ?? [];
  return (
    <Slider title={list.name} to={`/lists/${list.id}`} extra={<Counts list={list} />}>
      {!data &&
        Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-36 flex-shrink-0 sm:w-40 md:w-44">
            <div className="animate-pulse rounded-xl bg-gray-800 ring-1 ring-gray-700" style={{ paddingBottom: "150%" }} />
          </div>
        ))}
      {data && books.length === 0 && (
        <div className="py-10 text-sm text-gray-500">{list.syncing ? "Fetching the list..." : "This list is empty."}</div>
      )}
      {books.slice(0, 20).map((b) => (
        <BookCard key={b.hcBookId} book={b} onClick={() => navigate(`/lists/${list.id}?book=${b.hcBookId}`)} />
      ))}
      {books.length > 20 && (
        <Link
          to={`/lists/${list.id}`}
          className="flex w-36 flex-shrink-0 items-center justify-center rounded-xl bg-gray-800 text-center text-sm font-semibold text-gray-300 ring-1 ring-gray-700 hover:text-white hover:ring-gray-500 sm:w-40 md:w-44"
        >
          See all {books.length}
        </Link>
      )}
    </Slider>
  );
}

export default function ListsPage({ status }: { status: Status }) {
  const [adding, setAdding] = useState(false);
  const anySyncing = (l: List[] | null) => !!l?.some((x) => x.syncing);
  const [poll, setPoll] = useState<number | false>(false);
  const { data: lists, error, loading, reload } = useApi<List[]>("/lists", { poll });

  useEffect(() => setPoll(anySyncing(lists) ? 3000 : 20000), [lists]);

  const configured = status.configured.hardcover && status.configured.abs;

  if (!configured) {
    return (
      <Empty icon={<Cog6ToothIcon className="h-16 w-16" />} title="Welcome to Shelfhelper">
        <p>Connect Hardcover and Audiobookshelf to start syncing your lists into collections.</p>
        <Link to="/settings" className="btn btn-primary mt-6">
          Open Settings
        </Link>
      </Empty>
    );
  }

  return (
    <div>
      <PageTitle
        extra={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <PlusIcon className="h-5 w-5" /> Add List
          </button>
        }
      >
        Lists
      </PageTitle>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {lists?.length === 0 && (
        <Empty icon={<RectangleStackIcon className="h-16 w-16" />} title="No lists yet">
          <p>Add a Hardcover list and Shelfhelper will keep an Audiobookshelf collection in step with it.</p>
          <button className="btn btn-primary mt-6" onClick={() => setAdding(true)}>
            <PlusIcon className="h-5 w-5" /> Add your first list
          </button>
        </Empty>
      )}
      {lists?.map((l) => <ListRow key={l.id} list={l} />)}
      <AddListModal
        open={adding}
        onClose={() => {
          setAdding(false);
          reload();
        }}
        existing={lists ?? []}
      />
    </div>
  );
}
