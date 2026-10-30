import { CheckIcon } from "@heroicons/react/20/solid";
import { CHECKLIST_TOTAL, SETUP_CHECKLIST, checklistLabel, type ChecklistProgress } from "@/lib/setupChecklist";

/** The 5-item setup checklist. Ticked items are calm and blue; the next one is bold. A thin bar shows the count. */
export function SetupChecklist({ progress, className = "" }: { progress: ChecklistProgress; className?: string }) {
  return (
    <div className={className} data-setup-checklist="">
      <p className="text-meta font-semibold tabular-nums text-ink-2">{checklistLabel(progress.count)}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden data-setup-progress="">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${Math.round((progress.count / CHECKLIST_TOTAL) * 100)}%` }}
        />
      </div>
      <ol className="mt-3 space-y-1.5" aria-label={`Setup checklist, ${checklistLabel(progress.count)}`}>
        {SETUP_CHECKLIST.map((item) => {
          const done = progress.done.has(item.key);
          const current = progress.current === item.key;
          return (
            <li key={item.key} className="flex items-start gap-2" data-done={done || undefined}>
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  done ? "border-accent bg-accent text-white" : current ? "border-accent" : "border-hairline"
                }`}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0">
                <span className={`block text-body ${done ? "text-ink-2" : current ? "font-semibold text-ink" : "text-ink"}`}>
                  {item.title}
                  <span className="sr-only">{done ? ", done" : ""}</span>
                </span>
                {!done ? <span className="block text-meta text-ink-2">{item.detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
