"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { SettingsGroup } from "@/components/settingsUi";
import { COVERAGE_AREA_MAX, coverageAreaLabel } from "@/lib/coverageAreas";
import {
  AREA_MODES,
  DELIVERED_BY,
  ETA_MAX,
  FEE_MODES,
  REACH_OPTIONS,
  RIDER_PAID,
  reachCopy,
  applyFeeToAreas,
  areaSummary,
  areaPickerRows,
  commonFee,
  withReach,
  serviceAreasSentence,
  outsideFeeHint,
  validateServiceArea,
  type AreaMode,
  type BulkFee,
  type DeliveredBy,
  type FeeMode,
  type Reach,
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
function FeeFields({ fee, label, onChange, error }: { fee: BulkFee; label: string; onChange: (f: BulkFee) => void; error?: string }) {
  return (
    <div className="space-y-3">
      <CheckList<FeeMode>
        label={label}
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
  onSave,
  canEdit = true,
}: {
  value: ServiceAreas;
  vertical?: string | null;
  /** Ticked on first setup, from the shop address. */
  homeAreas?: string[];
  /** Edit without saving (the page Save button saves it). */
  onChange: (next: ServiceAreas) => void;
  /** Change and save the page now: drawers commit with this. */
  onSave: (next: ServiceAreas) => void;
  canEdit?: boolean;
}) {
  const [sheet, setSheet] = useState<null | "bulk" | "fee" | "who" | string>(null);
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [fee, setFee] = useState<BulkFee>(DEFAULT_FEE);
  const [error, setError] = useState<string>("");
  const [feesDiffer, setFeesDiffer] = useState(false);
  const [draft, setDraft] = useState<ServiceArea | null>(null);
  const [more, setMore] = useState(false);
  const [who, setWho] = useState<{ by: DeliveredBy[]; paid: RiderPaid | null }>({ by: [], paid: null });

  const listed = value.areas.map((a) => a.id);
  const { options, alreadyAdded } = useMemo(() => areaPickerRows(query, ticked, listed), [query, ticked, listed]);
  const suggested = [...new Set(homeAreas)].filter((id) => !ticked.includes(id));
  const copy = reachCopy(value.reach);
  const unconfirmed = value.areas.filter((a) => !a.confirmed).length;
  const travelQuoted = value.reach === "visit" || value.reach === "both";
  const [outsideFee, setOutsideFee] = useState(value.outside_fee_ksh != null ? String(value.outside_fee_ksh) : "");
  // One answer for every mode: the field follows the stored fee (after a save, a remount or a mode toggle).
  useEffect(() => {
    setOutsideFee((cur) => (kshInput(cur) === value.outside_fee_ksh ? cur : value.outside_fee_ksh != null ? String(value.outside_fee_ksh) : ""));
  }, [value.outside_fee_ksh]);
  const delivers = copy.riders && value.areas.some((a) => a.modes.includes("delivery"));

  function openBulk() {
    setTicked([]);
    setFee({ ...DEFAULT_FEE, mode: value.reach === "both" ? "delivery" : undefined });
    setQuery("");
    setError("");
    setSheet("bulk");
  }

  function openChangeFee(ids: string[]) {
    const chosen = value.areas.filter((a) => ids.includes(a.id));
    setTicked(chosen.map((a) => a.id));
    const { differ, ...shared } = commonFee(chosen);
    setFee(shared);
    setFeesDiffer(differ);
    setError("");
    setSheet("fee");
  }

  function saveBulk() {
    if (!ticked.length) return setError("Tick at least one area.");
    if (fee.fee_mode === "fixed" && !(fee.fee_ksh && fee.fee_ksh > 0)) return setError("Add the fee in KSh, or pick Free.");
    onSave(applyFeeToAreas(value, ticked, fee, vertical));
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
    onSave({ ...value, areas: value.areas.map((a) => (a.id === next.id ? next : a)) });
    setSheet(null);
  }

  const editing = draft && sheet === draft.id ? draft : null;
  const whoSummary = value.delivered_by.map((b) => DELIVERED_BY.find((o) => o.id === b)?.label).join(", ");

  return (
    <div className="space-y-6" data-service-areas-editor="">
      <CheckList<Reach>
        label="How customers get your service"
        options={REACH_OPTIONS}
        value={[value.reach]}
        onChange={(v) => v[0] && canEdit && onChange(withReach(value, v[0]))}
      />
      {value.reach !== "visit" ? (
        <p className="-mt-3 text-meta text-ink-2">
          No shop? “We come to you” shows when you pick We visit customers.
        </p>
      ) : null}
      {value.reach === "visit" ? (
        <CheckList<"none">
          label="Your premises"
          multiple
          options={[{ id: "none", label: "We come to you", detail: "No shop or office for callers to visit" }]}
          value={value.no_premises ? ["none"] : []}
          onChange={(v) => canEdit && onChange({ ...value, no_premises: v.includes("none") })}
        />
      ) : null}
      {!copy.areas ? null : value.areas.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface px-4 py-5 text-center">
          <p className="text-body font-medium text-ink">{copy.title}</p>
          <p className="text-meta text-ink-2">{copy.empty} Your Business Assistant tells callers the price.</p>
          {canEdit ? (
            <Button onClick={() => openBulk()} data-areas-add="">
              Add areas
            </Button>
          ) : null}
        </div>
      ) : (
        <SettingsGroup title={copy.title}>
          {unconfirmed ? (
            <div className="space-y-2 bg-accent-tonal px-4 py-3" role="note">
              <p className="text-body font-medium text-ink">Add your fee</p>
              <p className="text-meta text-ink">Until you set a fee, callers hear that you will confirm it when you call back.</p>
              {canEdit ? (
                <Button variant="tonal" size="sm" onClick={() => openChangeFee(value.areas.filter((a) => !a.confirmed).map((a) => a.id))}>
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
          {canEdit && value.areas.length < COVERAGE_AREA_MAX ? <AddRow label="Add areas" onOpen={() => openBulk()} /> : null}
          {canEdit && value.areas.length > 1 ? <AddRow label="Change fee for several" onOpen={() => openChangeFee(listed)} /> : null}
        </SettingsGroup>
      )}

      {copy.areas && value.areas.length > 0 ? (
        <div className="space-y-3" data-outside-areas="">
          <CheckList<"no" | "kenya">
            label="Do you go outside these areas?"
            options={[
              { id: "no", label: "No", detail: "Only the areas above" },
              {
                id: "kenya",
                label: "Yes, anywhere in Kenya",
                detail: travelQuoted ? "The team calls back with the travel price" : "One fee for the rest of Kenya",
              },
            ]}
            value={[value.anywhere_kenya ? "kenya" : "no"]}
            onChange={(v) => {
              if (!canEdit || !v[0]) return;
              const yes = v[0] === "kenya";
              onChange({ ...value, anywhere_kenya: yes });
            }}
          />
          {value.anywhere_kenya && !travelQuoted ? (
            <TextField
              id="outside-fee"
              label="Fee for the rest of Kenya (KSh, optional)"
              inputMode="numeric"
              placeholder="e.g. 350"
              hint={outsideFeeHint(value.outside_fee_ksh)}
              disabled={!canEdit}
              value={outsideFee}
              onChange={(e) => {
                const text = e.target.value.replace(/[^\d,\s]/g, "");
                setOutsideFee(text);
                const n = kshInput(text);
                onChange({ ...value, outside_fee_ksh: n != null && n >= 0 ? n : null });
              }}
            />
          ) : null}
          {value.anywhere_kenya && travelQuoted ? (
            <p className="text-meta text-ink-2">Callers outside your areas get a callback with the travel price. Your Business Assistant never books a time for them.</p>
          ) : null}
        </div>
      ) : null}

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
        description="Tick the places, then one fee for all."
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
            placeholder="Search area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {suggested.length ? (
            <div className="space-y-1.5">
              <p className="text-meta font-medium text-ink">Suggested</p>
              <div className="flex flex-wrap gap-2">
                {suggested.map((id) =>
                  listed.includes(id) ? (
                    <span key={id} className="inline-flex min-h-9 items-center rounded-full bg-surface-2 px-3 text-meta text-ink-2">
                      {coverageAreaLabel(id)} · Added
                    </span>
                  ) : (
                    <Button key={id} variant="tonal" size="sm" onClick={() => setTicked([...ticked, id])}>
                      + {coverageAreaLabel(id)}
                    </Button>
                  )
                )}
              </div>
            </div>
          ) : null}
          {options.length ? (
            <CheckList<string> label="Areas" multiple options={options} value={ticked} onChange={setTicked} />
          ) : null}
          {alreadyAdded.length ? (
            <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface" aria-label="Already added">
              {alreadyAdded.map((o) => (
                <li key={o.id} className="flex min-h-11 items-center gap-3 px-3 text-body text-ink-2">
                  <span className="min-w-0 flex-1">{o.label}</span>
                  <span className="text-meta">Added</span>
                </li>
              ))}
            </ul>
          ) : null}
          {!options.length && !alreadyAdded.length && query.trim() ? (
            <p className="text-meta text-ink-2">No match. Try the nearest town.</p>
          ) : null}
          {copy.perArea ? (
            <CheckList<AreaMode>
              label="For these areas"
              options={AREA_MODES.filter((o) => o.id !== "pickup")}
              value={fee.mode ? [fee.mode] : []}
              onChange={(v) => v[0] && setFee({ ...fee, mode: v[0] })}
            />
          ) : null}
          <FeeFields
            fee={fee}
            label={copy.perArea ? (fee.mode === "visit" ? "Call-out fee" : "Delivery fee") : copy.fee}
            onChange={setFee}
            error={error && fee.fee_mode === "fixed" ? error : undefined}
          />
          <TextField
            id="area-eta"
            label="How long it takes"
            maxLength={ETA_MAX}
            value={fee.eta ?? ""}
            onChange={(e) => setFee({ ...fee, eta: e.target.value || null })}
          />
          {error && fee.fee_mode !== "fixed" ? <p className="text-meta text-attention">{error}</p> : null}
        </div>
      </Sheet>

      {/* Change fee for existing areas */}
      <Sheet
        open={sheet === "fee"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Change fee"
        description="Pick the areas, then the new fee."
        footer={
          <Button block onClick={saveBulk} data-areas-fee-save="">
            {ticked.length ? `Save fee for ${ticked.length} ${ticked.length === 1 ? "area" : "areas"}` : "Save"}
          </Button>
        }
      >
        <div className="space-y-5">
          <CheckList<string>
            label="Areas"
            multiple
            options={value.areas.map((a) => ({ id: a.id, label: coverageAreaLabel(a.id), detail: a.confirmed ? areaSummary(a) : "Fee not set" }))}
            value={ticked}
            onChange={setTicked}
          />
          {feesDiffer ? (
            <p className="rounded-xl bg-accent-tonal px-3 py-2 text-meta text-ink" role="note">
              Fees differ between these areas. Enter one fee to use for all of them.
            </p>
          ) : null}
          <FeeFields
            fee={fee}
            label={copy.fee || "Fee"}
            onChange={setFee}
            error={error && fee.fee_mode === "fixed" ? error : undefined}
          />
          <TextField
            id="area-eta-fee"
            label="How long it takes"
            placeholder="Same day"
            maxLength={ETA_MAX}
            value={fee.eta ?? ""}
            onChange={(e) => setFee({ ...fee, eta: e.target.value || null })}
          />
          {error && fee.fee_mode !== "fixed" ? <p className="text-meta text-attention">{error}</p> : null}
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
                if (editing) onSave({ ...value, areas: value.areas.filter((a) => a.id !== editing.id) });
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
              label={editing.modes[0] === "visit" ? "Call-out fee" : "Delivery fee"}
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
              onSave({ ...value, delivered_by: who.by, rider_paid: who.by.includes("rider") ? who.paid : null });
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
