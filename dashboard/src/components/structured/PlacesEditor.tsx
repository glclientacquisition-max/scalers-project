"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { SettingsGroup } from "@/components/settingsUi";
import { coverageAreaLabel, searchAreaOptions } from "@/lib/coverageAreas";
import {
  LOCATIONS_MAX,
  emptyLocation,
  placeSummary,
  validatePlace,
  type BusinessLocation,
} from "@/lib/businessLocations";
import { AddRow, OpenRow } from "./PickList";

const FIND_US_MAX = 400;

/**
 * Your places / branches. A grouped list; each place opens a bottom drawer with kit fields:
 * name, area (from the directory), street, landmark, Find us, and hours (business hours
 * unless switched off). Controlled: the Settings form saves the list with Locations.
 */
export function PlacesEditor({
  value,
  onSave,
  title,
  hint,
  businessHours,
  canEdit = true,
}: {
  value: BusinessLocation[];
  /** Change and save the page now: the drawer's Done and Remove commit with this. */
  onSave: (next: BusinessLocation[]) => void;
  title: string;
  hint?: string;
  /** Summary of the business hours, shown on the "Same as business hours" switch. */
  businessHours?: string;
  canEdit?: boolean;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<BusinessLocation>(emptyLocation());
  const [ownHours, setOwnHours] = useState(false);
  const [areaQuery, setAreaQuery] = useState("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const rows = value.filter((l) => validatePlace(l).label === undefined);
  const results = useMemo(
    () => (areaQuery.trim() ? searchAreaOptions(areaQuery, draft.area_id ? [draft.area_id] : [], 6) : []),
    [areaQuery, draft.area_id]
  );

  function open(i: number) {
    const loc = i < value.length ? value[i] : emptyLocation();
    setDraft({ ...loc });
    setOwnHours(Boolean(loc.hours));
    setAreaQuery("");
    setError("");
    setIndex(i);
  }

  function save() {
    if (index == null) return;
    const next = { ...draft, hours: ownHours ? (draft.hours ?? "").trim() : "" };
    const first = Object.values(validatePlace(next))[0];
    if (first) return setError(first);
    const list = [...value];
    if (index < list.length) list[index] = next;
    else list.push(next);
    onSave(list);
    setIndex(null);
  }

  // Remove saves the page at once, so ask first. Cancel goes back to the drawer as it was.
  function remove() {
    if (index == null) return;
    setConfirmRemove(index);
    setIndex(null);
  }

  function confirmRemoveNow() {
    if (confirmRemove == null) return;
    onSave(value.filter((_, i) => i !== confirmRemove));
    setConfirmRemove(null);
  }

  function cancelRemove() {
    const i = confirmRemove;
    setConfirmRemove(null);
    setIndex(i);
  }

  const removing = confirmRemove != null ? value[confirmRemove] : null;
  const removingName = removing ? removing.label || (removing.area_id ? coverageAreaLabel(removing.area_id) : "") : "";

  const isNew = index != null && index >= value.length;

  return (
    <div className="space-y-2" data-places-editor="">
      <SettingsGroup title={title}>
        {hint ? <p className="px-4 pt-3 text-meta text-ink-2">{hint}</p> : null}
        {value.map((loc, i) =>
          validatePlace(loc).label ? null : (
            <OpenRow
              key={`place-${i}`}
              id={`place-row-${i}`}
              title={loc.label || (loc.area_id ? coverageAreaLabel(loc.area_id) : "Place")}
              value={placeSummary(loc) || undefined}
              disabled={!canEdit}
              onOpen={() => open(i)}
            />
          )
        )}
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-meta text-ink-2">Add where customers find you, so callers get clear directions.</p>
        ) : null}
        {canEdit && value.length < LOCATIONS_MAX ? (
          <AddRow label={rows.length ? "Add a branch" : "Add your shop"} onOpen={() => open(rows.length ? value.length : 0)} />
        ) : null}
      </SettingsGroup>

      <Sheet
        open={index != null}
        onOpenChange={(o) => !o && setIndex(null)}
        title={isNew ? "Add a place" : draft.label || "Place"}
        description="What callers hear when they ask where you are."
        footer={
          <div className="flex w-full items-center gap-2">
            {!isNew ? (
              <Button variant="ghost" onClick={remove}>
                Remove
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button onClick={save} data-place-save="">
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <TextField
            id="place-name"
            label="Name"
            placeholder="Main shop or CBD"
            maxLength={80}
            autoComplete="organization"
            enterKeyHint="next"
            error={error || undefined}
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />

          <div className="space-y-2">
            {draft.area_id ? (
              <div className="flex min-h-11 items-center gap-3 rounded-xl border border-hairline bg-surface px-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-meta text-ink-2">Area</span>
                  <span className="block text-body text-ink">{coverageAreaLabel(draft.area_id)}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, area_id: "" })}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <TextField
                  id="place-area"
                  label="Area"
                  hint="Search an estate, town or county."
                  placeholder="Search estate or town"
                  autoComplete="off"
                  enterKeyHint="search"
                  value={areaQuery}
                  onChange={(e) => setAreaQuery(e.target.value)}
                />
                {results.length ? (
                  <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface" aria-label="Matching areas">
                    {results.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center gap-3 px-3 text-start text-body text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                          onClick={() => {
                            setDraft({ ...draft, area_id: o.id });
                            setAreaQuery("");
                          }}
                        >
                          <span className="min-w-0 flex-1">{o.label}</span>
                          <span className="text-meta text-ink-2">{o.hint}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <TextField
            id="place-street"
            label="Street or building (optional)"
            placeholder="Kimathi St, 2nd floor"
            maxLength={200}
            autoComplete="street-address"
            enterKeyHint="next"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
          <TextField
            id="place-landmark"
            label="Landmark (optional)"
            placeholder="Opposite Hilton, Kimathi St"
            maxLength={200}
            autoComplete="off"
            enterKeyHint="next"
            value={draft.landmark}
            onChange={(e) => setDraft({ ...draft, landmark: e.target.value })}
          />
          <TextAreaField
            id="place-find-us"
            label="Find us (optional)"
            hint="Read to callers. One or two short sentences."
            placeholder="Stairs by Naivas, 2nd door"
            rows={3}
            maxLength={FIND_US_MAX}
            value={draft.directions}
            onChange={(e) => setDraft({ ...draft, directions: e.target.value })}
          />

          <div className="space-y-3 rounded-xl border border-hairline bg-surface px-3 py-3">
            <Switch
              label="Same as business hours"
              checked={!ownHours}
              onCheckedChange={(same) => setOwnHours(!same)}
            />
            {!ownHours && businessHours ? <p className="text-meta text-ink-2">{businessHours}</p> : null}
            {ownHours ? (
              <TextField
                id="place-hours"
                label="This place's hours"
                placeholder="Mon–Sat 8am–7pm"
                maxLength={80}
                autoComplete="off"
                value={draft.hours ?? ""}
                onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
              />
            ) : null}
          </div>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmRemove != null}
        title={removingName ? `Remove ${removingName}?` : "Remove this place?"}
        confirmLabel="Remove"
        danger
        onClose={cancelRemove}
        onConfirm={confirmRemoveNow}
      >
        It comes off your list of places. This saves straight away.
      </ConfirmSheet>
    </div>
  );
}
