/**
 * Lets node:test import dashboard modules that mark themselves server-only,
 * and resolves extensionless TypeScript and CommonJS imports.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: new URL("./server-only-empty.mjs", import.meta.url).href,
    };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".tsx") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".json")
  ) {
    for (const ext of [".ts", ".js"]) {
      try {
        return await nextResolve(`${specifier}${ext}`, context);
      } catch {
        // try the next extension
      }
    }
    return nextResolve(specifier, context);
  }
  return nextResolve(specifier, context);
}
