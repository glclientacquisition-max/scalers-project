"use client";

import { PayCard, type PayCardModel } from "@/components/pay/PayCard";

const PAYABLE: PayCardModel = {
  state: "payable",
  title: "Jirani Cleaning",
  businessName: "Jirani Cleaning",
  invoiceNumber: "SCL-2026-000042",
  totalLabel: "KSh 200,000",
  dueLabel: "Due 24 Oct 2026",
  partLabel: "Part 1 of 2",
  payLabel: "Pay KSh 100,000",
  checkoutId: null,
  notice: null,
};

const CHECKING: PayCardModel = {
  ...PAYABLE,
  state: "checking",
  title: "Checking payment",
  payLabel: null,
  checkoutId: "chk_sample",
};

const RECEIVED: PayCardModel = {
  ...PAYABLE,
  state: "received",
  title: "Payment received",
  partLabel: null,
  payLabel: null,
};

const PAID: PayCardModel = { ...PAYABLE, state: "paid", title: "Paid", partLabel: null, payLabel: null };

/** Sample states only. The button does not start a payment. */
export function DevPayFixtures() {
  return (
    <div className="bg-canvas">
      <PayCard view={PAYABLE} onPay={() => undefined} />
      <PayCard view={CHECKING} />
      <PayCard view={RECEIVED} />
      <PayCard view={PAID} />
    </div>
  );
}
