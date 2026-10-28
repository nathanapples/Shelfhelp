import { useState } from "react";
import { ChatBubbleLeftRightIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { isAdmin, timeAgo, utc, type Issue, type Status } from "../lib/api";
import { useApi, useStoredState } from "../lib/hooks";
import { IssueStatusBadge, IssueThread } from "../components/Issues";
import { Cover, Empty, ErrorBlock, LoadingBlock, PageTitle } from "../components/ui";

const VIEWS = ["open", "resolved", "all"] as const;
type View = (typeof VIEWS)[number];

export default function IssuesPage({ status }: { status: Status }) {
  const [view, setView] = useStoredState<View>("issues.view", "open", VIEWS);
  const { data, error, loading, reload } = useApi<{ issues: Issue[]; counts: { open: number; resolved: number } }>(`/issues?status=${view}`, {
    poll: 30000,
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const c = data?.counts;
  const label: Record<View, string> = {
    open: `Open${c ? ` (${c.open})` : ""}`,
    resolved: `Resolved${c ? ` (${c.resolved})` : ""}`,
    all: `All issues${c ? ` (${c.open + c.resolved})` : ""}`,
  };

  return (
    <div>
      <PageTitle
        extra={
          <select className="input w-auto" value={view} onChange={(e) => setView(e.target.value as View)} aria-label="Show">
            {VIEWS.map((v) => (
              <option key={v} value={v}>
                {label[v]}
              </option>
            ))}
          </select>
        }
      >
        Issues
      </PageTitle>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && data.issues.length === 0 && (
        <Empty icon={<ExclamationTriangleIcon className="h-16 w-16" />} title={view === "open" ? "No open issues" : "Nothing here"}>
          To report a problem with a book, open it and choose Report an issue.
        </Empty>
      )}
      <ul className="max-w-4xl space-y-3">
        {data?.issues.map((i) => (
          <li key={i.id}>
            <button className="card flex w-full gap-3 p-3 text-left transition hover:ring-gray-500 sm:gap-4 sm:p-4" onClick={() => setOpenId(i.id)}>
              <Cover src={i.coverUrl} alt={i.title} className="h-20 w-14 flex-shrink-0 rounded-md ring-1 ring-gray-700" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-white">{i.title}</span>
                  <IssueStatusBadge status={i.status} />
                  <span className="badge badge-dark">{i.kindLabel}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-gray-300">{i.summary}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
                  <span>
                    Reported by {i.createdBy} {timeAgo(utc(i.createdAt))}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" /> {i.comments}
                  </span>
                  {i.status === "resolved" && i.resolvedBy && <span>Resolved by {i.resolvedBy}</span>}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {openId !== null && <IssueThread id={openId} admin={isAdmin(status)} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
