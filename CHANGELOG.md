# Changelog

All notable changes to the Scalers platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Note:** No historical releases are documented below. Prior work exists in Git history (286+ commits) but was not tagged with semver releases. See [`docs/governance/PROJECT_HISTORY.md`](docs/governance/PROJECT_HISTORY.md).

---

## [Unreleased]

### Added

- Governance and architecture documentation baseline (`docs/architecture/`, `docs/governance/`, `docs/database/`, `docs/operations/`, `docs/adr/`)
- Agent architecture and prompt versioning documentation (`docs/agents/AGENT_ARCHITECTURE.md`, `PROMPT_VERSIONING.md`)
- Extended `AGENTS.md` with master safety principles for AI agents
- Forward-looking release and development workflow docs

### Changed

- `docs/architecture/ARCHITECTURE_MIGRATION_BLUEPRINT.md` — clarified historical Twilio/SQLite baseline vs current SautiKit stack
- `docs/architecture/TARGET_MODULE_LAYOUT.md` — clarified planned vs implemented module layout
- `README.md` — rewritten in plain English for the live product (voice Business Assistant, Desk, what is not shipped)
- Loose notes moved off `docs/` root into `docs/product/`, `docs/operations/`, and `docs/architecture/`. Acceptance notes moved from `scalers/acceptance/` to `docs/acceptance/`. `server.js`, `src/`, and `dashboard/` stayed put.
- `docs/architecture/SYSTEM_ARCHITECTURE.md` is the plain-English picture of voice, Desk, and Supabase. `CURRENT_STATE.md` and `DATA_FLOW.md` stay fact inventories. The migration blueprint and target module layout are marked historical or target. Live Dial and owner M-Pesa checkout stay unshipped.

---

<!-- Future releases: move [Unreleased] items to [X.Y.Z] - YYYY-MM-DD -->
