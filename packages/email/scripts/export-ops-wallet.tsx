/**
 * Write dashboard/src/lib/opsWalletTemplates.ts from the ops_wallet template.
 *   npm run export:ops-wallet
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatedModule, renderWalletTemplates } from "../src/opsWalletExport.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GENERATED_PATH = path.resolve(here, "../../../dashboard/src/lib/opsWalletTemplates.ts");

const templates = await renderWalletTemplates();
await writeFile(GENERATED_PATH, generatedModule(templates));
console.log(`Wrote ${Object.keys(templates).length} wallet alert templates to ${GENERATED_PATH}`);
