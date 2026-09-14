import type { ReactNode } from "react";
import { deskErrorClass } from "@/components/ui/deskChrome";

export function DeskError({ children }: { children: ReactNode }) {
  return (
    <div className={deskErrorClass} role="alert">
      {children}
    </div>
  );
}
