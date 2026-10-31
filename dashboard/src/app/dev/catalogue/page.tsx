import { notFound } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { DeskRoleProvider, ViewOnlyBanner } from "@/components/DeskRole";
import { SettingsRail } from "@/components/SettingsSideNav";
import { settingsConsoleClass } from "@/components/settingsUi";
import { DevCatalogue } from "./DevCatalogue";
import { homeCategories, homeItems, homeLive, readinessTodo, shopCategories, shopItems } from "./fixtures";

/**
 * Settings > Catalogue (KB v2) with fixture data. DASHBOARD_OPEN=true only.
 * ?vertical=retail, ?cat=empty, ?role=viewer, ?filter=unpriced, ?paste=1, ?many=1 (Add many, with Photo and Website), ?states=on (Paused / Not offered control)
 */
export const instant = false;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DevCataloguePage({ searchParams }: Props) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const p = (await searchParams) || {};
  const retail = one(p.vertical) === "retail";
  const empty = one(p.cat) === "empty";
  const viewer = one(p.role) === "viewer";
  const items = empty ? [] : retail ? shopItems : homeItems;
  return (
    <DeskRoleProvider role={viewer ? "viewer" : null}>
      <div className={deskShellClass}>
        <DeskRail needsCount={0} homeHref="/dev/home" />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
          <ViewOnlyBanner />
          <main data-desk-main="" className={deskMainClass}>
            <div className="w-full min-w-0" data-settings-console="" data-desk-nested="">
              <div className={settingsConsoleClass}>
                <SettingsRail activePath="/settings/knowledge" assistantSayPage />
                <div className="min-w-0 flex-1 md:max-w-2xl xl:max-w-desk" data-kb-screen="">
                  <DevCatalogue
                    items={items}
                    categories={retail ? shopCategories : homeCategories}
                    live={empty ? null : retail ? null : homeLive}
                    latest={empty ? null : homeLive}
                    readiness={empty ? null : readinessTodo}
                    liveVersion={empty ? null : 2}
                    onCalls={false}
                    vertical={retail ? "retail" : "home_services"}
                    canEdit={!viewer}
                    statesEnabled={one(p.states) === "on"}
                    initialNeedPrice={one(p.filter) === "unpriced"}
                    initialPaste={one(p.paste) === "1" || one(p.many) === "1"}
                    initialUndoOutcome={one(p.undo) === "done" ? { ok: true, text: "Undone. Your list and details are back to how they were." } : one(p.undo) === "refused" ? { ok: false, text: "Some details from this import were changed after it, so undo is off. Edit them instead." } : undefined}
                    initialUndo={one(p.undo) ? { id: "00000000-0000-4000-8000-000000000001", at: Date.now(), summary: "Nice, your list is updated. Added 12, updated 3." } : undefined}
                    importPhoto={one(p.many) === "1"}
                  />
                </div>
              </div>
            </div>
          </main>
          <DeskTabBar needsCount={0} />
        </div>
      </div>
    </DeskRoleProvider>
  );
}
