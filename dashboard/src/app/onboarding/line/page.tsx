import { redirect } from "next/navigation";
import { loadSetupContext } from "@/lib/setupServer";
import { loadCallSetupState } from "@/lib/callSetupServer";
import { LineView } from "./LineView";

export const instant = false;

/** Last screen of setup: the phone number callers dial, or a clear "assigning" state. */
export default async function SetupLinePage() {
  const ctx = await loadSetupContext();
  if (ctx.kind === "signed_out") redirect("/login");
  if (ctx.kind !== "ready") redirect("/onboarding");
  if (!ctx.row.setup_completed_at) redirect("/onboarding");

  const callSetup = await loadCallSetupState(ctx.row.id);
  return (
    <LineView
      businessName={ctx.row.business_name}
      tenantId={ctx.row.id}
      raw={ctx.row.sautikit_virtual_number}
      server={{ supported: callSetup.supported, setup: callSetup.setup }}
    />
  );
}
