import { redirect } from "next/navigation";

export default function RequestsRedirectPage() {
  redirect("/calls?purpose=hold");
}
