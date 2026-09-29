import { BrandLockup } from "@/components/brand/BrandMark";

export function HomeOverviewHeader({
  today,
}: {
  today: { iso: string; label: string };
}) {
  return (
    <header className="min-w-0">
      <BrandLockup href={null} name="Scalers" size="sm" />
      <p className="mt-2 truncate text-sm text-ink-soft">
        <time dateTime={today.iso}>{today.label}</time>
      </p>
    </header>
  );
}
