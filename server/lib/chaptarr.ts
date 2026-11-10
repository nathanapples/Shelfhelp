/**
 * Chaptarr API client.
 *
 * Chaptarr keeps a separate row for the audiobook and the ebook of a book, and
 * identifies books by provider IDs such as `hc:149559` (a Hardcover book id).
 * Its own row ids are local and can change, so requests are looked up by the
 * Hardcover id and only remember Chaptarr's row id as a shortcut.
 */
import { config } from "./config.js";
import { getSettings, type Settings } from "./settings.js";

export type Format = "audiobook" | "ebook";

export class ChaptarrError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown = null,
  ) {
    super(message);
  }
}

export interface MediaSettings {
  qualityProfileId?: number | null;
  metadataProfileId?: number | null;
}

export interface RootFolder {
  id: number;
  name?: string | null;
  path: string;
  /** 0 mixed, 1 audiobook only, 2 ebook only. */
  folderType?: number;
  isEffectiveDefaultAudiobook?: boolean;
  isEffectiveDefaultEbook?: boolean;
  audiobook?: MediaSettings | null;
  ebook?: MediaSettings | null;
  freeSpace?: number | null;
}

export interface Profile {
  id: number;
  name: string;
  /** Quality profiles say "audiobook" or "ebook"; metadata profiles use 0 general, 1 audiobook, 2 ebook. */
  profileType?: string | number | null;
}

export interface LocalInstance {
  id: number;
  title?: string;
  mediaType?: string;
  monitored?: boolean;
  hasFiles?: boolean;
}

/** The parts of Chaptarr's BookResource Shelfhelp reads. The rest is passed back untouched when adding. */
export interface ChaptarrBook {
  id: number;
  title?: string;
  authorTitle?: string;
  foreignBookId?: string;
  hardcoverBookId?: string | null;
  mediaType?: string;
  monitored?: boolean;
  grabbed?: boolean;
  hasFiles?: boolean;
  statistics?: { bookFileCount?: number } | null;
  authorId?: number;
  author?: { id?: number; authorName?: string; foreignAuthorId?: string; [k: string]: unknown } | null;
  localAudiobookBooks?: LocalInstance[] | null;
  localEbookBooks?: LocalInstance[] | null;
  remoteCover?: string | null;
  narrator?: string | null;
  editions?: ChaptarrEdition[] | null;
  [k: string]: unknown;
}

export interface ChaptarrEdition {
  id?: number;
  foreignEditionId?: string | null;
  title?: string | null;
  isbn13?: string | null;
  asin?: string | null;
  monitored?: boolean;
  [k: string]: unknown;
}

/** The edition you asked for, as Shelfhelp knows it from Hardcover. */
export interface WantedEdition {
  id: number;
  asin?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9X]/gi, "").toUpperCase();

/** Which of Chaptarr's editions is the Hardcover edition you picked: by Hardcover id, then ASIN, then ISBN. */
export function findEdition(editions: ChaptarrEdition[] | null | undefined, want: WantedEdition): number {
  const list = editions ?? [];
  const byId = list.findIndex((e) => {
    const m = (e.foreignEditionId ?? "").match(/^hc:(?:edition:)?(\d+)$/i);
    return !!m && Number(m[1]) === want.id;
  });
  if (byId >= 0) return byId;
  const asin = digits(want.asin);
  if (asin) {
    const i = list.findIndex((e) => digits(e.asin) === asin || digits(e.foreignEditionId?.replace(/^az:/i, "")) === asin);
    if (i >= 0) return i;
  }
  for (const code of [digits(want.isbn13), digits(want.isbn10)].filter(Boolean)) {
    const i = list.findIndex((e) => digits(e.isbn13) === code || digits(e.foreignEditionId?.replace(/^isbn:/i, "")) === code);
    if (i >= 0) return i;
  }
  return -1;
}

export interface QueueRecord {
  bookId?: number | null;
  status?: string;
  trackedDownloadState?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string | null;
  errorMessage?: string | null;
}

/** Turns Chaptarr's error bodies (strings, validation lists, problem objects) into one readable line. */
export function errorText(body: unknown, status: number): string {
  if (!body) return `Chaptarr answered ${status}.`;
  if (typeof body === "string") return body.replace(/^"|"$/g, "") || `Chaptarr answered ${status}.`;
  if (Array.isArray(body)) {
    const msgs = body.map((e) => (e as { errorMessage?: string })?.errorMessage).filter(Boolean);
    if (msgs.length) return [...new Set(msgs)].join(" ");
  }
  const o = body as Record<string, unknown>;
  for (const k of ["message", "Message", "error", "title", "detail"]) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  return `Chaptarr answered ${status}.`;
}

export class Chaptarr {
  readonly url: string;
  readonly key: string;

