import { ADMIN_SETUP_INCOMPLETE } from "@/lib/adminErrors";

export function AdminSetupError() {
  return (
    <div className="rounded-2xl border border-warn/40 bg-warn-soft p-6 text-warn" role="alert">
      {ADMIN_SETUP_INCOMPLETE}
    </div>
  );
}
