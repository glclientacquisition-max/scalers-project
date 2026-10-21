import { DeskPageGate } from "@/components/DeskPageGate";
import { SettingsBody, type SettingsSearchParams } from "./SettingsBody";

/** Voice lookup on assistant-say uses runtime clock; opt out of static prerender. */
export const instant = false;

/** Allow URL fetch + Gemini extract/compile without premature platform cutoffs. */
export const maxDuration = 60;

/**
 * Settings home. Sections live at `/settings/[section]`.
 * Old `?tab=` / `?panel=` links get a 308 in `proxy.ts` before this page runs.
 */
export default function SettingsPage({ searchParams }: { searchParams?: SettingsSearchParams }) {
  return (
    <DeskPageGate>
      <SettingsBody tab="menu" trainPanel="identity" searchParams={searchParams} />
    </DeskPageGate>
  );
}
