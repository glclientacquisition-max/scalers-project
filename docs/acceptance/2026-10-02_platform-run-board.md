# Platform run board — staging acceptance

**Slice:** Desk A (Platform board on `/admin`)  
**Date:** 2026-10-02  
**Staging PASS ≠ production GO**

## Preconditions

- Desk staging: `https://scalers-staging.vercel.app/admin` (Super Admin session).
- Voice staging health: `https://scalers-staging-staging.up.railway.app/healthz` (or current `VOICE_PUBLIC_BASE_URL` on staging Desk).

## Pass criteria

1. **Platform section** on `/admin` shows three rows: Phone line, Speech, Reasoning. Each row has Health and Money columns.
2. **No vendor brands** in the Platform board UI (no SautiKit / Soniox / Gemini labels in that section).
3. **Phone line money** shows the platform line wallet when `wallet.read` works, or **Unknown** when it does not. Line rental hint may appear when numbers load.
4. **Speech and reasoning money** stay **Unknown** (no invented balances).
5. **Speech degraded:** When Voice `GET /healthz` has `soniox.lastError.billingExhausted: true` (or equivalent STT/TTS billing error), the Speech row Health is **Degraded** with a last-error detail (not OK).
6. **Reasoning degraded:** When `gemini.lastError.billingExhausted` or `denied` is true, the Reasoning row Health is **Degraded**.

## Staging check (billing exhausted)

```bash
curl -sS "$VOICE_BASE/healthz" | jq '.soniox.lastError.billingExhausted, .gemini.lastError.billingExhausted'
```

Open `/admin` → Platform → confirm Speech and/or Reasoning stamps match the healthz flags.

If staging Voice is healthy, use a recorded healthz fixture in `tests/platformRunBoard.test.js` as regression proof; live staging proof still requires a billing-exhausted window or a Voice staging repro.

## Out of scope for this accept

- Ops SMS/email alerts (Voice slice B).
- Packages + on-demand copy sweep (Ops & Billing slice C).
- Public status page.
