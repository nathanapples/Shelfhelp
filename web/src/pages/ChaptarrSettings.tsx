import { useEffect, useState, type ReactNode } from "react";
import { ExclamationTriangleIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { api, type ChaptarrOptions, type Format, type Settings } from "../lib/api";
import { Spinner, Toggle } from "../components/ui";

interface LookupResult {
  term: string;
  ms: number;
  results: {
    id: number;
    title: string | null;
    authorName: string | null;
    foreignAuthorId: string | null;
    foreignBookId: string | null;
    hardcoverBookId: string | null;
    mediaType: string | null;
    monitored: boolean | null;
    hasFiles: boolean | null;
    grabbed: boolean | null;
    narrator: string | null;
    cover: string | null;
    inChaptarr: Record<Format, { id: number; monitored?: boolean; hasFiles?: boolean } | null>;
    editions: number | null;
  }[];
  sample: string | null;
}

const FORMAT_NAME: Record<Format, string> = { audiobook: "Audiobooks", ebook: "Ebooks" };

function FormatPicks({
  format,
  s,
  set,
  options,
  locked,
}: {
  format: Format;
  s: Settings;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  options: ChaptarrOptions;
  locked: boolean;
}) {
  const A = format === "audiobook";
  const rootKey = A ? "chaptarrAudiobookRoot" : "chaptarrEbookRoot";
  const qualityKey = A ? "chaptarrAudiobookQuality" : "chaptarrEbookQuality";
  const metaKey = A ? "chaptarrAudiobookMetadata" : "chaptarrEbookMetadata";
  const typeNum = A ? 1 : 2;
  const roots = options.rootFolders.filter((r) => !r.folderType || r.folderType === typeNum);
  const fits = (t: string | number | null) => t === format || t === typeNum || t == null || t === 0;
  const using = options.using[format];
  const qName = options.qualityProfiles.find((p) => p.id === using.qualityProfileId)?.name;
  const mName = options.metadataProfiles.find((p) => p.id === using.metadataProfileId)?.name;
  return (
    <div className="form-row">
      <label>
        {FORMAT_NAME[format]}
        <span className="label-tip">Leave on Chaptarr's default to use whatever that root folder is set to in Chaptarr.</span>
      </label>
      <div className="form-input-area space-y-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <select className="input" value={s[rootKey]} disabled={locked} onChange={(e) => set(rootKey, e.target.value)} aria-label={`${FORMAT_NAME[format]} root folder`}>
            <option value="">Default folder</option>
            {roots.map((r) => (
              <option key={r.id} value={r.path}>
                {r.path}
                {(A ? r.defaultAudiobook : r.defaultEbook) ? " (default)" : ""}
              </option>
            ))}
          </select>
          <select className="input" value={s[qualityKey]} disabled={locked} onChange={(e) => set(qualityKey, Number(e.target.value))} aria-label={`${FORMAT_NAME[format]} quality profile`}>
            <option value={0}>Default quality</option>
            {options.qualityProfiles.filter((p) => fits(p.profileType)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="input" value={s[metaKey]} disabled={locked} onChange={(e) => set(metaKey, Number(e.target.value))} aria-label={`${FORMAT_NAME[format]} metadata profile`}>
            <option value={0}>Default metadata</option>
            {options.metadataProfiles.filter((p) => fits(p.profileType)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {using.problem ? (
          <p className="flex items-center gap-1.5 text-xs text-yellow-300">
            <ExclamationTriangleIcon className="h-4 w-4" /> {using.problem}
          </p>
        ) : (
          <p className="text-xs text-gray-400">
            Saved settings use {using.rootFolderPath}, {qName ?? `profile ${using.qualityProfileId}`}, {mName ?? `metadata ${using.metadataProfileId}`}.
          </p>
        )}
      </div>
    </div>
  );
}

function Lookup() {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      setRes(await api<LookupResult>(`/chaptarr/lookup?term=${encodeURIComponent(term.trim())}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-row">
      <label>
        Test a lookup
        <span className="label-tip">
          Read only. Paste a Hardcover link or id, or try isbn:..., az:... or plain words. Shows exactly what Chaptarr answers, without adding anything.
        </span>
      </label>
      <div className="form-input-area">
        <form onSubmit={go} className="flex gap-2">
          <input
            className="input"
            placeholder="https://hardcover.app/books/... or hc:427578"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button className="btn btn-default flex-shrink-0" disabled={busy || !term.trim()}>
            {busy ? <Spinner className="h-4 w-4" /> : <MagnifyingGlassIcon className="h-4 w-4" />} Look up
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        {res && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-gray-400">
              Asked for <span className="font-mono text-gray-200">{res.term}</span>: {res.results.length} result{res.results.length === 1 ? "" : "s"} in{" "}
              {(res.ms / 1000).toFixed(1)}s.
            </p>
            {res.results.map((r, i) => (
              <div key={i} className="rounded-lg bg-gray-900/50 p-3 text-sm ring-1 ring-gray-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{r.title ?? "Untitled"}</span>
                  {r.mediaType && <span className="badge badge-dark">{r.mediaType}</span>}
                </div>
                <div className="text-gray-300">
                  {r.authorName ?? "No author"}
                  {r.narrator ? `, narrated by ${r.narrator}` : ""}
                </div>
                <div className="mt-1 font-mono text-xs text-gray-500">
                  book {r.foreignBookId ?? "?"} · author {r.foreignAuthorId ?? "?"} · row {r.id || "new"}
                  {r.editions != null ? ` · ${r.editions} editions` : ""}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {(["audiobook", "ebook"] as const)
                    .map((f) => {
                      const l = r.inChaptarr[f];
                      return `${f === "audiobook" ? "Audiobook" : "Ebook"}: ${
                        l ? `in Chaptarr (#${l.id}${l.monitored ? ", monitored" : ", not monitored"}${l.hasFiles ? ", has files" : ""})` : "not in Chaptarr"
                      }`;
                    })
                    .join(" · ")}
                </div>
              </div>
            ))}
            {res.sample && (
              <details className="rounded-lg bg-gray-900/50 p-3 text-xs ring-1 ring-gray-700">
                <summary className="cursor-pointer text-gray-300">Raw answer for the first result</summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-gray-400">{res.sample}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChaptarrSettings({
  s,
  set,
  locked,
  configured,
  testResult,
  actions,
  refreshKey,
}: {
  s: Settings;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  locked: (k: keyof Settings) => boolean;
  configured: boolean;
  testResult: ReactNode;
  actions: ReactNode;
  /** Changes after each save, so "Saved settings use" reflects what was saved. */
  refreshKey: number;
}) {
  const [options, setOptions] = useState<ChaptarrOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  useEffect(() => {
    if (!configured) return;
    api<ChaptarrOptions>("/chaptarr/options")
      .then(setOptions)
      .catch((e) => setOptionsError((e as Error).message));
  }, [configured, refreshKey]);

  return (
    <>
      <div className="form-row">
        <label>
          Server URL
          <span className="label-tip">As this container sees it, e.g. http://chaptarr:8789</span>
        </label>
        <div className="form-input-area">
          <input className="input" placeholder="http://chaptarr:8789" value={s.chaptarrUrl} disabled={locked("chaptarrUrl")} onChange={(e) => set("chaptarrUrl", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label>
          API key
          <span className="label-tip">In Chaptarr under Settings, General.</span>
        </label>
        <div className="form-input-area">
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            value={s.chaptarrApiKey}
            disabled={locked("chaptarrApiKey")}
            onChange={(e) => set("chaptarrApiKey", e.target.value)}
            onFocus={(e) => e.target.value.startsWith("•") && set("chaptarrApiKey", "")}
          />
        </div>
      </div>
      {testResult}
      <div className="form-row">
        <label>
          Requests
          <span className="label-tip">Shows Request buttons and sends requests to Chaptarr. Off until you turn it on.</span>
        </label>
        <div className="form-input-area flex items-center gap-3 sm:pt-2">
          <Toggle checked={s.requestsEnabled} onChange={(v) => set("requestsEnabled", v)} />
          <span className="text-sm text-gray-300">{s.requestsEnabled ? "On" : "Off"}</span>
        </div>
      </div>
      <div className="form-row">
        <label>
          Request as
          <span className="label-tip">What the Request button picks first. You can change it on each request.</span>
        </label>
        <div className="form-input-area flex flex-wrap gap-4 sm:pt-2">
          {(
            [
              ["audiobook", "Audiobook"],
              ["ebook", "Ebook"],
              ["both", "Both"],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 text-sm text-white">
              <input
                type="radio"
                name="requestFormat"
                className="h-4 w-4 border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                checked={s.requestFormat === id}
                onChange={() => set("requestFormat", id)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>
          Search right away
          <span className="label-tip">Chaptarr looks for a release as soon as a book is added. Off: it waits for its next scheduled search.</span>
        </label>
        <div className="form-input-area flex items-center gap-3 sm:pt-2">
          <Toggle checked={s.requestSearchNow} onChange={(v) => set("requestSearchNow", v)} />
        </div>
      </div>
      <div className="form-row">
        <label>
          Tag requests in Chaptarr
          <span className="label-tip">
            Tag the author of each requested book in Chaptarr with who asked for it, like Seerr does in Sonarr and Radarr. Chaptarr keeps tags on
            authors, not single books. {"{user}"} is their username. Nothing is written to your files or to Audiobookshelf.
          </span>
        </label>
        <div className="form-input-area space-y-2 sm:pt-2">
          <Toggle checked={s.chaptarrTagRequests} onChange={(v) => set("chaptarrTagRequests", v)} />
          {s.chaptarrTagRequests && (
            <>
              <input className="input max-w-xs" value={s.chaptarrTagFormat} onChange={(e) => set("chaptarrTagFormat", e.target.value)} placeholder="{user}" />
              <p className="text-xs text-gray-400">
                Looks like: <span className="badge badge-dark">{(s.chaptarrTagFormat || "{user}").replace(/\{user\}/g, "nathan").toLowerCase()}</span>
              </p>
            </>
          )}
        </div>
      </div>
      {optionsError && (
        <div className="form-row">
          <label>Folders and profiles</label>
          <p className="form-input-area text-sm text-red-300">{optionsError}</p>
        </div>
      )}
      {options && (
        <>
          <FormatPicks format="audiobook" s={s} set={set} options={options} locked={false} />
          <FormatPicks format="ebook" s={s} set={set} options={options} locked={false} />
        </>
      )}
      {!configured && (
        <div className="form-row">
          <label>Folders and profiles</label>
          <p className="form-input-area text-sm text-gray-400 sm:pt-2">Save the URL and API key to pick folders and profiles.</p>
        </div>
      )}
      {configured && <Lookup />}
      {actions}
    </>
  );
}

export function testMessage(r: { appName: string; version: string | null; rootFolders: number; qualityProfiles: number; metadataProfiles: number }) {
  return (
    <span>
      Connected to {r.appName}
      {r.version ? ` ${r.version}` : ""}. {r.rootFolders} root folders, {r.qualityProfiles} quality profiles, {r.metadataProfiles} metadata profiles.
    </span>
  );
}
