import type { ReactNode } from "react";
import { AdminUnlockProvider, STEP_UP_EVENT } from "./AdminUnlockProvider";

export { STEP_UP_EVENT };

/** @deprecated Use AdminUnlockProvider in the admin layout. Dev pages may still mount this wrapper. */
export function StepUpHost({ children }: { children?: ReactNode }) {
  return <AdminUnlockProvider>{children}</AdminUnlockProvider>;
}
