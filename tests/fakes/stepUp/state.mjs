/** Shared harness state: one in-memory DB, the current request's cookies, the signed-in operator. */
const g = globalThis;
g.__stepUpHarness ??= { db: {}, jar: new Map(), operator: "alvin", mail: [] };
export const H = g.__stepUpHarness;
