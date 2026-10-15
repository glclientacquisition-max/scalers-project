/**
 * Smart import classification eval against the real model (run on staging or with a key).
 *   GEMINI_API_KEY=... npm run eval:smart-import
 * Same fixtures as tests/smartImport.test.ts. Prints per-destination accuracy and misses.
 * Without a key it exits 0 and says it skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { generateGeminiJson } from "../dashboard/src/lib/gemini.ts";
import { parseSmartImportJson, SMART_IMPORT_RESPONSE_SCHEMA, SMART_IMPORT_SYSTEM } from "../dashboard/src/lib/smartImport/schema.ts";
import { scoreDocs, type EvalDoc } from "../dashboard/src/lib/smartImport/evalScore.ts";

const root = path.resolve(import.meta.dirname, "..");
const { docs } = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/smartImport/eval.json"), "utf8")) as { docs: EvalDoc[] };

if (!process.env.GEMINI_API_KEY) {
  console.log("eval:smart-import skipped: GEMINI_API_KEY is not set. Run it on staging.");
  process.exit(0);
}

const results = [];
for (const doc of docs) {
  const t0 = Date.now();
  try {
    const raw = await generateGeminiJson({
      systemInstruction: SMART_IMPORT_SYSTEM,
      parts: [{ text: `Business: unknown\n\nSOURCE:\n${doc.source}` }],
      responseSchema: SMART_IMPORT_RESPONSE_SCHEMA,
    });
    const items = parseSmartImportJson(raw);
    console.log(`${doc.id}: ${items.length} items in ${Date.now() - t0} ms`);
    results.push({ doc, items });
  } catch (err) {
    console.log(`${doc.id}: model error ${err instanceof Error ? err.message : err}`);
    results.push({ doc, items: [] });
  }
}
const score = scoreDocs(results);
console.log(`\nOverall routing accuracy: ${score.correct}/${score.total} (${Math.round((100 * score.correct) / score.total)}%)`);
for (const [t, v] of Object.entries(score.perTarget)) console.log(`  ${t.padEnd(10)} ${v.correct}/${v.total}`);
for (const m of score.misses) console.log(`  miss ${m.doc}: "${m.fact}" expected ${m.expected}, got ${m.got}`);
const min = Number(process.env.SMART_IMPORT_MIN_ACCURACY || 0);
if (min && score.correct / score.total < min) process.exit(1);
