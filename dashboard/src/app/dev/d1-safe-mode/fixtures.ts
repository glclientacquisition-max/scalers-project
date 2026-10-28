import type { TakeMessagesState } from "@/lib/takeMessages";

/** ?state= for the D1 fixtures: off | on (owner) | support (admin) | env. */
export function fixtureTakeMessages(raw: string | undefined): TakeMessagesState {
  const setAt = "2026-10-28T11:05:00.000Z";
  if (raw === "on" || raw === "owner") return { on: true, by: "owner", setAt };
  if (raw === "support" || raw === "admin") return { on: true, by: "admin", setAt };
  if (raw === "env") return { on: true, by: "env", setAt: null };
  return { on: false, by: null, setAt: null };
}
