import { useEffect, useState } from "react";
import type { Status } from "./api";

/** The version this copy of the app was built as, to notice when the server has a newer one. */
export const APP_VERSION: string = __APP_VERSION__;

/** True when Shelfhelp was opened from the home screen (installed), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export type Platform = "ios" | "android" | "other";

export function platform(): Platform {
  const ua = navigator.userAgent;
  // iPads report themselves as a Mac, but have touch.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Chrome and Edge offer the install prompt once, early, so keep it from the start.
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function startPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  // Only the built app has a service worker; the dev server would cache in the way.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

/** Whether this browser can show its own Install prompt, and a way to show it. */
export function useInstallPrompt() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    canPrompt: !!deferred,
    prompt: async () => {
      const p = deferred;
      if (!p) return false;
      deferred = null;
      notify();
      await p.prompt();
      return (await p.userChoice).outcome === "accepted";
    },
  };
}

const CHECK_EVERY_MS = 10 * 60 * 1000;
const RELOADED_KEY = "shelfhelp.reloadedFor";

/**
 * Loads the new Shelfhelp by itself after the server is updated. An installed app can stay open
 * for days and has no reload button, so it checks when it comes back to the screen and every few
 * minutes. It reloads right away when you come back to it, or, if the check found it while you
 * were using it, the next time it goes to the background, so nothing you're doing is cut off.
 * It reloads once per version, so a stale copy somewhere can't make it reload over and over.
 */
export function useAutoUpdate() {
  useEffect(() => {
    let last = 0;
    let pending: string | null = null;
    const reloadFor = (version: string) => {
      try {
        if (sessionStorage.getItem(RELOADED_KEY) === version) return;
        sessionStorage.setItem(RELOADED_KEY, version);
      } catch {
        // No storage: reload anyway.
      }
      window.location.reload();
    };
    const check = async (returning: boolean) => {
      if (pending) {
        // Found earlier while in use: now is a good moment.
        if (document.visibilityState === "hidden" || returning) reloadFor(pending);
        return;
      }
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      try {
        const r = await fetch("/api/status", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        const s = (await r.json()) as Partial<Status>;
        if (!s.version || s.version === APP_VERSION) return;
        if (returning) reloadFor(s.version);
        else pending = s.version;
      } catch {
        // Offline or signed out: try again later.
      }
    };
    const onVisibility = () => check(document.visibilityState === "visible");
    const onFocus = () => check(true);
    const timer = window.setInterval(() => check(false), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
