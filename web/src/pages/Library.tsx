import { useEffect, useState } from "react";
import { ArrowPathIcon, ArrowRightIcon, EyeSlashIcon, LinkIcon, LinkSlashIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api, duration, sentences, type HcBookRef, type LinkPage, type LinkRow, type LinkStatus, type SearchHit, type Status } from "../lib/api";
import { jobStarted, useApi, useDebounced, useJobs, useStoredState } from "../lib/hooks";
import { Cover, Empty, ErrorBlock, LoadingBlock, Modal, PageTitle, Spinner } from "../components/ui";
import { useToast } from "../components/toast";
import { HcRow } from "./Reading";

const STATUS: Record<LinkStatus, { label: string; badge: string }> = {
  matched: { label: "Linked", badge: "badge-success" },
  review: { label: "Check", badge: "badge-warning" },
  missing: { label: "Not found", badge: "badge-danger" },
  ignored: { label: "Ignored", badge: "badge-dark" },
  unchecked: { label: "Not checked yet", badge: "badge-dark" },
};

function LinkModal({ row, onClose, onChanged }: { row: LinkRow | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    setQ(row ? `${row.item.title} ${row.item.authors[0] ?? ""}`.trim() : "");
  }, [row]);
  useEffect(() => {
    if (!dq.trim()) return setHits(null);
    let alive = true;
    api<SearchHit[]>(`/hardcover/search?q=${encodeURIComponent(dq)}`)
      .then((h) => alive && setHits(h))
      .catch(() => alive && setHits([]));
    return () => {
      alive = false;
    };
  }, [dq]);
  if (!row) return null;

  const decide = async (action: "match" | "ignore" | "missing" | "reset", book?: HcBookRef) => {
    setBusy(true);
    try {
      await api("/library/decisions", { method: "POST", body: { absItemId: row.absItemId, action, hcBookId: book?.id, hcBook: book } });
      toast(action === "match" ? `Linked to ${book!.title}` : action === "reset" ? "Looking it up again" : "Saved");
      if (action === "reset") jobStarted();
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!row.hcBook) return;
    const hcBookId = row.hcBook.id;
    setBusy(true);
    try {
      await api("/library/unlink", { method: "POST", body: { absItemId: row.absItemId, hcBookId } });
      toast(
        <span>
          Unlinked from {row.hcBook.title}. Looking it up again.{" "}
          <button
            className="font-semibold text-indigo-300 underline"
            onClick={async () => {
              await api("/library/relink", { method: "POST", body: { absItemId: row.absItemId, hcBookId } }).catch(() => {});
              toast("Undone. It may be linked again on the next check.", "info");
              onChanged();
            }}
          >
            Undo
          </button>
        </span>,
      );
      jobStarted();
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const others = row.candidates.filter((c) => c.id !== row.hcBook?.id);
  return (
    <Modal
      open
      onClose={onClose}
      size="max-w-3xl"
      backdrop={row.item.coverUrl}
      footer={
        <>
          <button className="btn btn-default" onClick={() => decide("reset")} disabled={busy}>
            <ArrowPathIcon className="h-4 w-4" /> Match again
          </button>
          {row.hcBook && (
            <button className="btn btn-default" onClick={unlink} disabled={busy} title="These are different books. Unlink them everywhere.">
              <LinkSlashIcon className="h-4 w-4" /> Not this book
            </button>
          )}
          <button className="btn btn-default" onClick={() => decide("missing")} disabled={busy}>
            <XMarkIcon className="h-4 w-4" /> Not on Hardcover
          </button>
          <button className="btn btn-default" onClick={() => decide("ignore")} disabled={busy}>
            <EyeSlashIcon className="h-4 w-4" /> Ignore
          </button>
          {row.status === "review" && row.hcBook && (
            <button className="btn btn-success" onClick={() => decide("match", row.hcBook!)} disabled={busy}>
              <LinkIcon className="h-4 w-4" /> Approve link
            </button>
          )}
        </>
      }
    >
      <div className="flex gap-4 pt-5">
        <Cover src={row.item.coverUrl} alt={row.item.title} className="h-28 w-28 flex-shrink-0 rounded-lg ring-1 ring-gray-700" />
        <div className="min-w-0 flex-1 pr-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">In Audiobookshelf</div>
          <h2 className="mt-1 text-2xl font-bold leading-tight text-white">{row.item.title}</h2>
          <div className="text-gray-300">{row.item.authors.join(", ")}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-400">
            {row.item.narrators.length > 0 && <span>Narrated by {row.item.narrators.join(", ")}</span>}
            {duration(row.item.duration) && <span>{duration(row.item.duration)}</span>}
            {row.item.asin && <span>ASIN {row.item.asin}</span>}
            {row.item.isbn && <span>ISBN {row.item.isbn}</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`badge ${STATUS[row.status].badge}`}>{STATUS[row.status].label}</span>
            {row.reasons.length > 0 && <span className="text-xs text-gray-400">{sentences(row.reasons)}</span>}
          </div>
        </div>
      </div>
      {row.hcBook && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">{row.status === "matched" ? "Linked on Hardcover" : "Best guess"}</h4>
          <HcRow book={row.hcBook} candidate={row.candidates.find((c) => c.id === row.hcBook!.id)} current={row.status === "matched"} />
        </div>
      )}
      {others.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Other possibilities</h4>
          <div className="space-y-2">
            {others.map((c) => (
              <HcRow key={c.id} book={c} candidate={c} busy={busy} onUse={() => decide("match", c)} />
            ))}
          </div>
        </div>
      )}
      <div className="mt-6">
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Search Hardcover</h4>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author, or a Hardcover link" />
        <div className="mt-2 space-y-2">
          {hits === null && dq && <Spinner className="h-5 w-5" />}
          {hits?.slice(0, 6).map((h) => (
            <HcRow
              key={h.id}
              book={{ ...h, seriesPosition: typeof h.seriesPosition === "number" ? h.seriesPosition : null }}
              mine={h.mine ?? null}
              busy={busy}
              onUse={() => decide("match", { ...h, seriesPosition: typeof h.seriesPosition === "number" ? h.seriesPosition : null })}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function LibraryPage({ status }: { status: Status }) {
  const toast = useToast();
  const [filter, setFilter] = useState<LinkStatus | "all">("all");
  const [library, setLibrary] = useStoredState<string>("library.lib", "all");
  const { data: libs } = useApi<{ id: string; name: string }[]>("/abs/libraries");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [limit, setLimit] = useState(1);
  const jobs = useJobs();
  const job = jobs?.running.find((j) => j.id === "library") ?? null;
  const last = jobs?.last.library ?? null;
  const libKnown = library === "all" || !libs || libs.some((l) => l.id === library);
  const lib = libKnown ? library : "all";
  const path = `/library/links?status=${filter}&q=${encodeURIComponent(dq)}${lib !== "all" ? `&library=${encodeURIComponent(lib)}` : ""}`;
  const { data, error, loading, reload } = useApi<LinkPage>(path, { poll: job ? 5000 : false });
  const [more, setMore] = useState<LinkRow[]>([]);
  const [open, setOpen] = useState<LinkRow | null>(null);
  useEffect(() => {
    setMore([]);
    setLimit(1);
  }, [path]);
  useEffect(() => {
    if (!job) reload();
  }, [job, reload]);

  const start = async () => {
    try {
      const r = await api<{ result: string }>("/library/link", { method: "POST", body: {} });
      toast(r.result === "running" ? "Already linking" : "Linking your library in the background");
      jobStarted();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const loadMore = async () => {
    const page = await api<LinkPage>(`${path}&offset=${(data?.rows.length ?? 0) + more.length}`);
    setMore((m) => [...m, ...page.rows]);
    setLimit((l) => l + 1);
  };

  const c = data?.counts;
  const total = c ? c.matched + c.review + c.missing + c.ignored + c.unchecked : 0;
  const rows = [...(data?.rows ?? []), ...more];
  const chips: [LinkStatus | "all", string, number | undefined][] = [
    ["all", "All", total],
    ["matched", "Linked", c?.matched],
    ["review", "Check", c?.review],
    ["missing", "Not found", c?.missing],
    ["unchecked", "Not checked", c?.unchecked],
    ["ignored", "Ignored", c?.ignored],
  ];

  if (!status.configured.abs || !status.configured.hardcover) {
    return <Empty title="Set up Hardcover and Audiobookshelf first" />;
  }

  return (
    <div>
      <PageTitle
        extra={
          <button className="btn btn-primary" onClick={start} disabled={!!job}>
            <ArrowPathIcon className={`h-5 w-5 ${job ? "animate-spin" : ""}`} /> {job ? "Linking..." : "Link now"}
          </button>
        }
      >
        Library
      </PageTitle>
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-gray-400">
        Every Audiobookshelf book linked to its Hardcover book, so search and Discover can tell you what you already have. Runs after each sync, and
        only looks up books that are new or changed. Matches here, in Reading and in Collections are shared.
      </p>
      {libs && libs.length > 1 && (
        <div className="mb-4 flex max-w-5xl gap-1 overflow-x-auto border-b border-gray-700">
          {[{ id: "all", name: "All libraries" }, ...libs].map((l) => {
            const n = l.id === "all" ? undefined : data?.libraries?.[l.id];
            return (
              <button
                key={l.id}
                onClick={() => setLibrary(l.id)}
                className={`-mb-px flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition ${
                  lib === l.id ? "border-indigo-500 text-white" : "border-transparent text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                {l.name}
                {n !== undefined && <span className="rounded-full bg-gray-700 px-1.5 text-xs font-medium text-gray-300">{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      {c && total > 0 && (
        <div className="mb-5 max-w-3xl">
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-700">
            <div className="bg-green-500" style={{ width: `${(c.matched / total) * 100}%` }} />
            <div className="bg-yellow-500" style={{ width: `${(c.review / total) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(c.missing / total) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {Math.round((c.matched / total) * 100)}% linked
            {job ? ` · ${job.phase}${job.total ? ` (${job.current}/${job.total})` : ""}` : last ? ` · Last run: ${last.message}` : ""}
          </p>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chips.map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 transition ${
              filter === id ? "bg-indigo-600 text-white ring-indigo-500" : "bg-gray-800 text-gray-300 ring-gray-600 hover:bg-gray-700"
            }`}
          >
            {label}
            {n !== undefined && <span className={`rounded-full px-1.5 text-xs ${filter === id ? "bg-indigo-400/40" : "bg-gray-700"}`}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="relative mb-4 max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="Filter by title or author" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && rows.length === 0 && <Empty title="Nothing here">{total ? "No books in this group." : "Run Link now to start."}</Empty>}
      <ul className="max-w-5xl divide-y divide-gray-700 overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
        {rows.map((r) => (
          <li key={r.absItemId}>
            <button className="flex w-full items-center gap-3 p-3 text-left hover:bg-gray-700/50" onClick={() => setOpen(r)}>
              <Cover src={r.item.coverUrl} alt={r.item.title} className="h-12 w-12 flex-shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{r.item.title}</div>
                <div className="truncate text-xs text-gray-400">{r.item.authors.join(", ")}</div>
              </div>
              <ArrowRightIcon className="hidden h-4 w-4 flex-shrink-0 text-gray-500 sm:block" />
              <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
                {r.hcBook ? (
                  <>
                    <Cover src={r.hcBook.coverUrl} alt={r.hcBook.title} className="h-12 w-8 flex-shrink-0 rounded" />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-gray-200">{r.hcBook.title}</div>
                      <div className="truncate text-xs text-gray-500">{r.hcBook.authors.join(", ")}</div>
                    </div>
                  </>
                ) : (
                  <span className="text-sm text-gray-500">No Hardcover book</span>
                )}
              </div>
              <span className={`badge ${STATUS[r.status].badge} flex-shrink-0`}>{STATUS[r.status].label}</span>
            </button>
          </li>
        ))}
      </ul>
      {data && rows.length < data.total && (
        <button className="btn btn-default mt-4" onClick={loadMore} key={limit}>
          Show more ({data.total - rows.length} left)
        </button>
      )}
      <LinkModal
        row={open}
        onClose={() => setOpen(null)}
        onChanged={() => {
          setMore([]);
          reload();
        }}
      />
    </div>
  );
}
