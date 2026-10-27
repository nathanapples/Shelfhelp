import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";

type Kind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  message: ReactNode;
}

const Ctx = createContext<(message: ReactNode, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((message: ReactNode, kind: Kind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => remove(id), kind === "error" ? 8000 : 4000);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-4 sm:items-end sm:pr-6 sm:pt-20">
        {toasts.map((t) => {
          const Icon = t.kind === "success" ? CheckCircleIcon : t.kind === "error" ? ExclamationTriangleIcon : InformationCircleIcon;
          const color = t.kind === "success" ? "text-green-400" : t.kind === "error" ? "text-red-400" : "text-indigo-400";
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-gray-800 p-4 shadow-lg ring-1 ring-gray-700"
            >
              <Icon className={`h-6 w-6 flex-shrink-0 ${color}`} />
              <div className="flex-1 text-sm font-medium leading-5 text-white">{t.message}</div>
              <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-white" aria-label="Dismiss">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
