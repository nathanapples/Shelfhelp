import { useEffect, useState } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { JobsData } from "../lib/api";
import { Spinner } from "./ui";

function elapsed(from: number) {
  const s = Math.max(0, Math.round((Date.now() - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function ago(at: number) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} hr ago`;
}

/** A progress card for one sync while it runs, then how it ended. */
export function JobProgress({ jobs, id, idle }: { jobs: JobsData | null; id: string; idle?: boolean }) {
  const [, tick] = useState(0);
  const job = jobs?.running.find((j) => j.id === id) ?? null;
  const last = jobs?.last[id] ?? null;
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [job]);

  if (job) {
    const pct = job.total ? Math.round((job.current / job.total) * 100) : null;
    return (
      <div className="mb-6 rounded-xl bg-gray-800 p-4 ring-1 ring-indigo-700/60">
        <div className="flex items-center gap-3">
          <Spinner className="h-5 w-5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{job.phase}</div>
            <div className="text-xs text-gray-400">
              {job.total ? `${job.current} of ${job.total} · ` : ""}running for {elapsed(job.startedAt)}
            </div>
          </div>
          {pct !== null && <div className="text-sm font-semibold tabular-nums text-indigo-300">{pct}%</div>}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-700">
          {pct !== null ? (
            <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-indigo-500" />
          )}
        </div>
      </div>
    );
  }
  if (!last || idle === false) return null;
  return (
    <div className={`mb-6 flex items-start gap-2 text-sm ${last.ok ? "text-gray-400" : "text-red-300"}`}>
      {last.ok ? <CheckCircleIcon className="h-5 w-5 flex-shrink-0 text-green-400" /> : <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />}
      <span>
        {last.ok ? "Last check" : "Last check failed"} {ago(last.finishedAt)} ({last.seconds}s): {last.message}
      </span>
    </div>
  );
}
