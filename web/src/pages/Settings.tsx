import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import ActivityLog from "./Activity";
import { CheckCircleIcon, ExclamationTriangleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { api, type Library, type Settings, type Status } from "../lib/api";
import { ErrorBlock, LoadingBlock, PageTitle, Spinner, Tabs, Toggle } from "../components/ui";
import { useToast } from "../components/toast";

type Tab = "general" | "hardcover" | "abs" | "activity" | "about";
const TABS: Tab[] = ["general", "hardcover", "abs", "activity", "about"];

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h3 className="heading">{title}</h3>
      <p className="description">{description}</p>
      {children}
    </section>
  );
}

function Locked() {
  return (
    <span className="mt-2 flex items-center gap-1 text-xs text-gray-500">
      <LockClosedIcon className="h-3.5 w-3.5" /> Set by an environment variable
    </span>
  );
}

function TestResult({ result }: { result: { ok: boolean; message: ReactNode } | null }) {
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

export default function SettingsPage({ status, onSaved }: { status: Status; onSaved: () => void }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab =
    asked && TABS.includes(asked) ? asked : !status.configured.hardcover ? "hardcover" : !status.configured.abs ? "abs" : "general";
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: ReactNode } | null>(null);

  useEffect(() => {
    api<Settings>("/settings").then(setS).catch((e) => setError(e.message));
  }, []);
  useEffect(() => setTest(null), [tab]);
  const [libs, setLibs] = useState<(Library & { selected: boolean })[] | null>(null);
  useEffect(() => {
    if (tab !== "abs" || !status.configured.abs) return;
    api<(Library & { selected: boolean })[]>("/abs/libraries?all=1").then(setLibs).catch(() => setLibs([]));
  }, [tab, status.configured.abs]);

  if (error) return <ErrorBlock message={error} />;
  if (!s) return <LoadingBlock />;

  const locked = (k: keyof Settings) => s.lockedByEnv.includes(k);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  const save = async (keys: (keyof Settings)[]) => {
    setSaving(true);
    try {
      const body = Object.fromEntries(keys.filter((k) => !locked(k)).map((k) => [k, s[k]]));
      const saved = await api<Settings>("/settings", { method: "PUT", body });
      setS({ ...saved, lockedByEnv: s.lockedByEnv });
      toast("Settings saved");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const testHardcover = async () => {
    setTesting(true);
    try {
      const r = await api<{ username: string }>("/settings/test/hardcover", { method: "POST", body: { token: s.hardcoverToken } });
      setTest({ ok: true, message: <>Connected to Hardcover as <b>@{r.username}</b>.</> });
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const testAbs = async () => {
    setTesting(true);
    try {
      const r = await api<{ username: string; type: string; canUpdate: boolean; libraries: Library[] }>("/settings/test/abs", {
        method: "POST",
        body: { url: s.absUrl, token: s.absToken },
      });
      setTest({
        ok: r.canUpdate,
        message: (
          <>
            Connected as <b>{r.username}</b> ({r.type}). Book libraries: {r.libraries.map((l) => l.name).join(", ") || "none"}.
            {!r.canUpdate && <> This user can't update collections; give it the "Can Update" permission or use an admin key.</>}
          </>
        ),
      });
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const actions = (keys: (keyof Settings)[], onTest?: () => void) => (
    <div className="mt-8 flex max-w-6xl justify-end gap-3 border-t border-gray-700 pt-5">
      {onTest && (
        <button className="btn btn-warning" onClick={onTest} disabled={testing}>
          {testing && <Spinner className="h-4 w-4 text-white" />} Test
        </button>
      )}
      <button className="btn btn-primary" onClick={() => save(keys)} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );

  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "general", label: "General" },
          { id: "hardcover", label: status.configured.hardcover ? "Hardcover" : "Hardcover ●" },
          { id: "abs", label: status.configured.abs ? "Audiobookshelf" : "Audiobookshelf ●" },
          { id: "activity", label: "Activity" },
          { id: "about", label: "About" },
        ]}
      />

      {tab === "general" && (
        <Section title="General Settings" description="How often lists sync and how careful matching should be.">
          <div className="form-row">
            <label>
              Sync every
              <span className="label-tip">Minutes between automatic syncs. 0 turns automatic syncing off.</span>
            </label>
            <div className="form-input-area">
              <div className="flex max-w-xs items-center gap-3">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={s.syncIntervalMinutes}
                  disabled={locked("syncIntervalMinutes")}
                  onChange={(e) => set("syncIntervalMinutes", Number(e.target.value))}
                />
                <span className="text-gray-400">minutes</span>
              </div>
              {locked("syncIntervalMinutes") && <Locked />}
            </div>
          </div>
          <div className="form-row">
            <label>
              Matching
              <span className="label-tip">How close a book has to be before it's added without asking you.</span>
            </label>
            <div className="form-input-area space-y-3">
              {(
                [
                  ["strict", "Strict", "Fewest automatic matches. More ends up in Review."],
                  ["balanced", "Balanced", "Recommended. Exact-looking title and author, or an ASIN/ISBN that agrees with them."],
                  ["loose", "Loose", "Adds more on its own. Better for tidy libraries."],
                ] as const
              ).map(([id, label, tip]) => (
                <label key={id} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="strictness"
                    className="mt-1 h-4 w-4 border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                    checked={s.matchStrictness === id}
                    onChange={() => set("matchStrictness", id)}
                  />
                  <span>
                    <span className="font-medium text-white">{label}</span>
                    <span className="block text-xs text-gray-400">{tip}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {actions(["syncIntervalMinutes", "matchStrictness"])}
        </Section>
      )}

      {tab === "hardcover" && (
        <Section
          title="Hardcover"
          description={
            <>
              Your Hardcover API token. Get it from{" "}
              <a className="text-indigo-400 hover:underline" href="https://hardcover.app/account/api" target="_blank" rel="noreferrer">
                hardcover.app/account/api
              </a>
              .
            </>
          }
        >
          <div className="form-row">
            <label>API token</label>
            <div className="form-input-area">
              <input
                className="input font-mono"
                type="password"
                autoComplete="off"
                placeholder="hc_pat_..."
                value={s.hardcoverToken}
                disabled={locked("hardcoverToken")}
                onChange={(e) => set("hardcoverToken", e.target.value)}
                onFocus={(e) => e.target.value.startsWith("•") && set("hardcoverToken", "")}
              />
              {locked("hardcoverToken") && <Locked />}
            </div>
          </div>
          <TestResult result={test} />
          {actions(["hardcoverToken"], testHardcover)}
        </Section>
      )}

      {tab === "abs" && (
        <Section
          title="Audiobookshelf"
          description="The address of your server and an API key. Create a key in Audiobookshelf under Settings, API Keys, for a user that can update."
        >
          <div className="form-row">
            <label>
              Server URL
              <span className="label-tip">As this container sees it, e.g. http://audiobookshelf:80</span>
            </label>
            <div className="form-input-area">
              <input
                className="input"
                placeholder="http://audiobookshelf:80"
                value={s.absUrl}
                disabled={locked("absUrl")}
                onChange={(e) => set("absUrl", e.target.value)}
              />
              {locked("absUrl") && <Locked />}
            </div>
          </div>
          <div className="form-row">
            <label>API key</label>
            <div className="form-input-area">
              <input
                className="input font-mono"
                type="password"
                autoComplete="off"
                value={s.absToken}
                disabled={locked("absToken")}
                onChange={(e) => set("absToken", e.target.value)}
                onFocus={(e) => e.target.value.startsWith("•") && set("absToken", "")}
              />
              {locked("absToken") && <Locked />}
            </div>
          </div>
          <TestResult result={test} />
          {libs && libs.length > 0 && (
            <div className="form-row">
              <label>
                Libraries
                <span className="label-tip">Every book library is used unless you uncheck it. Applies to collections and reading. Podcast libraries are never used.</span>
              </label>
              <div className="form-input-area space-y-3 sm:pt-2">
                {libs.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                      checked={l.selected}
                      onChange={() => {
                        const next = libs.map((x) => (x.id === l.id ? { ...x, selected: !x.selected } : x));
                        setLibs(next);
                        // Every library checked is saved as "all", so new libraries are included too.
                        set("absLibraries", next.every((x) => x.selected) ? [] : next.filter((x) => x.selected).map((x) => x.id));
                      }}
                    />
                    <span className="text-white">{l.name}</span>
                  </label>
                ))}
                {libs.every((l) => !l.selected) && <p className="text-xs text-yellow-300">Pick at least one library.</p>}
              </div>
            </div>
          )}
          {actions(["absUrl", "absToken", "absLibraries"], testAbs)}
        </Section>
      )}

      {tab === "activity" && (
        <Section title="Activity" description="Syncs, changes and errors, newest first.">
          <div className="mt-6 max-w-6xl">
            <ActivityLog />
          </div>
        </Section>
      )}

      {tab === "about" && (
        <Section title="About Shelfhelp" description="Keeps Audiobookshelf collections in step with Hardcover lists.">
          <dl className="mt-6 max-w-2xl divide-y divide-gray-700 rounded-xl bg-gray-800 ring-1 ring-gray-700">
            {[
              ["Version", status.version],
              ["Source", <a key="s" className="text-indigo-400 hover:underline" href="https://github.com/nathanapples/shelfhelp" target="_blank" rel="noreferrer">github.com/nathanapples/shelfhelp</a>],
              ["Coming later", "Requests through Chaptarr, and read status sync per user"],
            ].map(([k, v]) => (
              <div key={String(k)} className="grid grid-cols-3 gap-4 px-5 py-3 text-sm">
                <dt className="font-medium text-gray-400">{k}</dt>
                <dd className="col-span-2 text-gray-200">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </div>
  );
}
