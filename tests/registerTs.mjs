import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tsResolveHook.mjs", pathToFileURL("./tests/"));
