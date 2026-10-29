import { notFound, redirect } from "next/navigation";

/** Old registry screen harness; Policies remake lives at /dev/policies-remake. */
export default async function DevPoliciesPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  redirect("/dev/policies-remake");
}
