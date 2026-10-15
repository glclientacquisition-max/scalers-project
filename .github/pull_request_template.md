## Summary

<!-- What changed? One short paragraph. -->

## Why

<!-- Problem, ticket, or user impact. -->

## Affected subsystem

<!-- Voice | Brain | Desk UI/UX | Ops & Billing | Platform | Docs | CI -->

## Testing

<!-- Commands run and results. Example: npm run test:voice, test:mvp, dashboard build -->

## Database changes?

YES / NO

<!-- If YES: list docs/supabase/*.sql files and apply-order note -->

## AI/agent behavior changed?

YES / NO

## Prompt changed?

YES / NO

## Voice behavior changed?

YES / NO

## Customer-facing behavior changed?

YES / NO

## Production risk

<!-- Low | Medium | High — and why -->

## Rollback plan

<!-- git revert, redeploy previous image, forward-fix SQL, etc. -->

## Documentation updated?

<!-- YES / NO — link docs if yes -->

## STATUS updated?

YES / NO (no live change)

<!-- Every merge to main updates docs/STATUS.md in the same PR (CONTRIBUTING.md#status-rule). -->

## Checklist

- [ ] Tests pass
- [ ] No secrets introduced
- [ ] No unrelated changes
- [ ] Documentation updated where appropriate
- [ ] `docs/STATUS.md` updated (section 2 on every merge to `main`)
- [ ] Touched docs have `owner` + `last_reviewed` frontmatter
- [ ] Database changes are traceable
- [ ] AI/voice changes identified
- [ ] Git diff reviewed
