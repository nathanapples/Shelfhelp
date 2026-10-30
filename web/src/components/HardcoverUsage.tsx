import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { timeAgo } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Spinner } from "./ui";

interface Usage {
  plan: string | null;
  perMinute: number | null;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  dailyUsed: number | null;
  dailyResetsIn: number | null;
  seenAt: string;
}

const hours = (s: number | null) => {
  if (s == null) return null;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

function Meter({ u }: { u: Usage }) {
  const pct = u.dailyLimit && u.dailyUsed != null ? Math.min(100, (u.dailyUsed / u.dailyLimit) * 100) : null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="text-white">
          {u.dailyUsed != null && u.dailyLimit ? (
            <>
              <b>{u.dailyUsed.toLocaleString()}</b> <span className="text-gray-400">of {u.dailyLimit.toLocaleString()} requests today</span>
            </>
          ) : (
            <span className="text-gray-400">Hardcover didn't report a daily count</span>
          )}
        </span>
        <span className="text-xs text-gray-500">
          {[u.plan, u.perMinute ? `${u.perMinute}/min` : null, u.dailyResetsIn != null ? `resets in ${hours(u.dailyResetsIn)}` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      {pct != null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-700/70">
          <div className={`h-full rounded-full ${pct > 85 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * Hardcover API usage as Hardcover reports it on each answer. The daily count
 * is per Hardcover account, so keys from the same account share it.
 */
export function HardcoverUsage() {
  const { data, error, loading, reload } = useApi<{
    server: Usage | null;
    people: { id: number; name: string; via: "signin" | "key" | null; sharesServerKey: boolean; usage: Usage | null }[];
  }>("/settings/hardcover-usage");

  return (
    <section className="mb-10 max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="heading">API usage</h3>
          <p className="description">What Hardcover reports with each answer. The daily count covers everything on the same Hardcover account, so it includes other apps and keys on it.</p>
        </div>
        <button className="btn btn-default btn-sm" onClick={reload} disabled={loading} title="Refresh">
          {loading ? <Spinner className="h-4 w-4" /> : <ArrowPathIcon className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {data && (
        <div className="mt-4 space-y-4 rounded-xl bg-gray-800 p-4 ring-1 ring-gray-700">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Server key</div>
            {data.server ? <Meter u={data.server} /> : <p className="text-sm text-gray-400">Hardcover didn't report usage for the server key. It may not send usage for this kind of key.</p>}
          </div>
          {data.people.length > 0 && (
            <div className="border-t border-gray-700 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">People's connections</div>
              <ul className="space-y-3">
                {data.people.map((p) => (
                  <li key={p.id}>
                    <div className="mb-1 text-sm font-medium text-gray-200">
                      {p.name}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {p.via === "signin" ? "signed in" : "API key"}
                        {p.sharesServerKey ? " · same key as the server" : ""}
                        {p.usage ? ` · seen ${timeAgo(p.usage.seenAt)}` : ""}
                      </span>
                    </div>
                    {p.usage ? <Meter u={p.usage} /> : <p className="text-xs text-gray-500">Not used since Shelfhelp started.</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
