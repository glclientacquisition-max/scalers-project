import { redirect } from "next/navigation";

// instant = false: request-time desk data under the owner auth shell.
export const instant = false;

export default function RequestsRedirectPage() {
  redirect("/calls?purpose=hold");
}
