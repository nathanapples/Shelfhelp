export type BookStatus = "matched" | "review" | "missing" | "ignored";

export interface Counts {
  matched: number;
  review: number;
  missing: number;
  ignored: number;
  total: number;
}

export type SourceType = "hardcover_list" | "hardcover_status";

export interface List {
  id: number;
  sourceType: SourceType;
  hcListId: number;
  hcSlug: string | null;
  hcOwner: string | null;
  hcUrl: string | null;
  name: string;
  description: string | null;
  absLibraryId: string;
  absCollectionId: string | null;
  collectionName: string;
  removeMissing: boolean;
  keepOrder: boolean;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  syncing: boolean;
  counts: Counts;
  covers: string[];
}

export interface AbsItem {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  series: { name: string; sequence: number | null }[];
  asin: string | null;
  isbn: string | null;
  duration: number | null;
  publishedYear: number | null;
  coverUrl: string;
}

export interface Candidate {
  absItemId: string;
  score: number;
  titleSim: number;
  authorSim: number | null;
  idVia: string[];
  notes: string[];
  item: AbsItem | null;
}

export interface Book {
  listId: number;
  hcBookId: number;
  position: number;
  slug: string | null;
  hcUrl: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  releaseYear: number | null;
  status: BookStatus;
  matchSource: "auto" | "manual" | null;
  absItemId: string | null;
  absItem: AbsItem | null;
  score: number | null;
  reasons: string[];
  candidates: Candidate[];
  libraryId?: string;
  lists?: { id: number; name: string }[];
}

export interface ListDetail extends List {
  books: Book[];
}

export interface HcList {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  booksCount: number;
  owner: string | null;
  coverUrls: string[];
  followed?: boolean;
  sourceType?: SourceType;
}

export interface Library {
  id: string;
  name: string;
  mediaType: string;
}

export interface Settings {
  hardcoverToken: string;
  absUrl: string;
  absToken: string;
  syncIntervalMinutes: number;
  matchStrictness: "strict" | "balanced" | "loose";
  lockedByEnv: string[];
}

export interface Status {
  version: string;
  authRequired: boolean;
  signedIn: boolean;
  configured: { hardcover: boolean; abs: boolean };
}

export interface SearchHit {
  id: number;
  slug: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  releaseYear: number | null;
  seriesName: string | null;
  seriesPosition: number | null;
  hasAudiobook: boolean | null;
  absItemId: string | null;
}

export interface Activity {
  id: number;
  ts: string;
  level: "info" | "warn" | "error";
  listId: number | null;
  listName: string | null;
  message: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && data?.error === "Sign in required") window.dispatchEvent(new Event("shelfhelp:signedout"));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function duration(seconds: number | null): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}
