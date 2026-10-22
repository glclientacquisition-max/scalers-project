/**
 * Lets node:test import dashboard modules that mark themselves server-only,
 * resolves "@/…" to dashboard/src, and resolves extensionless TypeScript imports.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const DASH_SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../dashboard/src");

async function withTsExtension(specifier, context, nextResolve) {
  for (const ext of [".ts", ".js"]) {
    try {
      return await nextResolve(`${specifier}${ext}`, context);
    } catch (err) {
      if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    }
  }
  return nextResolve(specifier, context);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: new URL("./server-only-empty.mjs", import.meta.url).href,
    };
  }
  let spec = specifier;
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(DASH_SRC, spec.slice(2))).href;
  }
  const local = spec.startsWith("./") || spec.startsWith("../") || spec !== specifier;
  if (
    local &&
    !/\.[a-z]+$/i.test(spec)
  ) {
    return withTsExtension(spec, context, nextResolve);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".tsx") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".json")
  ) {
    return withTsExtension(specifier, context, nextResolve);
  }
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
