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
  applyFeeToAreas,
  areaSummary,
  serviceAreasSentence,
  validateServiceArea,
  type AreaMode,
  type BulkFee,
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

const DEFAULT_FEE: BulkFee = { fee_mode: "free", fee_ksh: null, eta: "Same day" };

/** Fee picker shared by the "Add areas" drawer and one area's drawer. */
function FeeFields({ fee, onChange, error }: { fee: BulkFee; onChange: (f: BulkFee) => void; error?: string }) {
  return (
    <div className="space-y-3">
      <CheckList<FeeMode>
        label="Delivery fee"
        options={FEE_MODES}
        value={[fee.fee_mode]}
        onChange={(v) => v[0] && onChange({ ...fee, fee_mode: v[0] })}
      />
      {fee.fee_mode === "fixed" ? (
        <TextField
          id="area-fee"
          label="Fee (KSh)"
          inputMode="numeric"
          autoFocus
          value={fee.fee_ksh ?? ""}
          error={error}
          onChange={(e) => onChange({ ...fee, fee_ksh: kshInput(e.target.value) })}
        />
      ) : null}
    </div>
  );
}

/**
 * Areas you serve, for a busy owner on a phone. One "Add areas" drawer: search, tick
 * several places (their own county is ticked already), pick one fee, save. Each area can
 * be opened later; extra details sit behind "More options". Controlled by the Settings form.
 */
