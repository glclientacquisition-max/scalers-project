import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PayPanel } from "../../[token]/PayPanel";
import { loadPayReturn } from "@/lib/invoicePay/loadPay";

export const instant = false;

export const metadata: Metadata = {
  title: "Pay invoice",
  robots: { index: false, follow: false },
};

export default async function PayReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ return?: string; checkout_id?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const token = (await cookies()).get("scalers_pay")?.value || "";
  const view = await loadPayReturn(id, search, token);
  return <PayPanel token={view.payLabel ? token : ""} initial={view} />;
}
