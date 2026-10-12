import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { unpricedLabelText } from "./unpricedCopy";

/** One row for every item with no price text. Opens the catalogue filtered to those items. */
export function AddPricesRow({ count, href }: { count: number; href: string }) {
  return (
    <section aria-labelledby="add-prices-title" data-add-prices="">
      <h2 id="add-prices-title" className="mb-2 px-1 text-meta font-medium text-ink-2">
        Add prices
      </h2>
      <Link
        href={href}
        className={`flex min-h-14 items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${deskShiftClass}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink">{unpricedLabelText(count)}</span>
          <span className="block text-meta text-ink-2">Callers hear Ask for these until you add one.</span>
        </span>
        <ChevronRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-3" />
      </Link>
    </section>
  );
}
