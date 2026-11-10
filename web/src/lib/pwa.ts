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

/**
 * The newer version the server runs, if it's not the one this page was built as. An installed app
 * can stay open for days without reloading, and has no reload button, so it checks when it comes
 * back to the screen and every few minutes.
 */
export function useNewVersion(): string | null {
  const [newer, setNewer] = useState<string | null>(null);
  useEffect(() => {
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      try {
        const r = await fetch("/api/status", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        const s = (await r.json()) as Partial<Status>;
        if (s.version && s.version !== APP_VERSION) setNewer(s.version);
      } catch {
        // Offline or signed out: try again later.
      }
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);
  return newer;
}
