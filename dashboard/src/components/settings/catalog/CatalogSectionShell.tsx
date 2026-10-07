import type { ReactNode } from "react";
import type { BusinessVertical } from "@/lib/vertical";

const BLURBS: Record<string, string> = {
  retail: "What you sell and what you offer on the side.",
  home_services: "Jobs you take and how you price them.",
  hospitality: "What guests can order or book.",
  general: "What callers can ask about.",
};

export function CatalogSectionShell({
  vertical,
  title,
  children,
}: {
  vertical: BusinessVertical;
  title: string;
  children: ReactNode;
}) {
  const blurb = BLURBS[vertical] || BLURBS.general;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-title text-ink">{title}</p>
        <p className="mt-0.5 text-meta text-ink-2">{blurb}</p>
      </div>
      {children}
    </div>
  );
}
