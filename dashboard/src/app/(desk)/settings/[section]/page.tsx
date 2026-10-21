import { redirect } from "next/navigation";
import { DeskPageGate } from "@/components/DeskPageGate";
import { parseSettingsSection } from "@/lib/businessSettingsNav";
import { SettingsBody, type SettingsSearchParams } from "../SettingsBody";

/** Voice lookup on assistant-say uses runtime clock; opt out of static prerender. */
export const instant = false;

/** Allow URL fetch + Gemini extract/compile without premature platform cutoffs. */
export const maxDuration = 60;

type SectionPageProps = {
  params: Promise<{ section: string }>;
  searchParams?: SettingsSearchParams;
};

/** One Settings section, e.g. `/settings/hours`. Same view the old `?tab=` URL showed. */
export default function SettingsSectionPage(props: SectionPageProps) {
  return (
    <DeskPageGate>
      <SettingsSectionBody {...props} />
    </DeskPageGate>
  );
}

async function SettingsSectionBody({ params, searchParams }: SectionPageProps) {
  const { section } = await params;
  const view = parseSettingsSection(section);
  // Unknown section: the Settings home, as an unknown ?tab= always did.
  if (!view) redirect("/settings");
  return <SettingsBody tab={view.tab} trainPanel={view.trainPanel} searchParams={searchParams} />;
}
