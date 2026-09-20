import { BrandLockup } from "@/components/brand/BrandMark";
import { deskListTitleClass } from "@/components/ui/deskChrome";

export function HomeOverviewHeader({
  business,
  today,
}: {
  business: string;
  today: { iso: string; label: string };
}) {
  return (
    <header className="min-w-0">
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex min-h-11 shrink-0 items-center md:hidden" aria-hidden>
          <BrandLockup href={null} name="Scalers" size="xs" markOnly />
        </span>
        <div className="min-w-0 flex-1">
          <h1
            className={`${deskListTitleClass} min-h-11 min-w-0 truncate`}
            aria-label={`Scalers. ${business}`}
          >
            {business}
          </h1>
          <p className="mt-1 truncate text-sm text-ink-soft">
            <time dateTime={today.iso}>{today.label}</time>
          </p>
        </div>
      </div>
    </header>
  );
}
