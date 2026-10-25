import type { PaymentRow } from "@/lib/ops/paymentsView";

export const ADMIN_PAYMENTS_NOW = "2026-10-23T12:00:00Z";

export const ADMIN_PAYMENTS: PaymentRow[] = [
  {
    id: "pay-issue",
    businessId: "biz-1",
    businessName: "QA Onboarding Two",
    invoiceId: "inv-1",
    invoiceNumber: "SCL-2026-000010",
    amountCents: 1200000,
    matchStatus: "issue",
    providerRef: "chk_issue_1",
    paidAt: "2026-10-20T08:00:00Z",
    createdAt: "2026-10-20T08:00:00Z",
  },
  {
    id: "pay-unmatched",
    businessId: "biz-2",
    businessName: "Kileleshwa Dental",
    invoiceId: null,
    invoiceNumber: null,
    amountCents: 50000,
    matchStatus: "unmatched",
    providerRef: "mpesa_orphan_9",
    paidAt: "2026-10-21T10:15:00Z",
    createdAt: "2026-10-21T10:15:00Z",
  },
  {
    id: "pay-partial",
    businessId: "biz-1",
    businessName: "QA Onboarding Two",
    invoiceId: "inv-2",
    invoiceNumber: "SCL-2026-000011",
    amountCents: 300000,
    matchStatus: "partial",
    providerRef: "chk_partial_2",
    paidAt: "2026-10-18T14:00:00Z",
    createdAt: "2026-10-18T14:00:00Z",
  },
  {
    id: "pay-matched",
    businessId: "biz-3",
    businessName: "Westlands Auto",
    invoiceId: "inv-3",
    invoiceNumber: "SCL-2026-000004",
    amountCents: 500000,
    matchStatus: "matched",
    providerRef: "chk_ok_3",
    paidAt: "2026-10-01T08:00:00Z",
    createdAt: "2026-10-01T08:00:00Z",
  },
];
