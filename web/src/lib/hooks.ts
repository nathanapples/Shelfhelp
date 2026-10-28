import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Loads JSON from the API, with reload and optional polling. */
export function useApi<T>(path: string | null, { poll }: { poll?: number | false } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === p) setError((e as Error).message);
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(!!path);
    setData(null);
    reload();
  }, [path, reload]);

  useEffect(() => {
    if (!poll || !path) return;
    const t = setInterval(reload, poll);
    return () => clearInterval(t);
  }, [poll, path, reload]);

  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

import type { JobsData } from "./api";

/** Running syncs and how the last ones ended. Polls fast while something runs. */
export function useJobs() {
  const [data, setData] = useState<JobsData | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await api<JobsData>("/jobs");
        if (!alive) return;
        setData(d);
        busy.current = d.running.length > 0;
      } catch {
        /* ignore */
      }
      if (alive) timer = setTimeout(tick, busy.current ? 1000 : 5000);
    };
    tick();
    const kick = () => {
      clearTimeout(timer);
      tick();
    };
    window.addEventListener("shelfhelp:job-started", kick);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("shelfhelp:job-started", kick);
    };
  }, []);
  return data;
}

/** Tell the progress indicators to look right away. */
export const jobStarted = () => window.dispatchEvent(new Event("shelfhelp:job-started"));

/** State remembered in this browser, so a page opens where you left it. */
export function useStoredState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(`shelfhelp.${key}`) as T | null;
      if (v && (!allowed || allowed.includes(v))) return v;
    } catch {
      /* private mode */
    }
    return fallback;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`shelfhelp.${key}`, v);
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [value, set];
}
