/**
 * Resolve hook for the Unlock window integration tests (tests/adminUnlockWindow.test.mjs).
 * Real route handlers + real stepUpGate/stepUpCore/stepUpStore/adminAudit run against these fakes:
 * an in-memory Supabase, a cookie jar per request, the signed-in operator, and no email.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const fake = (f) => ({ shortCircuit: true, url: pathToFileURL(path.join(here, f)).href });
const MAP = {
  "server-only": "empty.mjs",
  "next/headers": "nextHeaders.mjs",
  "next/server": "nextServer.mjs",
  "@/lib/supabase": "supabase.mjs",
  "@/lib/adminOperatorWrite": "operator.mjs",
  "@/lib/opsMail": "opsMail.mjs",
  "@/lib/auth": "auth.mjs",
  "@/lib/admin-auth": "adminAuth.mjs",
  "@supabase/ssr": "supabaseSsr.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) return fake(MAP[specifier]);
  return nextResolve(specifier, context);
}
