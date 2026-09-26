export const DEFAULT_PAGE_SIZE = 25;

export function clampListPage(page: number, total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / size));
  const current = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, current), pages);
}

export function listPageSpan(page: number, pageSize: number, total: number) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const safe = clampListPage(page, total, size);
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / size));
  if (total <= 0) return { page: 1, from: 0, to: 0, pages: 1 };
  const from = (safe - 1) * size + 1;
  const to = Math.min(safe * size, total);
  return { page: safe, from, to, pages };
}
