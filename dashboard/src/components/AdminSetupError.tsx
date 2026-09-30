import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { ADMIN_SETUP_INCOMPLETE } from "@/lib/adminErrors";

export function AdminSetupError() {
  return <DeskLoadError>{ADMIN_SETUP_INCOMPLETE}</DeskLoadError>;
}
