import { notFound } from "next/navigation";
import { WorkspaceClosed } from "@/components/WorkspaceClosed";

/** Closed screen an owner sees after a Super Admin archives the business. DASHBOARD_OPEN=true only. */
export default function DevWorkspaceClosedPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return <WorkspaceClosed businessName="Test Archive Co" />;
}
