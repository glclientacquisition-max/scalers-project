"use client";

import { createContext, useContext, useEffect, useRef, type ComponentType, type ReactNode } from "react";
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

/** Controls that only change what's shown (expand/collapse), never data. Viewers keep these. */
export const ROLE_EXEMPT_SELECTOR = "[data-role-exempt], [aria-expanded], [aria-controls]";
const TEXTISH = /^(text|search|email|tel|url|number|password|date|time|datetime-local|month|week)$/;

/** Locks every data-editing control under `root`; disclosure toggles stay usable. Returns how many were locked. */
export function lockControls(root: ParentNode, why: string): number {
  let n = 0;
  root.querySelectorAll<HTMLElement>("input, textarea, select, button, [contenteditable='true']").forEach((el) => {
    if (el.closest("[data-role-exempt]") || el.matches(ROLE_EXEMPT_SELECTOR)) return;
    if (el.dataset.roleLocked === "1") return;
    el.dataset.roleLocked = "1";
    el.setAttribute("title", why);
    el.setAttribute("aria-disabled", "true");
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "textarea" || (tag === "input" && TEXTISH.test(type))) {
      el.setAttribute("readonly", ""); // still scrollable/selectable for reading
    } else if (tag === "input" || tag === "button" || tag === "select") {
      el.setAttribute("disabled", "");
    } else {
      el.setAttribute("contenteditable", "false");
    }
    n += 1;
  });
  return n;
}

function LockedRegion({ why, action, children }: { why: string; action: Action; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    lockControls(root, why);
    const mo = new MutationObserver(() => lockControls(root, why));
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "readonly"] });
    return () => mo.disconnect();
  }, [why]);
  return (
    <div
      ref={ref}
      className="contents"
      data-role-gated={action}
      title={why}
      onSubmitCapture={(e) => e.preventDefault()}
      onChangeCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.dataset?.roleLocked === "1") e.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

/**
 * Locks data-editing controls inside when the role lacks `action` (inputs read-only, buttons
 * disabled, tooltip explains why). Expand/collapse toggles keep working so viewers can read.
 * mode="hide" renders nothing instead.
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
  return (
    <LockedRegion why={deniedMessage(role, action)} action={action}>
      {children}
    </LockedRegion>
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
      className="border-b border-hairline bg-surface-2 px-4 py-2 text-center text-meta text-ink-2"
    >
      View only. You can look around, but you can&apos;t make changes.
    </div>
  );
}
