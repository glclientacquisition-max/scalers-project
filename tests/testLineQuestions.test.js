const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/testLineQuestions.ts");
  const script = `
    import { testLineQuestions } from ${JSON.stringify(file)};
    const value = ${expr};
    process.stdout.write(JSON.stringify(value));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
}

describe("testLineQuestions", () => {
  it("takes FAQ questions first, then catalogue names, and stops at three", () => {
    const questions = load(`testLineQuestions({
      faqs: [
        { question: "Do you print on Sundays?", answer: "Yes." },
        { question: "  ", answer: "no" },
        { question: "Can I pay by M-Pesa?", answer: "Yes." },
      ],
      services: [{ name: "A4 print" }, { name: "Binding" }],
      products: [{ name: "A4 print" }],
    })`);
    assert.deepEqual(questions, [
      "Do you print on Sundays?",
      "Can I pay by M-Pesa?",
      "How much is A4 print?",
    ]);
  });

  it("is empty when nothing is filled in", () => {
    assert.deepEqual(load(`testLineQuestions({ faqs: [], services: [], products: [] })`), []);
    assert.deepEqual(load(`testLineQuestions({})`), []);
  });
});