export function ServiceAreasEditor({
  value,
  vertical,
  homeAreas = [],
  onChange,
  canEdit = true,
}: {
  value: ServiceAreas;
  vertical?: string | null;
  /** Ticked on first setup, from the shop address. */
  homeAreas?: string[];
  onChange: (next: ServiceAreas) => void;
  canEdit?: boolean;
}) {
  const [sheet, setSheet] = useState<null | "bulk" | "who" | string>(null);
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [fee, setFee] = useState<BulkFee>(DEFAULT_FEE);
  const [error, setError] = useState<string>("");
  const [draft, setDraft] = useState<ServiceArea | null>(null);
  const [more, setMore] = useState(false);
  const [who, setWho] = useState<{ by: DeliveredBy[]; paid: RiderPaid | null }>({ by: [], paid: null });

  const listed = value.areas.map((a) => a.id);
  const results = useMemo(() => searchCoverageAreas(query, ticked, 8), [query, ticked]);
  const options = [
    ...ticked.map((id) => ({ id, label: coverageAreaLabel(id) })),
    ...results.map((o) => ({ id: o.id, label: o.label })),
  ];
  const unconfirmed = value.areas.filter((a) => !a.confirmed).length;
  const delivers = value.areas.some((a) => a.modes.includes("delivery"));

  function openBulk(ids: string[]) {
    setTicked(ids);
    setFee(DEFAULT_FEE);
    setQuery("");
    setError("");
    setSheet("bulk");
  }

  function saveBulk() {
    if (!ticked.length) return setError("Tick at least one area.");
    if (fee.fee_mode === "fixed" && !(fee.fee_ksh && fee.fee_ksh > 0)) return setError("Add the fee in KSh, or pick Free.");
    onChange(applyFeeToAreas(value, ticked, fee, vertical));
    setSheet(null);
  }

  function openArea(a: ServiceArea) {
    setDraft({ ...a });
    setMore(false);
    setError("");
    setSheet(a.id);
  }

  function saveArea() {
    if (!draft) return;
    const first = Object.values(validateServiceArea(draft))[0];
    if (first) return setError(first);
    const next = { ...draft, source: "owner" as const, confirmed: true };
    onChange({ ...value, areas: value.areas.map((a) => (a.id === next.id ? next : a)) });
    setSheet(null);
  }

  const editing = draft && sheet === draft.id ? draft : null;
  const whoSummary = value.delivered_by.map((b) => DELIVERED_BY.find((o) => o.id === b)?.label).join(", ");

  return (
    <div className="space-y-6" data-service-areas-editor="">
      {value.areas.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface px-4 py-5 text-center">
          <p className="text-body font-medium text-ink">Where do you deliver?</p>
          <p className="text-meta text-ink-2">Add your areas and one fee. Your Business Assistant tells callers the price.</p>
          {canEdit ? (
            <Button onClick={() => openBulk(homeAreas)} data-areas-add="">
              Add areas
            </Button>
          ) : null}
        </div>
      ) : (
        <SettingsGroup title="Areas you serve">
          {unconfirmed ? (
            <div className="space-y-2 bg-accent-tonal px-4 py-3" role="note">
              <p className="text-body font-medium text-ink">Add your fee</p>
              <p className="text-meta text-ink-2">We moved these from Policies. Until you set a fee, callers hear it is confirmed on a callback.</p>
              {canEdit ? (
                <Button variant="tonal" size="sm" onClick={() => openBulk(value.areas.filter((a) => !a.confirmed).map((a) => a.id))}>
                  Set one fee for all
                </Button>
              ) : null}
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
          {canEdit && value.areas.length < COVERAGE_AREA_MAX ? <AddRow label="Add areas" onOpen={() => openBulk([])} /> : null}
          {canEdit && value.areas.length > 1 ? <AddRow label="Change fee for several" onOpen={() => openBulk(listed)} /> : null}
        </SettingsGroup>
      )}

      {delivers ? (
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

      {/* Add areas, one fee */}
      <Sheet
        open={sheet === "bulk"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Add areas"
        description="Tick the places you deliver to. One fee for all."
        footer={
          <Button block onClick={saveBulk} data-areas-save="">
            {ticked.length ? `Save ${ticked.length} ${ticked.length === 1 ? "area" : "areas"}` : "Save"}
          </Button>
        }
      >
        <div className="space-y-5">
          <TextField
            id="area-search"
            label="Find an area"
            hideLabel
            placeholder="Search: Ruaka, Kitengela, Nyali…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {options.length ? (
            <CheckList<string> label="Areas" multiple options={options} value={ticked} onChange={setTicked} />
          ) : (
            <p className="text-meta text-ink-2">No match. Try the nearest town.</p>
          )}
          <FeeFields fee={fee} onChange={setFee} error={error && fee.fee_mode === "fixed" ? error : undefined} />
          <TextField
            id="area-eta"
            label="How long it takes"
            maxLength={ETA_MAX}
            value={fee.eta ?? ""}
            onChange={(e) => setFee({ ...fee, eta: e.target.value || null })}
          />
          {error && fee.fee_mode !== "fixed" ? <p className="text-meta text-danger">{error}</p> : null}
        </div>
      </Sheet>

      {/* One area */}
      <Sheet
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setSheet(null)}
        title={editing ? coverageAreaLabel(editing.id) : ""}
        footer={
          <div className="flex w-full items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (editing) onChange({ ...value, areas: value.areas.filter((a) => a.id !== editing.id) });
                setSheet(null);
              }}
            >
              Remove
            </Button>
            <span className="flex-1" />
            <Button onClick={saveArea}>Done</Button>
          </div>
        }
      >
        {editing ? (
          <div className="space-y-5">
            <FeeFields
              fee={{ fee_mode: editing.fee_mode, fee_ksh: editing.fee_ksh, eta: editing.eta }}
              onChange={(f) => setDraft({ ...editing, fee_mode: f.fee_mode, fee_ksh: f.fee_mode === "fixed" ? f.fee_ksh : null })}
              error={error}
            />
            {more ? (
              <>
                <CheckList<AreaMode>
                  label="What you do there"
                  multiple
                  options={AREA_MODES}
                  value={editing.modes}
                  onChange={(modes) => setDraft({ ...editing, modes })}
                />
                <TextField
                  id="area-eta-one"
                  label="How long it takes"
                  placeholder="Same day"
                  maxLength={ETA_MAX}
                  value={editing.eta ?? ""}
                  onChange={(e) => setDraft({ ...editing, eta: e.target.value || null })}
                />
                <TextField
                  id="area-min"
                  label="Smallest order (KSh)"
                  inputMode="numeric"
                  value={editing.min_order_ksh ?? ""}
                  onChange={(e) => setDraft({ ...editing, min_order_ksh: kshInput(e.target.value) })}
                />
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setMore(true)}>
                More options
              </Button>
            )}
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
              label="Who pays the rider"
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