  constructor(url?: string, key?: string, s: Settings = getSettings()) {
    this.url = (url ?? s.chaptarrUrl).replace(/\/+$/, "");
    this.key = key ?? s.chaptarrApiKey;
    if (!this.url || !this.key) throw new Error("Chaptarr isn't set up yet. Add its address and API key in Settings.");
  }

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method,
        headers: {
          "X-Api-Key": this.key,
          Accept: "application/json",
          "User-Agent": `shelfhelp/${config.version}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      const why = e.name === "TimeoutError" ? "it took too long to answer" : (e.cause?.code ?? e.cause?.message ?? e.message);
      throw new ChaptarrError(`Couldn't reach Chaptarr at ${this.url} (${why}).`, 0);
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* plain text */
    }
    if (res.status === 401) throw new ChaptarrError("Chaptarr rejected the API key.", 401, data);
    return { status: res.status, data: data as T };
  }

  private async get<T>(path: string): Promise<T> {
    const { status, data } = await this.request<T>("GET", path);
    if (status >= 400) throw new ChaptarrError(errorText(data, status), status, data);
    return data;
  }

  status() {
    return this.get<{ appName?: string; instanceName?: string; version?: string }>("/api/v1/system/status");
  }

  rootFolders() {
    return this.get<RootFolder[]>("/api/v1/rootfolder");
  }

  qualityProfiles() {
    return this.get<Profile[]>("/api/v1/qualityprofile");
  }

  metadataProfiles() {
    return this.get<Profile[]>("/api/v1/metadataprofile");
  }

  /** Lookup by a provider-prefixed term such as `hc:123`, `isbn:978...` or plain words. */
  lookup(term: string, mediaType?: Format) {
    const q = new URLSearchParams({ term });
    if (mediaType) q.set("mediaType", mediaType);
    return this.get<ChaptarrBook[]>(`/api/v1/book/lookup?${q}`);
  }

  book(id: number) {
    return this.get<ChaptarrBook>(`/api/v1/book/${id}`);
  }

  /** Adds one format of a book. 201 added, 202 waiting on the author import, 409 ambiguous, 400 refused. */
  add(book: ChaptarrBook, mediaType: Format) {
    return this.request<unknown>("POST", `/api/v1/book?mediaType=${mediaType}`, book, 120_000);
  }

  async monitor(bookIds: number[]) {
    const { status, data } = await this.request("PUT", "/api/v1/book/monitor", { bookIds, monitored: true });
    if (status >= 400) throw new ChaptarrError(errorText(data, status), status, data);
  }

  async search(bookIds: number[]) {
    const { status, data } = await this.request("POST", "/api/v1/command", { name: "BookSearch", bookIds });
    if (status >= 400) throw new ChaptarrError(errorText(data, status), status, data);
  }

  tags() {
    return this.get<{ id: number; label: string }[]>("/api/v1/tag");
  }

  /** The id of a tag, made if it doesn't exist. Chaptarr lowercases labels. */
  async ensureTag(label: string): Promise<number> {
    const want = label.toLowerCase();
    const found = (await this.tags()).find((t) => t.label.toLowerCase() === want);
    if (found) return found.id;
    const { status, data } = await this.request<{ id: number }>("POST", "/api/v1/tag", { label: want });
    if (status >= 400 || !data?.id) throw new ChaptarrError(errorText(data, status), status, data);
    return data.id;
  }

  author(id: number) {
    return this.get<Record<string, unknown> & { id: number; authorName?: string }>(`/api/v1/author/${id}`);
  }

  /** Adds a tag to an author for one format. Returns false if it was already there. */
  async tagAuthor(authorId: number, format: Format, tagId: number): Promise<boolean> {
    const a = await this.author(authorId);
    const key = `${format}Tags`;
    const have = new Set<number>(((a[key] as number[] | null) ?? (a.tags as number[] | null) ?? []).map(Number));
    if (have.has(tagId)) return false;
    have.add(tagId);
    const other = format === "audiobook" ? "ebookTags" : "audiobookTags";
    const body = { ...a, [key]: [...have], [other]: (a[other] as number[] | null) ?? [] };
    body.tags = [...new Set([...(body.audiobookTags as number[]), ...(body.ebookTags as number[])])];
    const { status, data } = await this.request("PUT", `/api/v1/author/${authorId}`, body);
    if (status >= 400) throw new ChaptarrError(errorText(data, status), status, data);
    return true;
  }

  async queue(): Promise<QueueRecord[]> {
    const data = await this.get<{ records?: QueueRecord[] } | QueueRecord[]>("/api/v1/queue?pageSize=500");
    return Array.isArray(data) ? data : (data?.records ?? []);
  }
}

const FORMAT_TYPE: Record<Format, number> = { audiobook: 1, ebook: 2 };

function profileIs(p: Profile, format: Format) {
  const t = p.profileType;
  if (typeof t === "string") return t.toLowerCase() === format;
  return t === FORMAT_TYPE[format];
}

export interface FormatChoice {
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  metadataProfileId: number | null;
  /** Why this format can't be requested, when it can't. */
  problem: string | null;
}

