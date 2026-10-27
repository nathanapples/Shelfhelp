/** What each running sync is doing right now, for the progress shown in the web UI. */

export interface Job {
  id: string;
  label: string;
  phase: string;
  current: number;
  total: number;
  startedAt: number;
}

export interface LastRun {
  id: string;
  label: string;
  ok: boolean;
  message: string;
  finishedAt: number;
  seconds: number;
}

const jobs = new Map<string, Job>();
const last = new Map<string, LastRun>();

export function startJob(id: string, label: string) {
  jobs.set(id, { id, label, phase: "Starting", current: 0, total: 0, startedAt: Date.now() });
}

/** Moves a job to a new step. Leave out current/total for a step without a count. */
export function step(id: string | undefined, phase: string, current = 0, total = 0) {
  if (!id) return;
  const job = jobs.get(id);
  if (job) Object.assign(job, { phase, current, total });
}

export function finishJob(id: string, ok: boolean, message: string) {
  const job = jobs.get(id);
  jobs.delete(id);
  last.set(id, {
    id,
    label: job?.label ?? id,
    ok,
    message,
    finishedAt: Date.now(),
    seconds: job ? Math.round((Date.now() - job.startedAt) / 1000) : 0,
  });
}

export function currentJob(id: string) {
  return jobs.get(id) ?? null;
}

export function jobsView() {
  return { running: [...jobs.values()], last: Object.fromEntries(last) };
}
