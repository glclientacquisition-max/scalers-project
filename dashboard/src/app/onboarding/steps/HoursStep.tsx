"use client";

import { Switch } from "@/components/ui/Switch";
import {
  DAY_NAME,
  DAYS,
  LIMITS,
  type DayKey,
  type DayPlan,
  type FieldErrors,
  type HoursStep as Value,
  splitLast,
} from "@/lib/setupFlow";
import { FieldError, TextButton, inputClass } from "./ui";

const PRESETS: Array<{ label: string; days: DayKey[]; open: string; close: string }> = [
  // First chip = the default week (most Kenyan shops and trades open Saturday).
  { label: "Mon-Sat, 8 to 6", days: ["mon", "tue", "wed", "thu", "fri", "sat"], open: "08:00", close: "18:00" },
  { label: "Mon-Fri, 9 to 5", days: ["mon", "tue", "wed", "thu", "fri"], open: "09:00", close: "17:00" },
  { label: "Every day, 8 to 8", days: DAYS, open: "08:00", close: "20:00" },
];

export function HoursStep({ value, onChange, errors }: { value: Value; onChange: (v: Value) => void; errors: FieldErrors }) {
  const setDay = (key: DayKey, plan: DayPlan) => onChange({ skipped: false, days: { ...value.days, [key]: plan } });

  function applyPreset(p: (typeof PRESETS)[number]) {
    const days = { ...value.days };
    for (const key of DAYS) {
      days[key] = p.days.includes(key) ? { closed: false, shifts: [{ open: p.open, close: p.close }] } : { closed: true, shifts: [] };
    }
    onChange({ skipped: false, days });
  }

  function copyMonday() {
    const mon = value.days.mon;
    const days = { ...value.days };
    for (const key of ["tue", "wed", "thu", "fri"] as DayKey[]) days[key] = { closed: mon.closed, shifts: mon.shifts.map((s) => ({ ...s })) };
    onChange({ skipped: false, days });
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2 px-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p)}
            aria-pressed={DAYS.every((k) => { const d = value.days[k]; return p.days.includes(k) ? !d.closed && d.shifts.length === 1 && d.shifts[0].open === p.open && d.shifts[0].close === p.close : d.closed; })}
            className="min-h-11 rounded-full bg-surface px-4 text-meta font-medium text-ink hover:bg-surface-2 aria-pressed:bg-accent-soft aria-pressed:text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {p.label}
          </button>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-2xl bg-surface" aria-label="Opening hours by day">
        {DAYS.map((key) => {
          const day = value.days[key];
          const open = !day.closed;
          const dayErr = errors[`days.${key}`];
          return (
            <li key={key} className="px-4 py-3" data-field={`days.${key}`}>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-body font-medium text-ink">{DAY_NAME[key]}</span>
                <span className="flex items-center gap-2">
                  <span className="text-meta text-ink-2" aria-hidden>
                    {open ? "Open" : "Closed"}
                  </span>
                  <Switch
                    checked={open}
                    label={`Open on ${DAY_NAME[key]}`}
                    onCheckedChange={(on) =>
                      setDay(key, on ? { closed: false, shifts: day.shifts.length ? day.shifts : [{ open: "08:00", close: "18:00" }] } : { closed: true, shifts: day.shifts })
                    }
                  />
                </span>
              </div>
              {open ? (
                <div className="mt-1 space-y-2">
                  {day.shifts.map((s, i) => {
                    const err = errors[`days.${key}.${i}`];
                    const errId = `hours-${key}-${i}-err`;
                    return (
                      <div key={i} data-field={`days.${key}.${i}`}>
                        <div className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`${key}-${i}-open`}>
                            {DAY_NAME[key]} {i ? "second " : ""}opening time
                          </label>
                          <input
                            id={`${key}-${i}-open`}
                            type="time"
                            step={900}
                            value={s.open}
                            onChange={(e) => setDay(key, { closed: false, shifts: day.shifts.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)) })}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? errId : undefined}
                            className={`${inputClass} w-auto flex-1 tabular-nums`}
                          />
                          <span className="text-meta text-ink-2" aria-hidden>
                            to
                          </span>
                          <label className="sr-only" htmlFor={`${key}-${i}-close`}>
                            {DAY_NAME[key]} {i ? "second " : ""}closing time
                          </label>
                          <input
                            id={`${key}-${i}-close`}
                            type="time"
                            step={900}
                            value={s.close}
                            onChange={(e) => setDay(key, { closed: false, shifts: day.shifts.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)) })}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? errId : undefined}
                            className={`${inputClass} w-auto flex-1 tabular-nums`}
                          />
                          {i > 0 ? (
                            <TextButton tone="danger" label={`Remove second hours on ${DAY_NAME[key]}`} onClick={() => setDay(key, { closed: false, shifts: day.shifts.filter((_, j) => j !== i) })}>
                              Remove
                            </TextButton>
                          ) : null}
                        </div>
                        <FieldError id={errId} message={err} />
                      </div>
                    );
                  })}
                  {day.shifts.length < LIMITS.shiftsPerDay ? (
                    <TextButton
                      label={`Add a break on ${DAY_NAME[key]}`}
                      onClick={() => setDay(key, { closed: false, shifts: splitLast(day.shifts) })}
                    >
                      Add a break
                    </TextButton>
                  ) : null}
                  <FieldError id={`hours-${key}-err`} message={dayErr} />
                </div>
              ) : null}
              {key === "mon" && open ? (
                <TextButton tone="muted" onClick={copyMonday}>
                  Copy to Tue-Fri
                </TextButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 px-4 text-meta text-ink-2">
        Use a break for lunch or split shifts. Outside these hours your receptionist still answers and takes messages.
      </p>
    </>
  );
}
