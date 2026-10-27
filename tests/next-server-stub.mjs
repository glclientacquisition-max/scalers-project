/**
 * Stand-in for "next/server" when the root CI job runs node:test without dashboard
 * dependencies (only `npm ci` at the repo root). Used only if the real package does
 * not resolve; with dashboard/node_modules present the real Next module still loads.
 */
export function after(task) {
  const run = typeof task === "function" ? task : () => task;
  queueMicrotask(() => {
    Promise.resolve()
      .then(run)
      .catch(() => {});
  });
}
export class NextResponse extends Response {
  static json(body, init) {
    return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  }
}
export async function connection() {}
