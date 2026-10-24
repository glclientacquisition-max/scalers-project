import { notFound } from "next/navigation";

export const instant = false;
import { AreaPicker, type AreaView } from "@/components/areas/AreaPicker";
import { emptyAreaPicks, setAreaDetail, toggleArea } from "@/lib/areaPicks";
import { devSaveAreaPicksAction } from "./actions";

/** Service areas harness (no desk login). DASHBOARD_OPEN=true only. Fixture list mirrors the mockups, not a real business. */
const OLD = ["county:nairobi", "place:kiambu", "place:kitengela", "place:juja", "place:ongata rongai", "place:syokimau"];

function fixture() {
  let p = emptyAreaPicks();
  p = toggleArea(p, "county:nairobi");
  p = toggleArea(p, "estate:nairobi:kibera");
  p = toggleArea(p, "county:kiambu");
  p = setAreaDetail(p, "town:kajiado:kitengela", { serve: true, fee_kes: 500, note: "Weekends only" });
  p = toggleArea(p, "town:machakos:syokimau");
  return p;
}

export default async function DevAreasPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const v = (await searchParams).view;
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const view: AreaView = v === "check" || v === "hear" ? v : "home";
  return (
    <div className="desk-theme min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl">
        <AreaPicker initialPicks={fixture()} oldList={OLD} confirmed={false} initialView={view} saveAction={devSaveAreaPicksAction} />
      </div>
    </div>
  );
}
