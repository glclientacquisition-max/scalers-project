import { redirect } from "next/navigation";

/** Legacy path — Super Admin numbers live under /admin/numbers. */
export default function NumbersRedirectPage() {
  redirect("/admin/numbers");
}
