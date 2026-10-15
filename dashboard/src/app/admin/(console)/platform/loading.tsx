import { CardSkeleton } from "@/components/platform/PlatformSections";

export default function AdminPlatformLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <CardSkeleton lines={0} />
      <CardSkeleton lines={2} />
      <CardSkeleton lines={1} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CardSkeleton lines={6} />
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}
