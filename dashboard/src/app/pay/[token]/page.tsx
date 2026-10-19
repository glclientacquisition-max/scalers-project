import type { Metadata } from "next";
import { connection } from "next/server";
import { PayPanel } from "./PayPanel";
import { loadPayView } from "@/lib/invoicePay/loadPay";

export const instant = false;

/** Do not keep a prerender in the client router. The Bachs gate is request-time. */
export const unstable_dynamicStaleTime = 0;

export const metadata: Metadata = {
  title: "Pay invoice",
  robots: { index: false, follow: false },
};

export default async function PayInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ return?: string; checkout_id?: string }>;
}) {
  await connection();
  const { token } = await params;
  const search = await searchParams;
  const view = await loadPayView(token, search);
  return <PayPanel token={token} initial={view} />;
}
