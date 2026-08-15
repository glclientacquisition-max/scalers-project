# Migration ledger

**Status:** Authoritative index as of 2026-08-14  
**Production:** ALCR (`fjxcdccgyhnvnnlnovcl`)

Scalers uses a **dual migration model**:

1. **Foundation tables** — predate documented migration system; bootstrap via [`foundation_bootstrap.sql`](./foundation_bootstrap.sql) (production-introspected, historically unverified).
2. **Manual SQL scripts** — `docs/supabase/*.sql` applied via SQL Editor (primary governance model).
3. **Supabase CLI migrations** — partial adoption from 2026-08-07; recorded in `supabase_migrations.schema_migrations` on production (24 rows).

---

## Foundation tables

| Table | Columns | Bootstrap source | Historical CREATE provenance |
| --- | --- | --- | --- |
| `public.tenants` | 49 | `foundation_bootstrap.sql` | **UNKNOWN** |
| `public.calls` | 15 | `foundation_bootstrap.sql` | **UNKNOWN** |
| `public.transcripts` | 6 | `foundation_bootstrap.sql` | **UNKNOWN** |

**Do not use** commit `9153a09` CREATE TABLE as foundation source.

---

## Production CLI migration ledger (`supabase_migrations.schema_migrations`)

Recorded on ALCR as of 2026-08-14 (24 rows). None create foundation tables.

| Version | Name | Touches foundation |
| --- | --- | --- |
| 20260807225947 | daily_bulletin | tenants.daily_bulletin |
| 20260808005039 | escalation_enabled | tenants.escalation_enabled |
| 20260808053931 | alert_email | tenants.alert_email |
| 20260808080322 | one_wallet_billing | tenants wallet columns |
| 20260808103634 | wallet_security_beta_part1 | tenants beta + trigger |
| 20260808103644 | wallet_security_beta_part2_rpcs | RPCs (touch tenants) |
| 20260808103657 | wallet_security_beta_part3_grants | tenants/calls grants |
| 20260808112824 | agent_tools | tenants.agent_tools |
| 20260811044451 | business_operating_model | tenants vertical/handoff/locations/policies |
| 20260811044502 | contacts_and_requests | FK to calls, tenants |
| 20260811061942 | fix_charge_call_wallet_ambiguous | RPC |
| 20260811072236 | lead_status_archive | calls.lead_status CHECK |
| 20260811072353 | wallet_soft_spend_limit | tenants soft spend |
| 20260811073319 | wallet_on_demand_alerts | tenants on-demand columns |
| 20260811073341 | wallet_on_demand_alerts_fns | RPC + trigger patch |
| 20260811073356 | wallet_claim_alerts_and_ondemand_rpc | RPC |
| 20260811102735 | add_tenants_tts_lexicon | tenants.tts_lexicon |
| 20260811122648 | grant_owner_update_tts_lexicon | grant |
| 20260811142321 | product_catalog_and_social | tenants product/social |
| 20260812025507 | call_resolution | calls resolution columns |
| 20260812083631 | appointments | FK to calls, tenants |
| 20260812141513 | soniox_voice_catalog | tenants voice columns |
| 20260813073840 | pronunciation_gemini_scan | tenants pronunciation columns |
| 20260813210755 | notify_channels | tenants.notify_channels |

**Not in CLI ledger (applied manually):**

- `multi_tenant_onboarding.sql`, `owner_rls.sql`, tier 2–7 manual scripts predating CLI adoption
- `fix_p0_rls_remove_legacy_allow_all.sql` (P0, 2026-08-14)

---

## Manual script tiers (summary)

Full order: [`README.md`](./README.md).

| Tier | Scope | Foundation dependency |
| --- | --- | --- |
| 0 | `foundation_bootstrap.sql` | Creates tenants, calls, transcripts |
| 1 | Membership + RLS | Requires tenants |
| 2–4 | Tenant profile columns | `ALTER TABLE tenants ADD COLUMN` (no-op if bootstrapped) |
| 5 | Owner CRM | `ALTER TABLE calls ADD COLUMN` |
| 6–9 | DID, wallet, BI, appointments | FK references to tenants/calls |

---

## Column lineage — foundation-era columns

Columns present before CLI migration adoption. Earliest Git evidence is comment-only introspection (`34d0d54`, Aug 6 2026), not CREATE TABLE.

### tenants (foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` schema.sql comment | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| business_name | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sautikit_virtual_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| whatsapp_notification_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| llm_system_prompt | text | `34d0d54` | FOUNDATION_UNKNOWN |
| is_active | boolean | `34d0d54` | FOUNDATION_UNKNOWN |

### calls (foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| tenant_id | uuid FK CASCADE | `34d0d54` | FOUNDATION_UNKNOWN |
| caller_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sautikit_call_sid | text UNIQUE | `34d0d54` | FOUNDATION_UNKNOWN |
| status | text | `34d0d54` | FOUNDATION_UNKNOWN |
| duration_seconds | integer | `34d0d54` | FOUNDATION_UNKNOWN |
| recording_url | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sentiment | text | `34d0d54` | FOUNDATION_UNKNOWN |
| summary | text | `34d0d54` | FOUNDATION_UNKNOWN |

### transcripts (all foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` (utterance model) | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| call_id | uuid FK CASCADE | `34d0d54` | FOUNDATION_UNKNOWN |
| speaker | text | `34d0d54` | FOUNDATION_UNKNOWN |
| text_content | text | `34d0d54` | FOUNDATION_UNKNOWN |
| latency_ms | integer | `34d0d54` | FOUNDATION_UNKNOWN |

Additive columns (post-foundation) are documented per file in [`README.md`](./README.md) and mapped in Phase 3D-4 audit.

---

## Storage

| Bucket | Public | Created (production) | Git SQL |
| --- | --- | --- | --- |
| `call-recordings` | false | 2026-08-06 08:42 UTC | **UNKNOWN** (manual/Dashboard) |

Referenced in `foundation_bootstrap.provenance.md`, `schema.sql`, `DEPLOYMENT.md`.

---

## Security repairs

| File | Applied production | In CLI ledger |
| --- | --- | --- |
| `fix_p0_rls_remove_legacy_allow_all.sql` | YES (2026-08-14) | NO |

Post-P0 member-only RLS is encoded in `foundation_bootstrap.sql`.
