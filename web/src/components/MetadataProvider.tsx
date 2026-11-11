import { useEffect, useState, type ReactNode } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon, EyeIcon, EyeSlashIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { api, duration, timeAgo } from "../lib/api";
import { Spinner, Toggle } from "./ui";
import { useToast } from "./toast";

type Kind = "audio" | "books";
const KINDS: Kind[] = ["audio", "books"];
const KIND_LABEL: Record<Kind, string> = { audio: "Audiobooks", books: "Ebooks and print" };

interface ProviderState {
  enabled: boolean;
  address: string;
  language: string;
  bookFallback: boolean;
  moodTags: boolean;
  url: string | null;
  urls: Record<Kind, string | null>;
  names: Record<Kind, string>;
  key: string;
  registered: { id: string; name: string; url: string; kind: Kind; currentKey: boolean }[] | null;
  upToDate: boolean;
  registerError: string | null;
  lastRequest: { at: number; kind: Kind; query: string; author: string | null; matches: number; ms: number; error: string | null } | null;
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
  /** Shelfhelp's own note for the preview: the edition's format, like "Kindle Edition". */
  edition?: string | null;
  /** Shelfhelp's own note for the preview: how popular the book and edition are on Hardcover. */
  popularity?: { rating: number | null; ratings: number | null; bookReaders: number | null; editionReaders: number | null };
}

const count = (n: number) => n.toLocaleString("en-US");

