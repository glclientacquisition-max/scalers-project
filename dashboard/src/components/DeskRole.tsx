"use client";

import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { can, deniedMessage, type Action, type Role } from "@/lib/permissions";

/** Current member role on the desk. null = unknown / legacy (treated as full access; server still guards). */
const RoleCtx = createContext<Role | null>(null);

export function DeskRoleProvider({ role, children }: { role: Role | null; children: ReactNode }) {
  return <RoleCtx.Provider value={role}>{children}</RoleCtx.Provider>;
}

export function useDeskRole(): Role | null {
  return useContext(RoleCtx);
}

export function useCan(action: Action): boolean {
  const role = useDeskRole();
  return role === null || can(role, action);
}

/**
 * Disables every control inside when the role lacks `action` (native fieldset disabled),
 * with a tooltip explaining why. mode="hide" renders nothing instead.
 */
export function RoleGate({
  action,
  mode = "disable",
  children,
}: {
  action: Action;
  mode?: "disable" | "hide";
  children: ReactNode;
}) {
  const role = useDeskRole();
  if (role === null || can(role, action)) return <>{children}</>;
  if (mode === "hide") return null;
  const why = deniedMessage(role, action);
  return (
    <fieldset disabled aria-disabled="true" title={why} data-role-gated={action} className="contents min-w-0 border-0 p-0 m-0">
      {children}
    </fieldset>
  );
}

export function withRoleGate<P extends object>(action: Action, Inner: ComponentType<P>, mode: "disable" | "hide" = "disable") {
  function Gated(props: P) {
    return (
      <RoleGate action={action} mode={mode}>
        <Inner {...props} />
      </RoleGate>
    );
  }
  Gated.displayName = `RoleGated(${Inner.displayName || Inner.name || "Component"})`;
  return Gated;
}

/** Banner for view-only members, shown once at the top of the desk. */
export function ViewOnlyBanner() {
  const role = useDeskRole();
  if (role !== "viewer") return null;
  return (
    <div
      role="note"
      data-view-only-banner=""
      className="border-b border-line bg-accent/10 px-4 py-2 text-center text-sm text-ink"
    >
      You have <strong className="font-medium">view-only access</strong>. You can look around, but changes are switched off.
    </div>
  );
}
