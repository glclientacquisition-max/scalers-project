import Link from "next/link";
import { ContactImportForm } from "@/components/ContactImportForm";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export default async function ContactImportPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/contacts"
        className="text-sm font-medium text-accent-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