/** "4.2 stars (1,234 ratings) · 5,000 readers · 900 read this edition" */
function popularityLine(p: Match["popularity"]): string | null {
  if (!p) return null;
  const parts = [
    p.rating ? `${p.rating.toFixed(1)} stars${p.ratings ? ` (${count(p.ratings)} rating${p.ratings === 1 ? "" : "s"})` : ""}` : null,
    p.bookReaders ? `${count(p.bookReaders)} reader${p.bookReaders === 1 ? "" : "s"}` : null,
    p.editionReaders !== null ? `${count(p.editionReaders)} read this edition` : null,
  ].filter(Boolean);
  return parts.length ? `On Hardcover: ${parts.join(" · ")}` : null;
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
 * Audiobookshelf's Match gets Hardcover's editions (audiobook, or ebook and print).
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
  const [kind, setKind] = useState<Kind>("audio");
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
  const base = form.address.trim() ? `${form.address.trim().replace(/\/+$/, "")}/api/abs-provider` : null;
  const urlFor = (k: Kind) => (base ? `${base}${k === "books" ? "/books" : ""}` : null);
  const entries = KINDS.map((k) => ({ kind: k, entry: p.registered?.find((r) => r.kind === k) ?? null }));
  const inAbs = !!p.registered?.length;
  const anyMissing = entries.some((e) => !e.entry);

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
    const r = await api<{ unchanged: boolean; added: number; replaced: number; librariesKept: number; providers: { name: string; url: string }[] }>(
      "/settings/abs-provider/register",
      { method: "POST" },
    );
    await load();
    setResult({
      ok: true,
      message: r.unchanged ? (
        "Shelfhelp is already in Audiobookshelf with this address and key."
      ) : (
        <>
          In Audiobookshelf as {r.providers.map((x, i) => (
            <span key={x.url}>
              {i > 0 && " and "}"{x.name}"
            </span>
          ))}
          .{r.replaced > 0 && ` ${r.replaced === 1 ? "An older Shelfhelp entry was" : "Older Shelfhelp entries were"} replaced.`}
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
      // Keep Audiobookshelf's entries in step with the address and key.
      if (form.enabled && s.url && !s.registerError && !s.upToDate) await register();
    });

  const test = () =>
    run("test", async () => {
      const r = await api<{ title: string; results: { kind: Kind; name: string; count: number; first: Match | null }[] }>("/settings/abs-provider/test", {
        method: "POST",
        body: { title: q, author },
      });
      await load();
      const ok = r.results.every((x) => x.count > 0);
      setResult({
        ok,
        message: (
          <>
            Audiobookshelf reached Shelfhelp. For {r.title}:
            <ul className="mt-1 list-disc pl-5">
              {r.results.map((x) => (
                <li key={x.kind}>
                  {x.name}: {x.count} match{x.count === 1 ? "" : "es"}
                  {x.first?.narrator ? `, first narrated by ${x.first.narrator}` : ""}
                  {x.first?.duration ? `, ${duration(x.first.duration * 60)}` : ""}
                  {x.kind === "books" && x.first?.publisher ? `, first from ${x.first.publisher}` : ""}
                </li>
              ))}
            </ul>
            {!ok && <span className="mt-1 block">Try another book in the search box below.</span>}
          </>
        ),
      });
    });

  const search = () =>
    run("preview", async () => {
      setPreview(
        await api<{ matches: Match[]; ms: number }>(
          `/settings/abs-provider/preview?q=${encodeURIComponent(q)}&author=${encodeURIComponent(author)}&kind=${kind}`,
        ),
      );
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
        Lets Audiobookshelf's Match use Hardcover. Each edition is its own match, with its publisher, ISBN or ASIN and cover (and for audiobooks the narrator
        and length), plus the book's description, series and genres. There are two providers: "Hardcover audiobooks" for audiobook libraries and
        "Hardcover books" (ebook editions first, then print) for ebook libraries. Shelfhelp answers these searches itself, so there's nothing else to run.
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
          {base && (
            <div className="mt-2 space-y-0.5 break-all font-mono text-xs text-gray-400">
              {KINDS.map((k) => (
                <p key={k}>
                  {KIND_LABEL[k]}: {urlFor(k)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="form-row">
        <label>
          Language
          <span className="label-tip">Only editions in this language, like English. Leave it empty for every language.</span>
        </label>
        <div className="form-input-area">
          <input className="input sm:max-w-xs" placeholder="Any language" value={form.language} onChange={(e) => set("language", e.target.value)} />
        </div>
      </div>

      <div className="form-row">
        <label>
          Books without a matching edition
          <span className="label-tip">
            Still show the book itself when Hardcover has no edition of the right kind (no audiobook edition for audiobooks, no ebook or print edition for
            books).
          </span>
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
          <span className="label-tip">
            Shelfhelp adds both providers under Audiobookshelf's Settings, Item Metadata Utils, Custom Metadata Providers. Pick one in Match, or set it as a
            library's default in the library's settings: Hardcover books for an ebook library.
          </span>
        </label>
        <div className="form-input-area space-y-3 sm:pt-2">
          {p.registerError ? (
            <p className="text-sm text-yellow-300">{p.registerError}</p>
          ) : inAbs ? (
            <div className="space-y-2 text-sm text-gray-300">
              {entries.map(({ kind: k, entry }) => {
                const outdated = !!entry && !!urlFor(k) && entry.url.replace(/\/+$/, "") !== urlFor(k);
                return entry ? (
                  <p key={k}>
                    <span className="text-white">{entry.name}</span> at <span className="break-all font-mono text-xs">{entry.url}</span>
                    {outdated && <span className="block text-yellow-300">That's not the address above. Save to update it.</span>}
                    {!outdated && !entry.currentKey && <span className="block text-yellow-300">It has an old key. Save or press Add again to update it.</span>}
                  </p>
                ) : (
                  <p key={k} className="text-yellow-300">
                    {p.names[k]} isn't added yet. Save or press Add again to add it.
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Not added yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm btn-default" disabled={!!busy || !p.url || !!p.registerError} onClick={() => run("register", register)}>
              {busy === "register" && <Spinner className="h-4 w-4" />} {inAbs && !anyMissing ? "Add again" : "Add to Audiobookshelf"}
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
                {timeAgo(new Date(p.lastRequest.at).toISOString())}, {KIND_LABEL[p.lastRequest.kind ?? "audio"].toLowerCase()}, "{p.lastRequest.query}" failed:{" "}
                {p.lastRequest.error}
              </span>
            ) : (
              <>
                {timeAgo(new Date(p.lastRequest.at).toISOString())}, {KIND_LABEL[p.lastRequest.kind ?? "audio"].toLowerCase()}, "{p.lastRequest.query}":{" "}
                {p.lastRequest.matches} match{p.lastRequest.matches === 1 ? "" : "es"} in{" "}
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
          <span className="label-tip">
            See what Audiobookshelf would get from each provider, the first match being what Quick Match picks, with how popular each is on Hardcover (the most
            read editions come first). A title, or an ASIN or ISBN. Test uses this book too.
          </span>
        </label>
        <div className="form-input-area">
          <div className="mb-2 inline-flex overflow-hidden rounded-md ring-1 ring-gray-600" role="group" aria-label="Provider">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                className={`px-3 py-1.5 text-sm ${kind === k ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
                onClick={() => {
                  setKind(k);
                  setPreview(null);
                }}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
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
                          m.edition ?? (kind === "audio" ? "No audiobook edition" : "No ebook or print edition"),
                          m.duration && duration(m.duration * 60),
                          m.isbn && `ISBN ${m.isbn}`,
                          m.publisher,
                          m.publishedYear,
                          m.language,
                          m.asin && `ASIN ${m.asin}`,
                          m.series?.map((s) => (s.sequence ? `${s.series} #${s.sequence}` : s.series)).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {popularityLine(m.popularity) && <div className="mt-1 text-xs text-amber-200/80">{popularityLine(m.popularity)}</div>}
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
