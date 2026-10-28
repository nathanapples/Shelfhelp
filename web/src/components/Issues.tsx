import { useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationTriangleIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api, timeAgo, utc, type IssueDetail } from "../lib/api";
import { Cover, Modal, Spinner } from "./ui";
import { useToast } from "./toast";

export const ISSUE_KINDS: [string, string][] = [
  ["audio", "Audio problem"],
  ["missing", "Missing or out-of-order chapters"],
  ["wrong", "Wrong book or edition"],
  ["metadata", "Wrong details or cover"],
  ["other", "Something else"],
];

export function IssueStatusBadge({ status }: { status: "open" | "resolved" }) {
  return status === "open" ? (
    <span className="badge badge-warning inline-flex items-center gap-1">
      <ExclamationTriangleIcon className="h-3.5 w-3.5" /> Open
    </span>
  ) : (
    <span className="badge badge-success inline-flex items-center gap-1">
      <CheckCircleIcon className="h-3.5 w-3.5" /> Resolved
    </span>
  );
}

/** Report a problem with a book. */
export function ReportIssue({
  book,
  onClose,
  onReported,
}: {
  book: { id: number; title: string };
  onClose: () => void;
  onReported: (issue: IssueDetail) => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState("audio");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const issue = await api<IssueDetail>("/issues", { method: "POST", body: { hcBookId: book.id, kind, body } });
      toast("Issue reported. An admin will take a look.");
      onReported(issue);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Report an issue"
      subtitle={book.title}
      footer={
        <>
          <button className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={send} disabled={busy || !body.trim()}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Report
          </button>
        </>
      }
    >
      <label className="mt-2 block text-sm font-medium text-gray-300">What kind of problem?</label>
      <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
        {ISSUE_KINDS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <label className="mt-4 block text-sm font-medium text-gray-300">What's wrong?</label>
      <textarea
        className="input mt-1 min-h-[7rem]"
        placeholder="e.g. Chapter 12 cuts off halfway, around 4:32:10"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}

/** One issue and its conversation. Admins can resolve, reopen and delete. */
export function IssueThread({ id, admin, onClose, onChanged }: { id: number; admin: boolean; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<IssueDetail>(`/issues/${id}`)
      .then(setIssue)
      .catch((e) => toast((e as Error).message, "error"));
  }, [id, toast]);

  const act = async (fn: () => Promise<IssueDetail | null>, done?: string) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setIssue(next);
      if (done) toast(done);
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const comment = () =>
    act(async () => {
      const next = await api<IssueDetail>(`/issues/${id}/comments`, { method: "POST", body: { body: reply } });
      setReply("");
      return next;
    });
  const setStatus = (status: "open" | "resolved") =>
    act(async () => {
      const next = await api<IssueDetail>(`/issues/${id}`, { method: "PUT", body: { status, comment: reply } });
      setReply("");
      return next;
    }, status === "resolved" ? "Issue resolved" : "Issue reopened");
  const remove = () =>
    act(async () => {
      await api(`/issues/${id}`, { method: "DELETE" });
      onClose();
      return null;
    }, "Issue deleted");

  return (
    <Modal
      open
      onClose={onClose}
      size="max-w-2xl"
      backdrop={issue?.coverUrl}
      footer={
        admin && issue ? (
          <button className="btn btn-ghost mr-auto text-red-300" onClick={remove} disabled={busy} title="Delete this issue">
            <TrashIcon className="h-4 w-4" /> Delete
          </button>
        ) : undefined
      }
    >
      {!issue ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="flex gap-4 pt-5">
            <Cover src={issue.coverUrl} alt={issue.title} className="h-24 w-16 flex-shrink-0 rounded-md ring-1 ring-gray-700" />
            <div className="min-w-0 flex-1 pr-8">
              <div className="flex flex-wrap items-center gap-2">
                <IssueStatusBadge status={issue.status} />
                <span className="badge badge-dark">{issue.kindLabel}</span>
              </div>
              <h2 className="mt-1 text-xl font-bold leading-tight text-white">{issue.title}</h2>
              <div className="text-sm text-gray-400">{issue.authors.join(", ")}</div>
              {issue.hcUrl && (
                <a href={issue.hcUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline">
                  Hardcover <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          <ol className="mt-6 space-y-3">
            {issue.thread.map((c) =>
              c.event ? (
                <li key={c.id} className="text-center text-xs text-gray-500">
                  {c.author} {c.event === "resolved" ? "resolved" : "reopened"} this {timeAgo(utc(c.createdAt))}
                </li>
              ) : (
                <li key={c.id} className="rounded-lg bg-gray-900/50 p-3 ring-1 ring-gray-700">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="font-semibold text-gray-200">{c.author}</span>
                    {c.admin && <span className="badge badge-default">Admin</span>}
                    <span>{timeAgo(utc(c.createdAt))}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{c.body}</p>
                </li>
              ),
            )}
          </ol>

          <div className="mt-4">
            {issue.status === "open" || admin ? (
              <textarea
                className="input min-h-[5rem]"
                placeholder={issue.status === "open" ? "Add a comment" : "Add a comment, or say why you're reopening it"}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
            ) : (
              <>
                <p className="mb-2 text-sm text-gray-400">This issue is resolved. If it isn't fixed, reopen it and say what's still wrong.</p>
                <textarea className="input min-h-[5rem]" placeholder="What's still wrong? (optional)" value={reply} onChange={(e) => setReply(e.target.value)} />
              </>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {issue.status === "open" ? (
                <>
                  <button className="btn btn-default" onClick={comment} disabled={busy || !reply.trim()}>
                    Comment
                  </button>
                  {admin && (
                    <button className="btn btn-success" onClick={() => setStatus("resolved")} disabled={busy}>
                      {busy && <Spinner className="h-4 w-4 text-white" />}
                      <CheckCircleIcon className="h-4 w-4" /> {reply.trim() ? "Comment and resolve" : "Resolve"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {admin && (
                    <button className="btn btn-default" onClick={comment} disabled={busy || !reply.trim()}>
                      Comment
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={() => setStatus("open")} disabled={busy}>
                    {busy && <Spinner className="h-4 w-4 text-white" />} {reply.trim() ? "Reopen with comment" : "Reopen"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
