import { H } from "./state.mjs";

export async function cookies() {
  return {
    get: (name) => (H.jar.has(name) ? { name, value: H.jar.get(name) } : undefined),
    getAll: () => [...H.jar].map(([name, value]) => ({ name, value })),
  };
}
export async function headers() { return new Headers(); }
