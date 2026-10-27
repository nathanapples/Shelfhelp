import { Link } from "react-router-dom";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { timeAgo, type Activity } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Empty, ErrorBlock, LoadingBlock } from "../components/ui";

/** The sync log, shown on the Settings page. */
export default function ActivityLog() {
  const { data, error, loading } = useApi<Activity[]>("/activity", { poll: 5000 });
  return (
    <div>
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data?.length === 0 && <Empty title="Nothing yet">Syncs and changes will show up here.</Empty>}
      {data && data.length > 0 && (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-gray-700">
            {data.map((a) => {
              const Icon = a.level === "error" ? ExclamationTriangleIcon : a.message.startsWith("Synced") ? CheckCircleIcon : InformationCircleIcon;
              const color = a.level === "error" ? "text-red-400" : a.level === "warn" ? "text-yellow-400" : a.message.startsWith("Synced") ? "text-green-400" : "text-indigo-400";
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3 sm:px-6">
                  <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${color}`} />
                  <div className="min-w-0 flex-1 text-sm">
                    {a.listId && a.listName && (
                      <Link to={`/lists/${a.listId}`} className="mr-2 font-semibold text-white hover:underline">
                        {a.listName}
                      </Link>
                    )}
                    <span className={a.level === "error" ? "text-red-200" : "text-gray-300"}>{a.message}</span>
                  </div>
                  <time className="flex-shrink-0 text-xs text-gray-500" title={a.ts}>
                    {timeAgo(a.ts)}
                  </time>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
