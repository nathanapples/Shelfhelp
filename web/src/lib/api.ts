export type BookStatus = "matched" | "review" | "missing" | "ignored";

export interface Counts {
  matched: number;
  review: number;
  missing: number;
  ignored: number;
  total: number;
}

export type SourceType = "hardcover_list" | "hardcover_status" | "requests";

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
  defaultCollectionName?: string;
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
  readingEnabled: boolean;
  readingAutoSend: boolean;
  readingMinProgress: number;
  readingMarkOwned: boolean;
  absLibraries: string[];
  authMode: AuthMode;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcInternalUrl: string;
  oidcAdminGroup: string;
  oidcLabel: string;
  cfTeamDomain: string;
  cfAudience: string;
  chaptarrUrl: string;
  chaptarrApiKey: string;
  requestsEnabled: boolean;
  requestFormat: RequestFormat;
  requestSearchNow: boolean;
  requestTagAbs: boolean;
  requestTagFormat: string;
  chaptarrAudiobookRoot: string;
  chaptarrEbookRoot: string;
  chaptarrAudiobookQuality: number;
  chaptarrEbookQuality: number;
  chaptarrAudiobookMetadata: number;
  chaptarrEbookMetadata: number;
  lockedByEnv: string[];
}

export type Format = "audiobook" | "ebook";
export type RequestFormat = Format | "both";
export type RequestStatus = "pending" | "requested" | "downloading" | "downloaded" | "available" | "failed";
export type RequestMap = Partial<Record<Format, { id: number; status: RequestStatus }>>;

export interface BookRequest {
  id: number;
  hcBookId: number;
  format: Format;
  title: string;
  authors: string[];
  slug: string | null;
  hcUrl: string | null;
  coverUrl: string | null;
  releaseYear: number | null;
  requestedBy: string[];
  status: RequestStatus;
  message: string | null;
  chaptarrBookId: number | null;
  absItemId: string | null;
  progress: number | null;
  requestedAt: string;
  updatedAt: string;
  checkedAt: string | null;
}

export interface RequestOutcome {
  format: Format;
  status: RequestStatus;
  message: string;
  request: BookRequest;
}

export interface ChaptarrChoice {
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  metadataProfileId: number | null;
  problem: string | null;
}

export interface ChaptarrOptions {
  rootFolders: { id: number; name: string | null; path: string; folderType: number; defaultAudiobook: boolean; defaultEbook: boolean; freeSpace: number | null }[];
  qualityProfiles: { id: number; name: string; profileType: string | number | null }[];
  metadataProfiles: { id: number; name: string; profileType: string | number | null }[];
  using: Record<Format, ChaptarrChoice>;
}

export type AuthMode = "none" | "oidc" | "cloudflare";

export interface UserView {
  id: number;
  name: string;
  username: string | null;
  email: string | null;
  role: "admin" | "user";
  isOwner: boolean;
  absUserId: string | null;
  hasHardcover: boolean;
  ownHardcoverToken: boolean;
  readingEnabled: boolean;
  lastLoginAt: string | null;
  via?: "open" | "password" | "oidc" | "cloudflare" | "recovery";
}

export interface Status {
  version: string;
  authMode: AuthMode;
  authRequired: boolean;
  passwordLogin: boolean;
  oidcLabel: string;
  signedIn: boolean;
  signinProblem: string | null;
  user: UserView | null;
  configured: { hardcover: boolean; abs: boolean; chaptarr: boolean };
  requestsEnabled: boolean;
  requestFormat: RequestFormat;
}

export const isAdmin = (s: Status) => s.user?.role === "admin";

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
  mine?: { status: number; statusName: string; progress: number | null } | null;
  requests?: RequestMap;
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

export type ReadingMatch = "matched" | "review" | "missing" | "ignored";
export type ReadingSync = "synced" | "pending" | "skipped" | "error" | "none" | "held";

export interface HcBookRef {
  id: number;
  slug: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
  releaseYear: number | null;
}

