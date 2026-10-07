import { ContactImportForm } from "@/components/ContactImportForm";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskPageGate } from "@/components/DeskPageGate";

export default function ContactImportPage() {
  return (
    <DeskPageGate>
      <ContactImportBody />
    </DeskPageGate>
  );
}

async function ContactImportBody() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  return (
    <div className="max-w-3xl" data-desk-nested="">
      <PageHeader
        title="Import contacts"
        meta="CSV. Max 500 rows."
        back={{ href: "/contacts", label: "Contacts" }}
      />
      <div className="mt-8">
        <ContactImportForm />
      </div>
    </div>
  );
}
