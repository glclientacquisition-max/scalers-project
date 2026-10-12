"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { SettingsGroup } from "@/components/settingsUi";
import { COVERAGE_AREA_MAX, coverageAreaLabel, searchCoverageAreas } from "@/lib/coverageAreas";
import {
  AREA_MODES,
  DELIVERED_BY,
  ETA_MAX,
  FEE_MODES,
  RIDER_PAID,
  areaSummary,
  newServiceArea,
  serviceAreasSentence,
  validateServiceArea,
  type AreaMode,
  type DeliveredBy,
  type FeeMode,
  type RiderPaid,
  type ServiceArea,
  type ServiceAreas,
} from "@/lib/serviceAreas";
import { AddRow, CallersHear, CheckList, OpenRow } from "./PickList";

function kshInput(v: string): number | null {
  const n = Number(v.replace(/[,\s]/g, ""));
  return v.trim() && Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Areas you serve. A grouped list of places; each opens a bottom drawer with how you
 * serve it, the fee, how long it takes and the minimum order. Who delivers sits below.
 * Controlled: the Settings form owns the value and saves it with the Locations page.
 */
export function ServiceAreasEditor({
  value,
  vertical,
  onChange,
  canEdit = true,
}: {
  value: ServiceAreas;
  vertical?: string | null;
  onChange: (next: ServiceAreas) => void;
  canEdit?: boolean;
}) {
  const [sheet, setSheet] = useState<null | "pick" | "who" | string>(null);
  const [draft, setDraft] = useState<ServiceArea | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [who, setWho] = useState<{ by: DeliveredBy[]; paid: RiderPaid | null }>({ by: [], paid: null });
  const chosen = value.areas.map((a) => a.id);
  const results = useMemo(() => searchCoverageAreas(query, chosen, 12), [query, chosen]);
  const unconfirmed = value.areas.filter((a) => !a.confirmed).length;
  const full = value.areas.length >= COVERAGE_AREA_MAX;

  function openArea(a: ServiceArea) {
    setDraft({ ...a });
    setDraftErrors({});
    setSheet(a.id);
  }

  function saveArea() {
    if (!draft) return;
    const errs = validateServiceArea(draft);
    setDraftErrors(errs);
    if (Object.keys(errs).length) return;
    const next = { ...draft, source: "owner" as const, confirmed: true };
    const exists = value.areas.some((a) => a.id === next.id);
    onChange({ ...value, areas: exists ? value.areas.map((a) => (a.id === next.id ? next : a)) : [...value.areas, next] });
    setSheet(null);
  }

  function removeArea(id: string) {
    onChange({ ...value, areas: value.areas.filter((a) => a.id !== id) });
    setSheet(null);
  }

  const whoSummary = value.delivered_by.map((b) => DELIVERED_BY.find((o) => o.id === b)?.label).join(", ");
  const editingId = sheet && sheet !== "pick" && sheet !== "who" ? sheet : null;

  return (
    <div className="space-y-6" data-service-areas-editor="">
      <SettingsGroup title="Areas you serve">
        {unconfirmed ? (
          <div className="space-y-2 bg-accent-tonal px-4 py-3" role="note">
            <p className="text-body font-medium text-ink">Add your fees</p>
            <p className="text-meta text-ink-2">
              We moved these from Policies. Until you open an area and save it, your Business Assistant says the fee is confirmed on a callback.
            </p>
          </div>
        ) : null}
        {value.areas.map((a) => (
          <OpenRow
            key={a.id}
            id={`area-row-${a.id}`}
            title={coverageAreaLabel(a.id)}
            value={a.confirmed ? areaSummary(a) || undefined : "Fee not set"}
            disabled={!canEdit}
            onOpen={() => openArea(a)}
          />
        ))}
        {value.areas.length === 0 ? (
          <p className="px-4 py-3 text-meta text-ink-2">
            Add the places you deliver to or visit, so your Business Assistant can quote the fee instead of guessing.
          </p>
        ) : null}
        {canEdit && !full ? (
          <AddRow
            label="Add an area"
            onOpen={() => {
              setQuery("");
              setSheet("pick");
            }}
          />
        ) : null}
      </SettingsGroup>

      {value.areas.some((a) => a.modes.includes("delivery")) ? (
        <SettingsGroup title="Who delivers">
          <OpenRow
            id="area-row-who"
            title="Delivered by"
            value={whoSummary || "Not set"}
            disabled={!canEdit}
            onOpen={() => {
              setWho({ by: value.delivered_by, paid: value.rider_paid });
              setSheet("who");
            }}
          />
        </SettingsGroup>
      ) : null}

      <CallersHear text={serviceAreasSentence(value)} empty="Add an area to hear what callers are told." />

      {/* Pick an area */}
      <Sheet open={sheet === "pick"} onOpenChange={(o) => !o && setSheet(null)} title="Add an area" description="Search a county, town or estate.">
        <TextField
          id="area-search"
          label="Area"
          hideLabel
          placeholder="Ruaka, Kitengela, Mombasa…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <ul className="-mx-1 mt-2 divide-y divide-hairline">
          {results.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                onClick={() => {
                  setDraft(newServiceArea(o.id, vertical));
                  setDraftErrors({});
                  setSheet(o.id);
                }}
              >
                <span className="text-body text-ink">{o.label}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className="px-3 py-3 text-meta text-ink-2">No match. Try the nearest town.</li> : null}
        </ul>
      </Sheet>

      {/* One area */}
      <Sheet
        open={Boolean(editingId && draft)}
        onOpenChange={(o) => !o && setSheet(null)}
        title={editingId ? coverageAreaLabel(editingId) : ""}
        description="What callers from here are told."
        footer={
          <div className="flex w-full items-center gap-2">
            {editingId && chosen.includes(editingId) ? (
              <Button variant="ghost" onClick={() => removeArea(editingId)}>
                Remove
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button onClick={saveArea}>Done</Button>
          </div>
        }
      >
        {draft ? (
          <div className="space-y-5">
            <CheckList<AreaMode>
              label="How you serve it"
              multiple
              options={AREA_MODES}
              value={draft.modes}
              onChange={(modes) => setDraft({ ...draft, modes })}
            />
            {draftErrors.modes ? <p className="text-meta text-danger">{draftErrors.modes}</p> : null}
            {draft.modes.some((m) => m !== "pickup") ? (
              <>
                <CheckList<FeeMode>
                  label="Fee"
                  options={FEE_MODES}
                  value={[draft.fee_mode]}
                  onChange={(v) => v[0] && setDraft({ ...draft, fee_mode: v[0], fee_ksh: v[0] === "fixed" ? draft.fee_ksh : null })}
                />
                {draft.fee_mode === "fixed" ? (
                  <TextField
                    id="area-fee"
                    label="Fee (KSh)"
                    inputMode="numeric"
                    value={draft.fee_ksh ?? ""}
                    error={draftErrors.fee_ksh}
                    onChange={(e) => setDraft({ ...draft, fee_ksh: kshInput(e.target.value) })}
                  />
                ) : null}
                <TextField
                  id="area-eta"
                  label="How long it takes (optional)"
                  placeholder="Same day"
                  maxLength={ETA_MAX}
                  value={draft.eta ?? ""}
                  error={draftErrors.eta}
                  onChange={(e) => setDraft({ ...draft, eta: e.target.value || null })}
                />
                <TextField
                  id="area-min"
                  label="Minimum order, KSh (optional)"
                  inputMode="numeric"
                  value={draft.min_order_ksh ?? ""}
                  error={draftErrors.min_order_ksh}
                  onChange={(e) => setDraft({ ...draft, min_order_ksh: kshInput(e.target.value) })}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* Who delivers */}
      <Sheet
        open={sheet === "who"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Who delivers"
        footer={
          <Button
            block
            onClick={() => {
              onChange({ ...value, delivered_by: who.by, rider_paid: who.by.includes("rider") ? who.paid : null });
              setSheet(null);
            }}
          >
            Done
          </Button>
        }
      >
        <div className="space-y-5">
          <CheckList<DeliveredBy> label="Delivered by" multiple options={DELIVERED_BY} value={who.by} onChange={(by) => setWho({ ...who, by })} />
          {who.by.includes("rider") ? (
            <CheckList<RiderPaid>
              label="Rider is paid"
              options={RIDER_PAID}
              value={who.paid ? [who.paid] : []}
              onChange={(v) => setWho({ ...who, paid: v[0] ?? null })}
            />
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