/**
 * Works out the root folder and profiles a request uses for one format:
 * your picks in Settings first, then the root folder's defaults in Chaptarr.
 */
export function chooseFor(
  format: Format,
  s: Settings,
  roots: RootFolder[],
  quality: Profile[],
  metadata: Profile[],
): FormatChoice {
  const label = format === "audiobook" ? "audiobooks" : "ebooks";
  const pickedPath = format === "audiobook" ? s.chaptarrAudiobookRoot : s.chaptarrEbookRoot;
  const usable = roots.filter((r) => !r.folderType || r.folderType === FORMAT_TYPE[format]);
  const settingsOf = (r: RootFolder) => (format === "audiobook" ? r.audiobook : r.ebook) ?? null;
  const root =
    (pickedPath && roots.find((r) => r.path === pickedPath)) ||
    usable.find((r) => (format === "audiobook" ? r.isEffectiveDefaultAudiobook : r.isEffectiveDefaultEbook)) ||
    usable.find((r) => settingsOf(r)?.qualityProfileId) ||
    null;
  const pickedQuality = format === "audiobook" ? s.chaptarrAudiobookQuality : s.chaptarrEbookQuality;
  const pickedMetadata = format === "audiobook" ? s.chaptarrAudiobookMetadata : s.chaptarrEbookMetadata;
  const rootSettings = root ? settingsOf(root) : null;
  const qualityProfileId =
    (pickedQuality && quality.some((p) => p.id === pickedQuality) ? pickedQuality : null) ??
    rootSettings?.qualityProfileId ??
    quality.find((p) => profileIs(p, format))?.id ??
    null;
  const metadataProfileId =
    (pickedMetadata && metadata.some((p) => p.id === pickedMetadata) ? pickedMetadata : null) ??
    rootSettings?.metadataProfileId ??
    metadata.find((p) => profileIs(p, format))?.id ??
    null;
  let problem: string | null = null;
  if (!root) problem = `Chaptarr has no root folder for ${label}.`;
  else if (!qualityProfileId) problem = `Chaptarr has no quality profile for ${label}.`;
  else if (!metadataProfileId) problem = `Chaptarr has no metadata profile for ${label}.`;
  return { rootFolderPath: root?.path ?? null, qualityProfileId, metadataProfileId, problem };
}

const cap = (f: Format) => (f === "audiobook" ? "Audiobook" : "Ebook");

/**
 * Builds the add body from a lookup result: this format only, this one book
 * monitored, nothing else by the author, and a search right away if wanted.
 */
export function addBody(
  found: ChaptarrBook,
  format: Format,
  choice: FormatChoice,
  searchNow: boolean,
  tagIds: number[] = [],
  editionIndex = -1,
): ChaptarrBook {
  const other: Format = format === "audiobook" ? "ebook" : "audiobook";
  const author: Record<string, unknown> = { ...(found.author ?? {}) };
  author[`${format}RootFolderPath`] = choice.rootFolderPath;
  author[`${format}QualityProfileId`] = choice.qualityProfileId;
  author[`${format}MetadataProfileId`] = choice.metadataProfileId;
  author[`${format}Monitored`] = true;
  author[`${format}MonitorNewItems`] = "none";
  // Leave the other format alone so a new author isn't set up for it.
  for (const k of ["RootFolderPath", "QualityProfileId", "MetadataProfileId", "Monitored", "MonitorNewItems"]) {
    if (author[`${other}${k}`] === undefined) continue;
    author[`${other}${k}`] = null;
  }
  for (const k of ["rootFolderPath", "qualityProfileId", "metadataProfileId"]) delete author[k];
  author.monitored = true;
  if (tagIds.length) {
    // Tags in Chaptarr live on the author, per format.
    author[`${format}Tags`] = tagIds;
    author[`${other}Tags`] = [];
    author.tags = tagIds;
  }
  author.addOptions = { monitor: "specificBook", [`${format}Monitor`]: "specificBook", searchForMissingBooks: false };
  // A picked edition is the only one monitored, so Chaptarr uses it.
  const editions =
    editionIndex >= 0 && found.editions ? found.editions.map((e, i) => ({ ...e, monitored: i === editionIndex })) : found.editions;
  return {
    ...found,
    ...(editions ? { editions } : {}),
    id: 0,
    mediaType: format,
    monitored: true,
    [`${format}Monitored`]: true,
    author,
    addOptions: { addType: "manual", searchForNewBook: searchNow },
  } as ChaptarrBook;
}

export function localOf(found: ChaptarrBook, format: Format): LocalInstance | null {
  const list = (format === "audiobook" ? found.localAudiobookBooks : found.localEbookBooks) ?? [];
  if (list.length) return list[0];
  if (found.id > 0 && (found.mediaType ?? "").toLowerCase() === format) {
    return { id: found.id, monitored: found.monitored, hasFiles: found.hasFiles || (found.statistics?.bookFileCount ?? 0) > 0 };
  }
  return null;
}

export { cap as formatLabel };
