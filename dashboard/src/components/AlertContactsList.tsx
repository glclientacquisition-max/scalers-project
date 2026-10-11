"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@heroicons/react/20/solid";
import type { TeamDirectoryEntry } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { ToolSwitch, settingsDenseFieldClass, settingsGroupTitleClass } from "@/components/settingsUi";

type FlagKey = "receives_escalation" | "receives_inbox" | "receives_ops";

/** Summary under a contact: which alerts they get, in plain words. */
export function alertSummary(entry: TeamDirectoryEntry, flags: ReadonlyArray<{ key: FlagKey; label: string }>): string {
  const on = flags.filter((f) => entry[f.key] === true).map((f) => f.label);
  return on.length ? on.join(" · ") : "No alerts";
}

/**
 * Alert contacts as a grouped inset list. Each row reads at a glance
 * (name, job, phone/email, which alerts) and expands to edit. No table, so nothing truncates.
 */
export function AlertContactsList({
  team,
  flags,
  note,
  addLabel,
  onChange,
  onAdd,
  onRemove,
  canRemove,
}: {
  team: TeamDirectoryEntry[];
  flags: ReadonlyArray<{ key: FlagKey; label: string }>;
  note: string;
  addLabel: string;
  onChange: (index: number, key: keyof TeamDirectoryEntry, value: string | boolean) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** False for the owner's own row: the owner always stays on the alert list. */
  canRemove?: (entry: TeamDirectoryEntry) => boolean;
}) {
  // Blank rows (new contacts) open straight away; saved rows stay collapsed.
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(team.map((m, i) => (!m.name.trim() && !m.phone.trim() ? i : -1)).filter((i) => i >= 0))
  );
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="min-w-0 space-y-1.5" aria-labelledby="alert-contacts-title">
      <div className="px-1">
        <h3 id="alert-contacts-title" className={settingsGroupTitleClass}>Alert contacts</h3>
        <p id="team-notify-channels" className="text-meta text-ink-2">{note}</p>
      </div>
      <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface" data-alert-contacts="">
        {team.map((member, index) => {
          const expanded = open.has(index);
          const name = member.name.trim();
          const who = name || `Contact ${index + 1}`;
          const contact = [member.phone.trim(), String(member.email || "").trim()].filter(Boolean).join(" · ");
          const panelId = `alert-contact-${index}`;
          return (
            <li key={`team-${index}`} className="border-b border-hairline">
              <button
                type="button"
                data-role-exempt=""
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(index)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink [overflow-wrap:anywhere]">
                    {name || <span className="text-ink-3">New contact</span>}
                    {member.role.trim() ? <span className="text-ink-2"> · {member.role.trim()}</span> : null}
                  </span>
                  {contact ? <span className="block text-meta text-ink-2 [overflow-wrap:anywhere]">{contact}</span> : null}
                  <span className="block text-meta text-ink-2 sm:hidden">{alertSummary(member, flags)}</span>
                </span>
                <span className="hidden shrink-0 text-meta text-ink-2 sm:block">{alertSummary(member, flags)}</span>
                {expanded ? (
                  <ChevronUpIcon className="size-5 shrink-0 text-ink-3" aria-hidden data-chevron="up" />
                ) : (
                  <ChevronDownIcon className="size-5 shrink-0 text-ink-3" aria-hidden data-chevron="down" />
                )}
              </button>
              <div id={panelId} hidden={!expanded} className="space-y-3 border-t border-hairline bg-surface-2/40 px-4 py-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["name", "Name", "Wanjiku Mwangi", "text", "name"],
                      ["role", "Job", "Orders and payments", "text", "organization-title"],
                      ["phone", "Phone", "+254 700 000 000", "tel", "tel"],
                      ["email", "Email", "wanjiku@shop.co.ke", "text", "off"],
                    ] as const
                  ).map(([key, label, placeholder, type, auto]) => (
                    <div key={key} className="min-w-0">
                      <label className="block text-meta font-medium text-ink-2" htmlFor={`team-${key}-${index}`}>
                        {label}
                      </label>
                      <input
                        id={`team-${key}-${index}`}
                        type={type}
                        inputMode={key === "email" ? "email" : undefined}
                        autoComplete={auto}
                        value={String(member[key] ?? "")}
                        onChange={(e) => onChange(index, key, e.target.value)}
                        placeholder={placeholder}
                        className={`${settingsDenseFieldClass} mt-1`}
                      />
                    </div>
                  ))}
                </div>
                <div
                  role="group"
                  aria-label={`Alerts for ${who}`}
                  aria-describedby="team-notify-channels"
                  className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface"
                >
                  {flags.map((flag) => (
                    <div key={flag.key} className="flex min-h-11 items-center justify-between gap-3 pl-3 pr-1">
                      <span className="text-body text-ink">{flag.label}</span>
                      <ToolSwitch
                        checked={member[flag.key] === true}
                        label={`${flag.label} for ${who}`}
                        onChange={(next) => onChange(index, flag.key, next)}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  {canRemove && !canRemove(member) ? (
                    <span className="text-meta text-ink-2">The owner always stays on this list.</span>
                  ) : (
                  <Button variant="danger" size="sm" onClick={() => onRemove(index)} aria-label={`Remove ${who}`}>
                    Remove
                  </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => {
              setOpen((prev) => new Set(prev).add(team.length));
              onAdd();
            }}
            className="flex min-h-12 w-full items-center gap-2 px-4 text-start text-body font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <PlusIcon className="size-5" aria-hidden />
            {addLabel}
          </button>
        </li>
      </ul>
    </section>
  );
}
