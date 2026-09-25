# Chisle audit

Read-only. Ranked report. Biggest cut first. Changes nothing.

## Scope

- No path: current `git diff` (staged + unstaged). Empty: `HEAD~1..HEAD`.
- A path: that file or directory.
- `repo`: walk the tree. Skip `node_modules`, `dist`, lockfiles, vendored, generated.

## Flag

**Code:** reinvented stdlib, one-implementation abstractions, new dep for a few lines, config that never varies, speculative scaffolding, JS where CSS or a DB constraint already does it.

**Prose:** comments that restate the code, padded READMEs, decorative emoji headings, dead TODOs.

## Do not flag

Trust-boundary validation, data-loss error handling, security, accessibility, constitution-required chrome, `// chisle:` shortcuts already documented, comments that explain why.

## Output

```
path:line  [code|prose]  <bloat> -> <lean replacement>. (~N lines)
```

End with:

```
N findings: X code, Y prose. Est. removable: ~A lines code, ~B lines prose.
Biggest win: <one cut>.
```

Mark `(check)` when cutting might lose behavior you cannot verify from the snippet. Prefer fewer high-confidence findings.
