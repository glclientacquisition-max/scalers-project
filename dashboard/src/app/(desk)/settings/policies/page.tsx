import { redirect } from "next/navigation";
import { PAYMENT_TOPIC, TOPICS } from "@/lib/policyRegistry";

function policiesRedirectHash(topic: string | undefined): string {
  const id = String(topic ?? "").trim();
  if (!id) return "";
  if (id === PAYMENT_TOPIC) return "#payments";
  if (id in TOPICS) return `#rule-${id}`;
  return "";
}

/** Legacy `/settings/policies` bookmarks open Train › Policies. */
export default async function PoliciesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const hash = policiesRedirectHash(topic);
  redirect(`/settings?tab=train&panel=policies${hash}`);
}
