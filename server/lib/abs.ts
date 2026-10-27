import { getSettings } from "./settings.js";
import { parseAbsSeries, splitAuthors } from "./normalize.js";
import type { AbsItem } from "./matcher.js";

export class AbsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: string;
}

export interface AbsCollection {
  id: string;
  libraryId: string;
  name: string;
  description: string | null;
  books: { id: string }[];
}

export interface AbsProgress {
  libraryItemId: string;
  episodeId: string | null;
  duration: number;
  progress: number;
  currentTime: number;
  isFinished: boolean;
  ebookProgress?: number | null;
  lastUpdate: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface AbsItemRow extends AbsItem {
  libraryId: string;
  narrators: string[];
  publishedYear: number | null;
  updatedAt: number | null;
  addedAt: number | null;
  numAudio: number | null;
}

interface RawItem {
  id: string;
  libraryId: string;
  updatedAt?: number;
  addedAt?: number;
  media: {
    duration?: number;
    numAudioFiles?: number;
    metadata: {
      title?: string;
      subtitle?: string | null;
      authorName?: string | null;
      narratorName?: string | null;
      seriesName?: string | null;
      asin?: string | null;
      isbn?: string | null;
      publishedYear?: string | null;
    };
  };
}

export class Abs {
  constructor(
    readonly url = getSettings().absUrl,
    private readonly token = getSettings().absToken,
  ) {
    if (!url || !token) throw new AbsError("Audiobookshelf isn't set up yet. Add its URL and API key in Settings.");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new AbsError(`Couldn't reach Audiobookshelf at ${this.url}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      const hint =
        res.status === 401 ? " (check the API key)" : res.status === 403 ? " (the API key's user needs permission to update)" : "";
      throw new AbsError(`Audiobookshelf ${method} ${path} failed: ${res.status} ${text}${hint}`, res.status);
    }
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? await res.json() : await res.text()) as T;
  }

  async me() {
    return this.request<{ id: string; username: string; type: string; permissions?: Record<string, boolean> }>("GET", "/api/me");
  }

  /** Listening progress for the API key's user (books only, not podcast episodes). */
  async myProgress(): Promise<AbsProgress[]> {
    const me = await this.request<{ mediaProgress?: AbsProgress[] }>("GET", "/api/me");
    return (me.mediaProgress ?? []).filter((p) => p.libraryItemId && !p.episodeId);
  }

  /** Book libraries you've chosen in Settings (all of them if none are chosen). Podcast libraries never appear. */
  async selectedLibraries(): Promise<AbsLibrary[]> {
    const all = await this.libraries();
    const chosen = getSettings().absLibraries;
    return chosen.length ? all.filter((l) => chosen.includes(l.id)) : all;
  }

  async libraries(): Promise<AbsLibrary[]> {
    const data = await this.request<{ libraries: AbsLibrary[] }>("GET", "/api/libraries");
    return data.libraries.filter((l) => l.mediaType === "book").map(({ id, name, mediaType }) => ({ id, name, mediaType }));
  }

  async items(libraryId: string): Promise<AbsItemRow[]> {
    const out: AbsItemRow[] = [];
    const limit = 1000;
    for (let page = 0; ; page++) {
      const data = await this.request<{ results: RawItem[]; total: number }>(
        "GET",
        `/api/libraries/${libraryId}/items?limit=${limit}&page=${page}&minified=1`,
      );
      for (const r of data.results) out.push(toRow(r));
      if (data.results.length < limit || out.length >= data.total) break;
    }
    return out;
  }

  async collection(id: string): Promise<AbsCollection | null> {
    try {
      return await this.request<AbsCollection>("GET", `/api/collections/${id}`);
    } catch (err) {
      if (err instanceof AbsError && err.status === 404) return null;
      throw err;
    }
  }

  async collections(libraryId: string): Promise<AbsCollection[]> {
    const data = await this.request<{ results: AbsCollection[] }>("GET", `/api/libraries/${libraryId}/collections`);
    return data.results;
  }

  createCollection(libraryId: string, name: string, description: string | null, books: string[]) {
    return this.request<AbsCollection>("POST", "/api/collections", { libraryId, name, description, books });
  }

  addToCollection(id: string, books: string[]) {
    return this.request<AbsCollection>("POST", `/api/collections/${id}/batch/add`, { books });
  }

  removeFromCollection(id: string, books: string[]) {
    return this.request<AbsCollection>("POST", `/api/collections/${id}/batch/remove`, { books });
  }

  /** Renames and/or reorders. ABS only reorders books already in the collection. */
  updateCollection(id: string, patch: { name?: string; description?: string | null; books?: string[] }) {
    return this.request<AbsCollection>("PATCH", `/api/collections/${id}`, patch);
  }

  deleteCollection(id: string) {
    return this.request<unknown>("DELETE", `/api/collections/${id}`);
  }

  cover(itemId: string, width = 400) {
    return fetch(`${this.url}/api/items/${itemId}/cover?width=${width}&format=jpeg`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(30_000),
    });
  }
}

function toRow(r: RawItem): AbsItemRow {
  const m = r.media.metadata;
  const year = m.publishedYear ? parseInt(m.publishedYear, 10) : NaN;
  return {
    id: r.id,
    libraryId: r.libraryId,
    title: m.title ?? "Untitled",
    subtitle: m.subtitle ?? null,
    authors: splitAuthors(m.authorName),
    narrators: splitAuthors(m.narratorName),
    series: parseAbsSeries(m.seriesName),
    asin: m.asin ?? null,
    isbn: m.isbn ?? null,
    duration: r.media.duration ?? null,
    publishedYear: Number.isFinite(year) ? year : null,
    updatedAt: r.updatedAt ?? null,
    addedAt: r.addedAt ?? null,
    numAudio: r.media.numAudioFiles ?? null,
  };
}
