"use client";

import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";

export type CaptureConfirmRow = {
  path: string;
  title: string;
  preview: string;
  confirmed: boolean;
};

export function CaptureConfirmList({
  rows,
  onConfirm,
  onConfirmAll,
  pending = false,
}: {
  rows: CaptureConfirmRow[];
  onConfirm: (path: string) => void;
  onConfirmAll: (paths: string[]) => void;
  pending?: boolean;
}) {
  const open = rows.filter((row) => row.title.trim() && !row.confirmed);
  if (!rows.some((row) => row.title.trim())) return null;

  return (
    <div className="space-y-2">
      {open.length > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="tonal"
            size="sm"
            disabled={pending}
            onClick={() => onConfirmAll(open.map((row) => row.path))}
          >
            Confirm all in this section
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {rows
          .filter((row) => row.title.trim())
          .map((row) => (
            <ListRow
              key={row.path}
              title={row.title}
              preview={row.preview}
              stamp={
                <Stamp tone={row.confirmed ? "ok" : "neutral"}>
                  {row.confirmed ? "Confirmed" : "Suggested"}
                </Stamp>
              }
              actions={
                row.confirmed ? null : (
                  <Button
                    type="button"
                    variant="tonal"
                    size="sm"
                    disabled={pending}
                    onClick={() => onConfirm(row.path)}
                  >
                    Confirm
                  </Button>
                )
              }
            />
          ))}
      </ul>
    </div>
  );
}
