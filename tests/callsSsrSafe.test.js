// /calls threw "document is not defined" in production: InboxRowAvatar called
// createPortal(..., document.body) during render, which also runs on the server.
// Guard: nothing reachable from the /calls page may touch document/window at render time
// through a portal, and the avatar leaves portalling to the Sheet.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "dashboard", "src");

function resolve(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts", ""]) {
    const f = base + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

function graph(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"/g)) {
      const r = resolve(m[1] || m[2], f);
      if (r) stack.push(r);
    }
  }
  return [...seen];
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("/calls renders on the server", () => {
  const files = graph(path.join(SRC, "app", "(desk)", "calls", "page.tsx"));

  it("walks the real /calls import graph", () => {
    assert.ok(files.some((f) => f.endsWith("InboxRowAvatar.tsx")), "avatar is on /calls");
  });

  it("every createPortal to document is behind a typeof document guard", () => {
    for (const f of files) {
      const src = stripComments(fs.readFileSync(f, "utf8"));
      let at = src.indexOf("createPortal(");
      while (at !== -1) {
        const before = src.slice(Math.max(0, at - 400), at);
        const call = src.slice(at, at + 1500);
        if (/document\./.test(call.slice(0, call.indexOf(");") + 1 || undefined))) {
          assert.match(
            before,
            /typeof document (===|!==) "undefined"|mounted|slot/,
            `${path.relative(SRC, f)}: createPortal into document without an SSR guard`
          );
        }
        at = src.indexOf("createPortal(", at + 1);
      }
    }
  });

  it("the inbox avatar leaves portalling to the Sheet", () => {
    const avatar = stripComments(fs.readFileSync(path.join(SRC, "components", "InboxRowAvatar.tsx"), "utf8"));
    assert.doesNotMatch(avatar, /document\.body/);
    assert.doesNotMatch(avatar, /createPortal\(/);
  });
});
