import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { opsKitEnabled } from "@/lib/ops/format";
import { KitClient } from "./KitClient";
import "@/styles/ops.css";

export const metadata = { title: "Ops kit" };

/** Staging-only gallery of every Ops primitive and state. 404 unless ADMIN_ENV=staging. */
export default async function OpsKitPage() {
  await requireSuperAdmin();
  if (!opsKitEnabled(process.env.ADMIN_ENV)) notFound();
  return <KitClient />;
}
