import type { ReactNode } from "react";
import { Empty } from "@/components/ui/Empty";

export function QualityEmpty({
  title = "No traced calls yet.",
  action,
}: {
  title?: string;
  action?: ReactNode;
}) {
  return (
    <Empty
      title={title}
      line="Tracing is on for staging and off for production."
      action={action}
    />
  );
}
