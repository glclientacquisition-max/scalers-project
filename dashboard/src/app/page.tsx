import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

export default async function Home() {
  // Owners land on their desk; platform operators on the admin console.
  if (await getAuthUser()) redirect("/calls");
  if (await isLegacyAuthenticated()) redirect("/admin");
  redirect("/login");
}
