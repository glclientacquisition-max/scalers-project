import { register } from "node:module";

// Fakes first, then the usual @/ + extensionless TS resolution.
register("../../serverOnlyResolve.mjs", import.meta.url);
register("./hook.mjs", import.meta.url);
