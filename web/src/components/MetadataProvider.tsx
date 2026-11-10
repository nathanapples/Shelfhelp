import { useEffect, useState, type ReactNode } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon, EyeIcon, EyeSlashIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { api, duration, timeAgo } from "../lib/api";
import { Spinner, Toggle } from "./ui";
import { useToast } from "./toast";

interface ProviderState {
  enabled: boolean;
  address: string;
  language: string;
  bookFallback: boolean;
  moodTags: boolean;
  url: string | null;
  key: string;
  registered: { id: string; name: string; url: string; currentKey: boolean }[] | null;
  registerError: string | null;
  lastRequest: { at: number; query: string; author: string | null; matches: number; ms: number; error: string | null } | null;
}

/** One match as Audiobookshelf receives it. Duration is in minutes. */
interface Match {
  title: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  publisher?: string;
  publishedYear?: string;
  cover?: string;
  isbn?: string;
  asin?: string;
  genres?: string[];
  tags?: string[];
  series?: { series: string; sequence?: string }[];
  language?: string;
  duration?: number;
}

type Result = { ok: boolean; message: ReactNode } | null;

function Note({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <div
      className={`mt-4 flex max-w-6xl items-start gap-2 rounded-md p-3 text-sm ring-1 ${
        result.ok ? "bg-green-900/20 text-green-200 ring-green-800" : "bg-red-900/30 text-red-200 ring-red-800"
      }`}
    >
      {result.ok ? <CheckCircleIcon className="h-5 w-5 flex-shrink-0" /> : <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />}
      <div>{result.message}</div>
    </div>
  );
}

const SUGGESTED = "http://shelfhelp:5075";

/**
 * Settings, Audiobookshelf: Shelfhelp as a custom metadata provider, so
 * Audiobookshelf's Match gets Hardcover's audiobook editions.
 */