export interface MyShelf {
  status: number;
  statusName: string;
  progress: number | null;
}

export interface HcCandidate extends HcBookRef {
  mine?: MyShelf | null;
  score: number;
  titleSim: number;
  authorSim: number | null;
  idVia: string[];
  notes: string[];
}

export interface ReadingBook {
  absItemId: string;
  libraryId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  series: { name: string; sequence: number | null }[];
  asin: string | null;
  isbn: string | null;
  coverUrl: string;
  progress: number;
  isFinished: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lastUpdate: number | null;
  duration: number | null;
  matchStatus: ReadingMatch;
  matchSource: "auto" | "manual" | "collection" | null;
  hcBookId: number | null;
  hcBook: HcBookRef | null;
  score: number | null;
  reasons: string[];
  candidates: HcCandidate[];
  mine: MyShelf | null;
  heldReason: "threshold" | "shelves" | null;
  hcStatus: number | null;
  hcStatusName: string | null;
  hcProgress: number | null;
  syncStatus: ReadingSync;
  syncAction: string | null;
  syncedAt: string | null;
}

export interface ReadingData {
  enabled: boolean;
  autoSend: boolean;
  minProgress: number;
  running: boolean;
  counts: Record<
    "total" | "listening" | "finished" | "matched" | "review" | "missing" | "ignored" | "synced" | "pending" | "skipped" | "errors" | "held",
    number
  >;
  books: ReadingBook[];
}

export function shortDate(ms: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Joins reasons into readable sentences: "Title and author match. Same series position (#1)." */
export function sentences(parts: string[]): string {
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/\.$/, "")).join(". ") + (parts.length ? "." : "");
}

export interface HistoryEntry {
  id: number;
  ts: string;
  absItemId: string;
  hcBookId: number;
  title: string;
  description: string;
  kind: string;
  undoneAt: string | null;
  undoNote: string | null;
  coverUrl: string;
}

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

export interface JobsData {
  running: Job[];
  last: Record<string, LastRun>;
}

export interface DiscoverRowInfo {
  id: string;
  title: string;
  subtitle: string;
}

export interface DiscoverBook extends SearchHit {
  addedAt?: number;
}

export interface LibraryItemView {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  series: { name: string; sequence: number | null }[];
  duration: number | null;
  coverUrl: string;
  asin?: string | null;
  isbn?: string | null;
  publishedYear?: number | null;
  numAudio?: number | null;
}

export interface Similar {
  confirmed: { via: string; item: LibraryItemView }[];
  similar: { absItemId: string; score: number; titleSim: number; authorSim: number | null; notes: string[]; item: LibraryItemView }[];
  linkedCount: LinkCounts;
}

export interface LinkCounts {
  matched: number;
  review: number;
  missing: number;
  ignored: number;
  unchecked: number;
}

export type LinkStatus = "matched" | "review" | "missing" | "ignored" | "unchecked";

export interface LinkRow {
  absItemId: string;
  item: LibraryItemView;
  status: LinkStatus;
  source: string | null;
  hcBook: HcBookRef | null;
  score: number | null;
  reasons: string[];
  candidates: (HcBookRef & { score: number; titleSim: number; authorSim: number | null; idVia: string[]; notes: string[] })[];
}

export interface LinkPage {
  total: number;
  counts: LinkCounts;
  rows: LinkRow[];
}

export interface ReadingUser {
  id: number;
  name: string;
  absUser: string | null;
  hardcoverUser: string | null;
  hasHardcover: boolean;
  image: string | null;
  role: "admin" | "user";
  you: boolean;
  lastRun: { ok: boolean; message: string; finishedAt: number } | null;
  enabled: boolean;
  autoSend: boolean;
  minProgress: number;
  running: boolean;
  counts: Record<
    "synced" | "waiting" | "review" | "notfound" | "skipped" | "under" | "dnf" | "errors" | "issues" | "total" | "listening" | "finished",
    number
  >;
  nowListening: { title: string; progress: number; coverUrl: string } | null;
  covers: string[];
}
