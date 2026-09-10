# Issue tracker: GitHub (read) + specs on disk (write)

Humans track work as GitHub issues and pull requests on `glclientacquisition-max/scalers-project`.

Cloud Agents in this repo have a **read-only** `gh` CLI. They must not create, comment on, label, or close GitHub issues. They ship through a PR.

## Conventions

- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open`
- **Publish a spec or wayfinder map**: write markdown under `docs/specs/` and link it from the PR body
- **Fetch the relevant ticket**: `gh issue view` when a number exists; otherwise the spec path in `docs/specs/`

## Pull requests as a request surface

**PRs as a request surface: yes** for Cloud Agents (that is how they deliver work). Human feature requests still start as GitHub issues when the owner files them.

## When a skill says "publish to the issue tracker"

Write `docs/specs/<kebab-name>.md` (or a wayfinder map under `docs/specs/wayfinder/`). Mention the path in the PR. Do not run `gh issue create`.

## When a skill says "fetch the relevant ticket"

1. Issue number in commits or the PR → `gh issue view <number> --comments`
2. Else the spec file named in the branch or PR (`docs/specs/…`)

## Wayfinding operations

Used by `/wayfinder`. Maps are markdown, not GitHub issues, until a human copies them into Issues.

- **Map**: `docs/specs/wayfinder/<effort>.md` with Destination, Notes, Decisions so far, Not yet specified, Out of scope
- **Child ticket**: a heading or linked file under that map. Label type in the heading: research / prototype / grilling / task
- **Blocking**: a `Blocked by:` line naming the parent heading
- **Frontier**: first open, unblocked heading
- **Claim**: note `Claimed by: <agent or human>` on the heading
- **Resolve**: fill the answer under the heading and move a one-line gist into Decisions so far