export function MetadataProviderSettings() {
  const toast = useToast();
  const [p, setP] = useState<ProviderState | null>(null);
  const [form, setForm] = useState<Pick<ProviderState, "enabled" | "address" | "language" | "bookFallback" | "moodTags"> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [showKey, setShowKey] = useState(false);
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");
  const [preview, setPreview] = useState<{ matches: Match[]; ms: number } | null>(null);

  const load = async () => {
    const s = await api<ProviderState>("/settings/abs-provider");
    setP(s);
    setForm((f) => f ?? { enabled: s.enabled, address: s.address, language: s.language, bookFallback: s.bookFallback, moodTags: s.moodTags });
    return s;
  };
  useEffect(() => {
    load().catch((e) => setResult({ ok: false, message: (e as Error).message }));
  }, []);

  if (!p || !form) return null;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });
  const url = form.address.trim() ? `${form.address.trim().replace(/\/+$/, "")}/api/abs-provider` : null;
  const inAbs = p.registered?.[0] ?? null;
  const outdated = !!inAbs && !!url && inAbs.url.replace(/\/+$/, "") !== url;
  const oldKey = !!inAbs && !inAbs.currentKey;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const register = async () => {
    const r = await api<{ unchanged: boolean; replaced: number; librariesKept: number; provider: { url: string } }>("/settings/abs-provider/register", { method: "POST" });
    await load();
    setResult({
      ok: true,
      message: r.unchanged ? (
        "Shelfhelp is already in Audiobookshelf with this address and key."
      ) : (
        <>
          Added to Audiobookshelf as "Hardcover audiobooks (Shelfhelp)" at <span className="font-mono">{r.provider.url}</span>.
          {r.replaced > 0 && " The older Shelfhelp entry was replaced."}
          {r.librariesKept > 0 && ` ${r.librariesKept} ${r.librariesKept === 1 ? "library still uses" : "libraries still use"} it as the default.`} Press Test to check
          Audiobookshelf can reach it.
        </>
      ),
    });
  };

  const save = () =>
    run("save", async () => {
      await api("/settings/abs-provider", { method: "PUT", body: form });
      const s = await load();
      toast("Settings saved");
      // Keep Audiobookshelf's entry in step with the address.
      if (
        form.enabled &&
        s.url &&
        !s.registerError &&
        (s.registered?.length !== 1 || s.registered[0].url.replace(/\/+$/, "") !== s.url || !s.registered[0].currentKey)
      )
        await register();
    });

  const test = () =>
    run("test", async () => {
      const r = await api<{ title: string; author: string | null; count: number; first: Match | null; url: string }>("/settings/abs-provider/test", {
        method: "POST",
        body: { title: q, author },
      });
      await load();
      setResult({
        ok: r.count > 0,
        message:
          r.count > 0 ? (
            <>
              Audiobookshelf reached Shelfhelp and got {r.count} match{r.count === 1 ? "" : "es"} for {r.title}
              {r.first?.narrator ? `. First: narrated by ${r.first.narrator}` : ""}
              {r.first?.duration ? `, ${duration(r.first.duration * 60)}` : ""}.
            </>
          ) : (
            `Audiobookshelf reached Shelfhelp, but there were no matches for ${r.title}. Try another book in the search box below.`
          ),
      });
    });

  const search = () =>
    run("preview", async () => {
      setPreview(await api<{ matches: Match[]; ms: number }>(`/settings/abs-provider/preview?q=${encodeURIComponent(q)}&author=${encodeURIComponent(author)}`));
    });

  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast("Copied"),
      () => toast("Couldn't copy", "error"),
    );

  return (
    <section className="mb-10">
      <h3 className="heading">Hardcover metadata provider</h3>
      <p className="description">
        Lets Audiobookshelf's Match use Hardcover. Each audiobook edition is its own match, with its narrator, length, audio publisher, ASIN and cover, plus
        the book's description, series and genres. Shelfhelp answers these searches itself, so there's nothing else to run.
      </p>

      <div className="form-row">
        <label>Turn on</label>
        <div className="form-input-area">
          <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} />
        </div>
      </div>

      <div className="form-row">
        <label>
          Address Audiobookshelf uses
          <span className="label-tip">
            How Audiobookshelf reaches Shelfhelp from its own container: {SUGGESTED} when both are on the same Docker network, or your server's IP and port. Not an
            address behind a login page like Cloudflare Access.
          </span>
        </label>
        <div className="form-input-area">
          <input className="input" placeholder={SUGGESTED} value={form.address} onChange={(e) => set("address", e.target.value)} />
          {url && <p className="mt-2 break-all font-mono text-xs text-gray-400">Provider URL: {url}</p>}
        </div>
      </div>

      <div className="form-row">
        <label>
          Language
          <span className="label-tip">Only audiobook editions in this language, like English. Leave it empty for every language.</span>
        </label>
        <div className="form-input-area">
          <input className="input sm:max-w-xs" placeholder="Any language" value={form.language} onChange={(e) => set("language", e.target.value)} />
        </div>
      </div>

      <div className="form-row">
        <label>
          Books without an audiobook edition
          <span className="label-tip">Still show the book, without narrator or length, when Hardcover has no audiobook edition of it.</span>
        </label>
        <div className="form-input-area">
          <Toggle checked={form.bookFallback} onChange={(v) => set("bookFallback", v)} />
        </div>
      </div>

      <div className="form-row">
        <label>
          Moods as tags
          <span className="label-tip">Send Hardcover's moods, like "adventurous" or "dark", as Audiobookshelf tags. Genres are always sent.</span>
        </label>
        <div className="form-input-area">
          <Toggle checked={form.moodTags} onChange={(v) => set("moodTags", v)} />
        </div>
      </div>

      <div className="form-row">
        <label>
          In Audiobookshelf
          <span className="label-tip">Shelfhelp adds itself under Audiobookshelf's Settings, Item Metadata Utils, Custom Metadata Providers. Pick it in Match, or as a library's default.</span>
        </label>
        <div className="form-input-area space-y-3 sm:pt-2">
          {p.registerError ? (
            <p className="text-sm text-yellow-300">{p.registerError}</p>
          ) : inAbs ? (
            <p className="text-sm text-gray-300">
              Added as <span className="text-white">{inAbs.name}</span> at <span className="break-all font-mono text-xs">{inAbs.url}</span>
              {outdated && <span className="block text-yellow-300">That's not the address above. Save to update it.</span>}
              {!outdated && oldKey && <span className="block text-yellow-300">It has an old key. Save or press Add again to update it.</span>}
            </p>
          ) : (
            <p className="text-sm text-gray-400">Not added yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm btn-default" disabled={!!busy || !p.url || !!p.registerError} onClick={() => run("register", register)}>
              {busy === "register" && <Spinner className="h-4 w-4" />} {inAbs ? "Add again" : "Add to Audiobookshelf"}
            </button>
            {inAbs && (
              <button
                className="btn btn-sm btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  run("remove", async () => {
                    await api("/settings/abs-provider/unregister", { method: "POST" });
                    await load();
                    setResult({ ok: true, message: "Removed from Audiobookshelf. Libraries that used it as their default went back to Google Books." });
                  })
                }
              >
                Remove
              </button>
            )}
          </div>
          {!p.url && <p className="text-xs text-gray-500">Save an address first.</p>}
        </div>
      </div>

      <div className="form-row">
        <label>
          Key
          <span className="label-tip">Audiobookshelf sends this with every search. Only needed if you add the provider by hand. A new key updates Audiobookshelf too.</span>
        </label>
        <div className="form-input-area">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1 font-mono sm:max-w-md" readOnly value={showKey ? p.key : "•".repeat(24)} aria-label="Provider key" />
            <button className="btn btn-sm btn-ghost" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "Hide key" : "Show key"}>
              {showKey ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
            <button className="btn btn-sm btn-default" onClick={() => copy(p.key)}>
              Copy
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={!!busy}
              onClick={() =>
                run("key", async () => {
                  const r = await api<{ updatedInAbs: boolean; error?: string }>("/settings/abs-provider/key", { method: "POST" });
                  await load();
                  setResult(
                    r.error
                      ? { ok: false, message: `Made a new key, but couldn't update Audiobookshelf: ${r.error}` }
                      : { ok: true, message: inAbs ? "Made a new key and updated Audiobookshelf." : "Made a new key." },
                  );
                })
              }
            >
              New key
            </button>
          </div>
        </div>
      </div>

      <div className="form-row">
        <label>Last search</label>
        <div className="form-input-area text-sm text-gray-300 sm:pt-2">
          {p.lastRequest ? (
            p.lastRequest.error ? (
              <span className="text-yellow-300">
                {timeAgo(new Date(p.lastRequest.at).toISOString())}, "{p.lastRequest.query}" failed: {p.lastRequest.error}
              </span>
            ) : (
              <>
                {timeAgo(new Date(p.lastRequest.at).toISOString())}, "{p.lastRequest.query}": {p.lastRequest.matches} match{p.lastRequest.matches === 1 ? "" : "es"} in{" "}
                {(p.lastRequest.ms / 1000).toFixed(1)} s
              </>
            )
          ) : (
            <span className="text-gray-500">No searches from Audiobookshelf since Shelfhelp started.</span>
          )}
        </div>
      </div>

      <div className="form-row">
        <label>
          Try a search
          <span className="label-tip">See what Audiobookshelf would get, the first match being what Quick Match picks. A title, or an ASIN or ISBN. Test uses this book too.</span>
        </label>
        <div className="form-input-area">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) search();
            }}
          >
            <input className="input flex-1" placeholder="Title, ASIN or ISBN" value={q} onChange={(e) => setQ(e.target.value)} />
            <input className="input sm:max-w-[14rem]" placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
            <button className="btn btn-default" type="submit" disabled={!!busy || !q.trim()}>
              {busy === "preview" ? <Spinner className="h-4 w-4" /> : <MagnifyingGlassIcon className="h-4 w-4" />} Search
            </button>
          </form>
          {preview && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-gray-500">
                {preview.matches.length} match{preview.matches.length === 1 ? "" : "es"} in {(preview.ms / 1000).toFixed(1)} s
              </p>
              <ul className="divide-y divide-gray-700 overflow-hidden rounded-lg ring-1 ring-gray-700">
                {preview.matches.map((m, i) => (
                  <li key={i} className="flex gap-3 bg-gray-800/60 p-3">
                    {m.cover ? (
                      <img src={m.cover} alt="" className="h-20 w-20 flex-shrink-0 rounded object-cover" loading="lazy" />
                    ) : (
                      <div className="h-20 w-20 flex-shrink-0 rounded bg-gray-700" />
                    )}
                    <div className="min-w-0 text-sm">
                      <div className="font-medium text-white">
                        {m.title}
                        {i === 0 && <span className="ml-2 rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-200">Quick Match</span>}
                      </div>
                      <div className="text-gray-400">{[m.author, m.narrator && `narrated by ${m.narrator}`].filter(Boolean).join(", ")}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {[
                          m.duration ? duration(m.duration * 60) : "No audiobook edition",
                          m.publisher,
                          m.publishedYear,
                          m.language,
                          m.asin && `ASIN ${m.asin}`,
                          m.series?.map((s) => (s.sequence ? `${s.series} #${s.sequence}` : s.series)).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <Note result={result} />
      <div className="mt-8 flex max-w-6xl justify-end gap-3 border-t border-gray-700 pt-5">
        <button className="btn btn-warning" onClick={test} disabled={!!busy || !inAbs || !p.enabled}>
          {busy === "test" && <Spinner className="h-4 w-4 text-white" />} Test
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy}>
          {busy === "save" ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </section>
  );
}
