"use client";

import { Button } from "@/components/ui/Button";
import { DeskError } from "@/components/ui/DeskError";

export function DeskCrash({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  return (
    <div className="max-w-xl">
      <DeskError>
        <p className="font-display text-page tracking-tight text-ink">{title}</p>
      </DeskError>
      <Button onClick={onRetry} className="mt-4">
        Try again
      </Button>
    </div>
  );
}
