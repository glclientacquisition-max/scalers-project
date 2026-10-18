import { notFound, redirect } from "next/navigation";
import { resolveShortCallLink } from "@/lib/shortCallLinkServer";
import { shortLinkPath } from "@/lib/shortCallLink";

// Session cookies decide where this goes. Never prerender.
export const instant = false;

/** app.scalers.co.ke/c/<code> from a staff SMS: sign in, check membership, open the call. */
export default async function ShortCallLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const next = await resolveShortCallLink(code);
  if (next.kind === "login") redirect(next.href);
  if (next.kind === "not_found") notFound();
  // Call in another of their businesses: the route switches the workspace first.
  redirect(next.switchTenant ? `${shortLinkPath(code.toUpperCase())}/open` : next.href);
}
