# Docs

Index for the repo. Product behavior is in `product/`. Runbooks are in `operations/`. SQL stays in `supabase/`.

## Read first

| Doc | Use it for |
| --- | --- |
| [`../README.md`](../README.md) | What is live, how to run voice and Desk, short repo map |
| [`product/CLIENT_BUSINESS_DETAILS.md`](product/CLIENT_BUSINESS_DETAILS.md) | What we collect from a client, Settings IA, methods, onboarding |
| [`../AGENTS.md`](../AGENTS.md) | Lane ownership |
| [`architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md) | How voice, Desk, and Supabase fit together |
| [`architecture/CURRENT_STATE.md`](architecture/CURRENT_STATE.md) | File-level facts. Read the system picture first. |
| [`governance/SOURCE_OF_TRUTH.md`](governance/SOURCE_OF_TRUTH.md) | Which file is canonical |

## Folders

| Folder | Contents |
| --- | --- |
| `product/` | Client business details and onboarding map, call messages, escalation (shipped), live transfer (spec), WhatsApp templates, home-services bar, MVP gate, business-intelligence roadmap |
| `operations/` | Deploy, environments, local tunnel, packages, wallet, DID pool, Super Admin requirements, production cutover |
| `architecture/` | Entry picture (`SYSTEM_ARCHITECTURE.md`), fact inventory, data flow, historical blueprint, target module layout |
| `agents/` | Lane contracts (Voice, Brain, Desk, Ops & Billing, Platform) |
| `governance/` | Workflow, principles, inventory |
| `supabase/` | Manual SQL. Apply order is [`supabase/README.md`](supabase/README.md) |
| `database/` | How schema changes are governed |
| `platform/` | Cross-channel system map |
| `frontend/` | Desk charter and design system. Charter wins: [`frontend/FRONTEND_2_0_CHARTER.md`](frontend/FRONTEND_2_0_CHARTER.md) |
| `adr/` | Architecture decisions |
| `specs/` | In-flight feature specs |
| `acceptance/` | Staging checklists |
| `security/`, `storage/`, `company/`, `engineering/` | Reviews and company notes |

## Left in place

`server.js`, `src/`, `db.js`, and `dashboard/` stay at these paths. Railway starts `node server.js`. Vercel uses root directory `dashboard`. Lane contracts name these paths.

Next code move, in its own pull request: extract telephony from `server.js` toward [`architecture/TARGET_MODULE_LAYOUT.md`](architecture/TARGET_MODULE_LAYOUT.md). That extract should not change call behavior.

`scripts/` stays flat because `package.json` and CI call those files by path. Grouping is in [`../scripts/README.md`](../scripts/README.md).
