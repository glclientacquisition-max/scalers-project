import Link from "next/link";
import { ContactImportForm } from "@/components/ContactImportForm";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export default async function ContactImportPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-[#005CCC]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Not signed in.
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/contacts"
        className="text-sm font-medium text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
      >
        Contacts
      </Link>
      <h1 className="mt-4 font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
        Import
      </h1>
      <p className="mt-2 text-sm text-ink-soft">CSV. Max 500 rows.</p>
      <div className="mt-8">
        <ContactImportForm />
      </div>
    </div>
  );
}
