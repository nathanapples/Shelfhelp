import { Fragment, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  ClockIcon,
  EyeSlashIcon,
  XMarkIcon,
  BookOpenIcon,
} from "@heroicons/react/24/solid";
import type { BookStatus } from "../lib/api";

export function Spinner({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-indigo-500 ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex h-64 w-full items-center justify-center">
      <Spinner className="h-10 w-10" />
    </div>
  );
}

export function ErrorBlock({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-xl bg-red-900/30 p-5 text-center text-sm text-red-200 ring-1 ring-red-800">
      <p>{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const statusMeta: Record<BookStatus, { label: string; badge: string; dot: string; icon: typeof CheckIcon }> = {
  matched: { label: "In Library", badge: "badge-success", dot: "bg-green-400 ring-green-500 text-green-100", icon: CheckIcon },
  review: { label: "Needs Review", badge: "badge-warning", dot: "bg-yellow-500 ring-yellow-400 text-yellow-100", icon: ClockIcon },
  missing: { label: "Not in Library", badge: "badge-danger", dot: "bg-red-600 ring-red-500 text-red-100", icon: XMarkIcon },
  ignored: { label: "Ignored", badge: "badge-dark", dot: "bg-gray-600 ring-gray-500 text-gray-200", icon: EyeSlashIcon },
};

export function StatusBadge({ status }: { status: BookStatus }) {
  const m = statusMeta[status];
  return <span className={`badge ${m.badge}`}>{m.label}</span>;
}

export function StatusDot({ status, className = "h-5 w-5" }: { status: BookStatus; className?: string }) {
  const m = statusMeta[status];
  const Icon = m.icon;
  return (
    <span className={`flex items-center justify-center rounded-full shadow ring-1 ${m.dot} ${className}`} title={m.label}>
      <Icon className="h-3/4 w-3/4" />
    </span>
  );
}

export function Cover({
  src,
  alt,
  className = "",
  fit = "cover",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-800 p-3 text-center ${className}`}>
        <div>
          <BookOpenIcon className="mx-auto h-8 w-8 text-gray-500" />
          <div className="mt-2 line-clamp-3 text-xs font-semibold text-gray-400">{alt}</div>
        </div>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "max-w-2xl",
  backdrop,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: string;
  backdrop?: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-gray-800/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative flex max-h-[92vh] w-full ${size} flex-col overflow-hidden rounded-t-xl bg-gray-800 text-left shadow-xl ring-1 ring-gray-700 sm:rounded-xl`}
        role="dialog"
        aria-modal="true"
      >
        {backdrop && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden">
            <img src={backdrop} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-2xl" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-gray-800" />
          </div>
        )}
        {title && (
          <div className="relative flex items-start justify-between gap-4 px-5 pb-2 pt-5 sm:px-6">
            <div className="min-w-0">
              <h3 className="truncate text-xl font-bold leading-7 text-white">{title}</h3>
              {subtitle && <div className="mt-0.5 text-sm text-gray-400">{subtitle}</div>}
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-700 hover:text-white" aria-label="Close">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        )}
        <div className="relative flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
        {footer && <div className="relative flex flex-wrap justify-end gap-2 border-t border-gray-700 bg-gray-800 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
        checked ? "bg-indigo-500" : "bg-gray-700"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

export function PageTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-5 mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <h1 className="text-2xl font-bold leading-8 text-white sm:text-3xl sm:leading-9">{children}</h1>
      {extra && <div className="flex flex-wrap gap-2">{extra}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center text-center">
      {icon && <div className="mb-4 text-gray-600">{icon}</div>}
      <h2 className="text-xl font-bold text-gray-200">{title}</h2>
      {children && <div className="mt-2 text-sm text-gray-400">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="hide-scrollbar mb-6 overflow-x-auto border-b border-gray-600">
      <nav className="-mb-px flex gap-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-4 text-sm font-semibold leading-5 transition ${
              value === t.id
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-gray-400 hover:border-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-2 text-xs ${value === t.id ? "bg-indigo-500/30 text-indigo-200" : "bg-gray-700 text-gray-300"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 55 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-700">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-400">{score}</span>
    </div>
  );
}

export { Fragment };
