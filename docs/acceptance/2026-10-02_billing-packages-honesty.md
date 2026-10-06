# Acceptance — billing packages + on-demand honesty (Slice C)

**As-of:** 2026-10-02  
**Lane:** Ops & Billing  
**Staging:** verify copy only (no balance API changes)

## Check

1. Super Admin nav lists **Packages**. There is no Ledger tab.
2. Plan (beta or on-demand) and charges sit on the Businesses shop. `/admin/wallets` redirects to Businesses.
3. Packages is the catalog. The KES ledger is ops scaffolding, not a checkout path.
4. Overview CTA: "Packages and on-demand" and "Wallet ledger" (not "Manage wallets").
5. Docs: `ONE_WALLET_BILLING.md`, `SUPER_ADMIN_REQUIREMENTS.md`, `docs/agents/OPS_BILLING.md` lead with packages + on-demand; wallet as ledger scaffolding.

**Staging PASS ≠ prod GO.**
