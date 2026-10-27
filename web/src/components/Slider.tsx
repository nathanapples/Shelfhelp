import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRightCircleIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

export function Slider({ title, to, extra, children }: { title: ReactNode; to?: string; extra?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="mb-6">
      <div className="mb-2 mt-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {to ? (
            <Link to={to} className="group flex min-w-0 items-center gap-2 text-gray-300 hover:text-white">
              <span className="truncate text-xl font-bold leading-7 sm:text-2xl">{title}</span>
              <ArrowRightCircleIcon className="h-6 w-6 flex-shrink-0 transition group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <span className="truncate text-xl font-bold text-gray-300 sm:text-2xl">{title}</span>
          )}
          {extra}
        </div>
        <div className="hidden gap-1 sm:flex">
          <button onClick={() => scroll(-1)} className="rounded-full p-1 text-gray-400 hover:bg-gray-700 hover:text-white" aria-label="Scroll left">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button onClick={() => scroll(1)} className="rounded-full p-1 text-gray-400 hover:bg-gray-700 hover:text-white" aria-label="Scroll right">
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div ref={ref} className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {children}
      </div>
    </section>
  );
}
