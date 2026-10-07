"use client";

import { Pagination } from "@/components/ui/Pagination";

export function CatalogPager({
  page,
  pageSize,
  total,
  noun,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  return (
    <Pagination
      page={page + 1}
      pageSize={pageSize}
      total={total}
      noun={noun}
      onPage={(next) => onPage(next - 1)}
      className="border-t border-hairline bg-surface-canvas px-3 py-3"
    />
  );
}
