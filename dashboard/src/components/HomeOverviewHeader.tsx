import { BrandLockup } from "@/components/brand/BrandMark";

export function HomeOverviewHeader({
  business,
  today,
}: {
  business: string;
  today: { iso: string; label: string };
}) {
  return (
    <header className="min-w-0">
      <BrandLockup href={null} name="Scalers" size="sm" />
      <h1 className="mt-2 min-w-0 truncate text-lg font-semibold text-ink">
        {business}
      </h1>
      <p className="mt-1 truncate text-sm text-ink-soft">
        <time dateTime={today.iso}>{today.label}</time>
      </p>
    </header>
  );
}
