import { DeskRecovery } from "@/components/ui/DeskRecovery";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

/** One recovery link from the session. Logged-out typos stay here, not on the desk gate. */
export default async function NotFound() {
  const owner = await getAuthUser();
  let href = "/";
  let action = "Home";
  if (owner) {
    href = "/home";
    action = "Overview";
  } else if (await isLegacyAuthenticated()) {
    href = "/admin";
    action = "Admin";
  }

  return (
    <DeskRecovery
      screen
      title="Page not found"
      line="That address is not a Scalers page."
      href={href}
      action={action}
    />
  );
}
