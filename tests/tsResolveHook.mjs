import { pathToFileURL } from "node:url";
import path from "node:path";

// Desk TS under node --experimental-strip-types: extensionless relative
// imports get ".ts" (else ".js"), "@/x" maps to dashboard/src/x.ts, and bare JSON imports
// (bundler style, no import attribute) load as JSON.
const DASH_SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../dashboard/src");

async function withTsExtension(specifier, context, nextResolve) {
  try {
    return await nextResolve(`${specifier}.ts`, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    return nextResolve(`${specifier}.js`, context);
  }
}

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(DASH_SRC, spec.slice(2))).href;
  const local = spec.startsWith("./") || spec.startsWith("../") || spec !== specifier;
  if (local && !/\.[a-z]+$/i.test(spec)) return withTsExtension(spec, context, nextResolve);
  return nextResolve(spec, context);
}

export async function load(url, context, nextLoad) {
  if (/\.json$/i.test(url) && !context.importAttributes?.type) {
    return nextLoad(url, {
      ...context,
      importAttributes: { ...(context.importAttributes || {}), type: "json" },
    });
  }
  return nextLoad(url, context);
}
