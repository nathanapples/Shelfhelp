import type React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  BookOpenIcon,
  CogIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { api } from "../lib/api";
import { jobStarted, useApi, useJobs } from "../lib/hooks";
import { Spinner } from "./ui";
import { useToast } from "./toast";

const nav: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end?: boolean; count?: string }[] = [
  { to: "/reading", label: "Reading", icon: BookOpenIcon },
  { to: "/", label: "Collections", icon: RectangleStackIcon, end: true },
  { to: "/settings", label: "Settings", icon: CogIcon },
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src="/logo.svg" alt="" className="h-9 w-9" />
      <span className="bg-gradient-to-br from-indigo-400 to-purple-400 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
        Shelfhelp
      </span>
    </div>
  );
}

function NavItems({ counts, onNavigate }: { counts: Record<string, number> | null; onNavigate?: () => void }) {
  return (
    <nav className="mt-8 flex-1 space-y-2 px-4">
      {nav.map((n) => {
        const count = n.count ? (counts?.[n.count] ?? 0) : 0;
        return (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex items-center rounded-md px-3 py-2 text-lg font-medium leading-6 text-white transition duration-150 ${
                isActive
                  ? "bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500"
                  : "hover:bg-gray-700 focus:bg-gray-700"
              }`
            }
          >
            <n.icon className="mr-3 h-6 w-6" />
            <span className="flex-1">{n.label}</span>
            {count > 0 && (
              <span className="rounded-full bg-gray-900/60 px-2 text-xs font-semibold leading-5 text-gray-200 ring-1 ring-gray-600">{count}</span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Layout({ children, version, authRequired }: { children: ReactNode; version: string; authRequired: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { data: counts, reload } = useApi<Record<string, number>>("/counts", { poll: 15000 });
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(location.pathname === "/search" ? (params.get("q") ?? "") : "");
  const toast = useToast();
  const jobs = useJobs();
  const job = jobs?.running[0] ?? null;

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    reload();
  }, [location.pathname, reload]);
  useEffect(() => {
    if (location.pathname !== "/search") setQ("");
  }, [location.pathname]);

  const syncAll = async () => {
    try {
      await api("/sync", { method: "POST" });
      jobStarted();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  };

  const sidebarFooter = (
    <div className="px-6 pb-6 text-xs text-gray-500">
      <a href="https://github.com/nathanapples/shelfhelp" target="_blank" rel="noreferrer" className="hover:text-gray-300">
        Shelfhelp v{version}
      </a>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-gray-900/80 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <div
          className={`relative flex h-full w-72 max-w-[85%] flex-col bg-gray-800 pt-6 shadow-xl ring-1 ring-gray-700 transition-transform duration-300 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-5">
            <Logo />
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-gray-400 hover:text-white" aria-label="Close menu">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          <NavItems counts={counts} onNavigate={() => setOpen(false)} />
          {sidebarFooter}
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-gray-700 bg-gray-800 pt-6 lg:flex">
        <div className="px-6">
          <Logo />
        </div>
        <NavItems counts={counts} />
        {sidebarFooter}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header
          className={`sticky top-0 z-30 flex h-16 flex-shrink-0 items-center gap-3 px-4 transition duration-300 sm:px-6 ${
            scrolled ? "bg-gray-700/90 backdrop-blur" : "bg-transparent"
          }`}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button onClick={() => setOpen(true)} className="text-gray-300 hover:text-white lg:hidden" aria-label="Open menu">
            <Bars3Icon className="h-7 w-7" />
          </button>
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Hardcover"
              className="block w-full rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-10 pr-4 text-white placeholder-gray-400 transition focus:border-gray-500 focus:bg-gray-900 focus:outline-none focus:ring-0 sm:text-base"
            />
          </form>
          {job && (
            <div
              className="flex min-w-0 max-w-[45%] items-center gap-2 rounded-full bg-gray-800/90 px-3 py-1.5 text-xs text-gray-200 ring-1 ring-indigo-700/60"
              title={`${job.label}: ${job.phase}`}
            >
              <Spinner className="h-4 w-4 flex-shrink-0" />
              <span className="hidden truncate md:inline">
                <span className="font-semibold">{job.label}</span>: {job.phase}
                {job.total ? ` (${job.current}/${job.total})` : ""}
                {jobs && jobs.running.length > 1 ? ` +${jobs.running.length - 1} more` : ""}
              </span>
            </div>
          )}
          <button onClick={syncAll} className="btn btn-default rounded-full px-3" title="Sync all lists now">
            <ArrowPathIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Sync All</span>
          </button>
          {authRequired && (
            <button onClick={signOut} className="rounded-full p-2 text-gray-400 hover:bg-gray-700 hover:text-white" title="Sign out">
              <ArrowRightOnRectangleIcon className="h-6 w-6" />
            </button>
          )}
        </header>
        <main className="relative flex-1 px-4 pb-16 sm:px-6 lg:px-8" style={{ paddingBottom: "max(4rem, env(safe-area-inset-bottom))" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
