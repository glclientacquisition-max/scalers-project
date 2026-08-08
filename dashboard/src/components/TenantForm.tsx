"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { FaqEntry, TeamDirectoryEntry, TenantRow } from "@/lib/supabase";
import type { OnboardingTone } from "@/lib/onboarding";
import { TONE_LABELS } from "@/lib/onboarding";
import {
  DAY_LABELS,
  DAY_ORDER,
  formatHoursForCompiler,
  scheduleForForm,
  type DayKey,
  type HoursSchedule,
} from "@/lib/hoursSchedule";
import {
  AFTER_HOURS_OPTIONS,
  parseAfterHoursMode,
  type AfterHoursMode,
} from "@/lib/afterHours";
import {
  emptyService,
  extractServicesNotes,
  formatServicesForCompiler,
  normalizeServicesCatalog,
  parseBulkServices,
  type ServiceItem,
} from "@/lib/servicesCatalog";
import {
  saveAndCompileSettings,
  type SettingsCompileState,
} from "@/app/(desk)/settings/actions";

const TONE_OPTIONS: { id: OnboardingTone; blurb: string }[] = [
  {
    id: "professional",
    blurb: "Calm, clear, and polished. Best for clinics, offices, and formal brands.",
  },
  {
    id: "friendly",
    blurb: "Warm and helpful, like a receptionist people enjoy talking to.",
  },
  {
    id: "empathetic",
    blurb: "Steady and caring. Acknowledges frustration before solving.",
  },
  {
    id: "localized",
    blurb: "Natural Kenyan voice with light Sheng when the caller uses it.",
  },
];

function initialTone(tenant: TenantRow): OnboardingTone | "" {
  const t = String(tenant.agent_tone || "").toLowerCase();
  if (
    t === "professional" ||
    t === "friendly" ||
    t === "empathetic" ||
    t === "localized"
  ) {
    return t;
  }
  return "";
}

function normalizeTeam(raw: TenantRow["team_directory"]): TeamDirectoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      name: String(row?.name || "").trim(),
      role: String(row?.role || "").trim(),
      phone: String(row?.phone || "").trim(),
    }))
    .filter((row) => row.name || row.role || row.phone);
}

function normalizeFaqs(raw: TenantRow["faqs"]): FaqEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      question: String(row?.question || "").trim(),
      answer: String(row?.answer || "").trim(),
    }))
    .filter((row) => row.question || row.answer);
}

const emptyMember = (): TeamDirectoryEntry => ({ name: "", role: "", phone: "" });
const emptyFaq = (): FaqEntry => ({ question: "", answer: "" });

/** Pull location prose from legacy free-text hours when schedule.location is empty. */
function extractLocationFallback(businessHours: string): string {
  const text = String(businessHours || "").trim();
  if (!text) return "";
  const loc = text.match(/location\s*[/:]?\s*(.+)$/i);
  if (loc?.[1]) return loc[1].trim();
  // If it looks like a schedule summary only, skip.
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(text) && text.length < 180) {
    return "";
  }
  return text;
}

const initial: SettingsCompileState = {};

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[#0096FF]";

export function TenantForm({ tenant }: { tenant: TenantRow }) {
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [servicesNotes, setServicesNotes] = useState(() =>
    extractServicesNotes(tenant.services_offered || "")
  );
  const [services, setServices] = useState<ServiceItem[]>(() => {
    const rows = normalizeServicesCatalog(tenant.services_catalog);
    return rows.length ? rows : [emptyService()];
  });
  const [showBulkServices, setShowBulkServices] = useState(false);
  const [bulkServicesText, setBulkServicesText] = useState("");
  const [bulkServicesError, setBulkServicesError] = useState<string | null>(null);
  const [unknownFallback, setUnknownFallback] = useState(
    tenant.unknown_answer_fallback || ""
  );
  const [agentName, setAgentName] = useState(tenant.agent_name || "Receptionist");
  const [tone, setTone] = useState<OnboardingTone | "">(initialTone(tenant));
  const [hoursSchedule, setHoursSchedule] = useState<HoursSchedule>(() =>
    scheduleForForm(tenant.hours_schedule, tenant.business_hours || "")
  );
  const [locationNotes, setLocationNotes] = useState(
    () =>
      scheduleForForm(tenant.hours_schedule, "").location ||
      extractLocationFallback(tenant.business_hours || "")
  );
  const [afterHoursMode, setAfterHoursMode] = useState<AfterHoursMode>(() =>
    parseAfterHoursMode(tenant.after_hours_mode)
  );
  const [team, setTeam] = useState<TeamDirectoryEntry[]>(() => {
    const rows = normalizeTeam(tenant.team_directory);
    return rows.length ? rows : [emptyMember()];
  });
  const [faqs, setFaqs] = useState<FaqEntry[]>(() => {
    const rows = normalizeFaqs(tenant.faqs);
    return rows.length ? rows : [emptyFaq()];
  });
  const [state, formAction, pending] = useActionState(saveAndCompileSettings, initial);
  const [flash, setFlash] = useState<string | null>(null);

  const teamJson = useMemo(
    () =>
      JSON.stringify(
        team.filter((m) => m.name.trim() || m.role.trim() || m.phone.trim())
      ),
    [team]
  );
  const faqsJson = useMemo(
    () =>
      JSON.stringify(
        faqs.filter((f) => f.question.trim() && f.answer.trim())
      ),
    [faqs]
  );
  const servicesJson = useMemo(
    () => JSON.stringify(services.filter((s) => s.name.trim())),
    [services]
  );
  const servicesOfferedSummary = useMemo(
    () => formatServicesForCompiler(services, servicesNotes),
    [services, servicesNotes]
  );
  const hoursScheduleJson = useMemo(
    () =>
      JSON.stringify({
        ...hoursSchedule,
        location: locationNotes.trim(),
      }),
    [hoursSchedule, locationNotes]
  );
  const businessHoursSummary = useMemo(
    () =>
      formatHoursForCompiler({
        ...hoursSchedule,
        location: locationNotes.trim(),
      }),
    [hoursSchedule, locationNotes]
  );

  useEffect(() => {
    if (state.ok) {
      setFlash(
        state.source === "gemini"
          ? "Training complete. Your receptionist will use this on the next call."
          : "Training saved (basic mode). Your receptionist will use this on the next call."
      );
    }
  }, [state]);

  function updateTeam(index: number, key: keyof TeamDirectoryEntry, value: string) {
    setTeam((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function updateFaq(index: number, key: keyof FaqEntry, value: string) {
    setFaqs((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function updateService(index: number, key: keyof ServiceItem, value: string) {
    setServices((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  const bulkPreview = useMemo(
    () => parseBulkServices(bulkServicesText),
    [bulkServicesText]
  );

  function addBlankServiceRows(count: number) {
    setServices((prev) => [
      ...prev,
      ...Array.from({ length: count }, () => emptyService()),
    ]);
  }

  function applyBulkServices() {
    const parsed = parseBulkServices(bulkServicesText);
    if (!parsed.length) {
      setBulkServicesError(
        "Add at least one service name. Example: Home cleaning - from 2,500 KES"
      );
      return;
    }
    setServices((prev) => {
      const existing = prev.filter((s) => s.name.trim());
      return [...existing, ...parsed];
    });
    setBulkServicesText("");
    setBulkServicesError(null);
    setShowBulkServices(false);
  }

  function setDayOpen(day: DayKey, open: boolean) {
    setHoursSchedule((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [day]: open ? { open: "08:00", close: "18:00" } : null,
      },
    }));
  }

  function setDayTime(day: DayKey, key: "open" | "close", value: string) {
    setHoursSchedule((prev) => {
      const current = prev.days[day] || { open: "08:00", close: "18:00" };
      return {
        ...prev,
        days: {
          ...prev.days,
          [day]: { ...current, [key]: value },
        },
      };
    });
  }

  return (
    <form action={formAction} className="space-y-10">
      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="business_name" value={businessName} />
      <input type="hidden" name="whatsapp_notification_number" value={ownerWhatsapp} />
      <input type="hidden" name="services_offered" value={servicesOfferedSummary} />
      <input type="hidden" name="services_catalog" value={servicesJson} />
      <input type="hidden" name="services_notes" value={servicesNotes} />
      <input type="hidden" name="business_hours" value={businessHoursSummary} />
      <input type="hidden" name="hours_schedule" value={hoursScheduleJson} />
      <input type="hidden" name="location_notes" value={locationNotes} />
      <input type="hidden" name="after_hours_mode" value={afterHoursMode} />
      <input type="hidden" name="agent_name" value={agentName} />
      <input type="hidden" name="agent_tone" value={tone} />
      <input type="hidden" name="unknown_answer_fallback" value={unknownFallback} />
      <input type="hidden" name="team_directory" value={teamJson} />
      <input type="hidden" name="faqs" value={faqsJson} />

      <section className="space-y-5">
        <div>
          <h2 className="font-display text-2xl tracking-tight text-[var(--ink)]">
            Persona &amp; Identity
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Give your digital employee a name and voice so callers hear a real receptionist.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="agent_name">
              Agent name
            </label>
            <input
              id="agent_name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Aisha"
              maxLength={40}
              className={fieldClass}
            />
            <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
              Live on every call: &quot;you&apos;ve reached {businessName.trim() || "your business"}, this is{" "}
              {agentName.trim() || "Receptionist"} speaking&quot;.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="business_name">
              Business name
            </label>
            <input
              id="business_name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium">Tone</p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            We rewrite the live call prompt from these fields. You never edit the raw AI prompt.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {TONE_OPTIONS.map((opt) => {
              const selected = tone === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTone(opt.id)}
                  className={[
                    "w-full text-left rounded-xl border px-4 py-3 transition duration-200",
                    selected
                      ? "border-[#0096FF] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_#0096FF]"
                      : "border-[var(--line)] bg-white hover:border-[#0096FF]/50",
                  ].join(" ")}
                >
                  <span className="font-medium text-[var(--ink)]">
                    {TONE_LABELS[opt.id]}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--ink-soft)]">
                    {opt.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="space-y-5 border-t border-[var(--line)] pt-8">
        <div>
          <label className="block text-sm font-medium" htmlFor="owner">
            Owner alert WhatsApp number
          </label>
          <input
            id="owner"
            value={ownerWhatsapp}
            onChange={(e) => setOwnerWhatsapp(e.target.value)}
            placeholder="+2547…"
            className={fieldClass}
          />
          <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
            Used for lead alerts once WhatsApp Business messaging is connected.
            Add teammate phones in Team Directory for escalation routing.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink)]">Services catalog</h3>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                Your menu for the receptionist. Add a few blank rows, or paste a list like you would on WhatsApp.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setServices((prev) => [...prev, emptyService()])}
                className="rounded-xl border border-[#0096FF]/40 px-3 py-2 text-sm font-medium text-[#0096FF] hover:bg-[var(--accent-soft)]"
              >
                Add 1
              </button>
              <button
                type="button"
                onClick={() => addBlankServiceRows(3)}
                className="rounded-xl border border-[#0096FF]/40 px-3 py-2 text-sm font-medium text-[#0096FF] hover:bg-[var(--accent-soft)]"
              >
                Add 3 blank
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowBulkServices((v) => !v);
                  setBulkServicesError(null);
                }}
                className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] hover:border-[#0096FF]/50"
              >
                {showBulkServices ? "Hide paste" : "Paste list"}
              </button>
            </div>
          </div>

          {showBulkServices ? (
            <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)]/40 p-4">
              <label className="block text-sm font-medium" htmlFor="bulk_services">
                Paste your service list
              </label>
              <p className="text-xs text-[var(--ink-soft)]">
                One service per line. Optional price after a dash.
              </p>
              <textarea
                id="bulk_services"
                value={bulkServicesText}
                onChange={(e) => {
                  setBulkServicesText(e.target.value);
                  if (bulkServicesError) setBulkServicesError(null);
                }}
                rows={6}
                placeholder={
                  "Home cleaning - from 2,500 KES\nPlumbing\nElectrical - quote after visit"
                }
                className={`${fieldClass} text-sm leading-relaxed`}
              />
              <details className="text-xs text-[var(--ink-soft)]">
                <summary className="cursor-pointer font-medium text-[var(--ink)]">
                  Spreadsheet format still works
                </summary>
                <p className="mt-2 leading-relaxed">
                  Paste columns as{" "}
                  <span className="font-medium text-[var(--ink)]">
                    name | price | notes | out of scope
                  </span>
                  , or copy rows from Excel / Sheets.
                </p>
              </details>

              {bulkPreview.length > 0 ? (
                <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-3">
                  <p className="text-xs font-medium text-[var(--ink)]">
                    Ready to add {bulkPreview.length} service
                    {bulkPreview.length === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-[var(--ink-soft)]">
                    {bulkPreview.slice(0, 8).map((row, i) => (
                      <li key={`${row.name}-${i}`}>
                        <span className="font-medium text-[var(--ink)]">{row.name}</span>
                        {row.price_range ? ` · ${row.price_range}` : ""}
                      </li>
                    ))}
                    {bulkPreview.length > 8 ? (
                      <li>+{bulkPreview.length - 8} more</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {bulkServicesError ? (
                <p className="text-sm text-[var(--warn)]" role="alert">
                  {bulkServicesError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={applyBulkServices}
                disabled={!bulkPreview.length}
                className="rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-50"
              >
                Add to catalog
              </button>
            </div>
          ) : null}

          <div className="space-y-4">
            {services.map((service, index) => (
              <div
                key={`service-${index}`}
                className="space-y-3 rounded-xl border border-[var(--line)] bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                    Service {index + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setServices((prev) =>
                        prev.length <= 1 ? [emptyService()] : prev.filter((_, i) => i !== index)
                      )
                    }
                    className="text-sm text-[var(--ink-soft)] hover:text-[var(--warn)]"
                    aria-label={`Remove service ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`svc-name-${index}`}>
                      Service name
                    </label>
                    <input
                      id={`svc-name-${index}`}
                      value={service.name}
                      onChange={(e) => updateService(index, "name", e.target.value)}
                      placeholder="Home cleaning"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`svc-price-${index}`}>
                      Price range
                    </label>
                    <input
                      id={`svc-price-${index}`}
                      value={service.price_range}
                      onChange={(e) => updateService(index, "price_range", e.target.value)}
                      placeholder="from 2,500 KES"
                      className={fieldClass}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`svc-notes-${index}`}>
                      Notes / requirements
                    </label>
                    <input
                      id={`svc-notes-${index}`}
                      value={service.notes}
                      onChange={(e) => updateService(index, "notes", e.target.value)}
                      placeholder="2-bedroom homes, Nairobi only"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`svc-oos-${index}`}>
                      Out of scope
                    </label>
                    <input
                      id={`svc-oos-${index}`}
                      value={service.out_of_scope}
                      onChange={(e) => updateService(index, "out_of_scope", e.target.value)}
                      placeholder="No commercial offices"
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="services_notes">
              Additional service notes (optional)
            </label>
            <textarea
              id="services_notes"
              value={servicesNotes}
              onChange={(e) => setServicesNotes(e.target.value)}
              rows={3}
              placeholder="Payment, deposits, or other details that do not fit a single service row…"
              className={`${fieldClass} leading-relaxed`}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink)]">Weekly hours (EAT)</h3>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Used live on every call so the receptionist knows if you are open or closed.
            </p>
          </div>
          <div className="space-y-2">
            {DAY_ORDER.map((day) => {
              const slot = hoursSchedule.days[day];
              const open = Boolean(slot);
              return (
                <div
                  key={day}
                  className="grid grid-cols-[7rem_auto_1fr] items-center gap-3 sm:grid-cols-[8.5rem_auto_1fr_1fr]"
                >
                  <span className="text-sm font-medium text-[var(--ink)]">
                    {DAY_LABELS[day]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDayOpen(day, !open)}
                    className={[
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                      open
                        ? "border-[#0096FF] bg-[var(--accent-soft)] text-[#0096FF]"
                        : "border-[var(--line)] text-[var(--ink-soft)]",
                    ].join(" ")}
                  >
                    {open ? "Open" : "Closed"}
                  </button>
                  {open && slot ? (
                    <div className="col-span-1 flex flex-wrap items-center gap-2 sm:col-span-2">
                      <label className="sr-only" htmlFor={`open-${day}`}>
                        Opens
                      </label>
                      <input
                        id={`open-${day}`}
                        type="time"
                        value={slot.open}
                        onChange={(e) => setDayTime(day, "open", e.target.value)}
                        className="rounded-lg border border-[var(--line)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#0096FF]"
                      />
                      <span className="text-xs text-[var(--ink-soft)]">to</span>
                      <label className="sr-only" htmlFor={`close-${day}`}>
                        Closes
                      </label>
                      <input
                        id={`close-${day}`}
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="rounded-lg border border-[var(--line)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#0096FF]"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--ink-soft)] sm:col-span-2">
                      Closed all day
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="location_notes">
              Location &amp; coverage
            </label>
            <textarea
              id="location_notes"
              value={locationNotes}
              onChange={(e) => setLocationNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Westlands, Nairobi. We cover Kiambu and Ruiru."
              className={`${fieldClass} leading-relaxed`}
            />
          </div>

          <div>
            <p className="block text-sm font-medium">When you are closed</p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Controls how the receptionist handles after-hours callers.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {AFTER_HOURS_OPTIONS.map((opt) => {
                const selected = afterHoursMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAfterHoursMode(opt.id)}
                    className={[
                      "w-full text-left rounded-xl border px-4 py-3 transition duration-200",
                      selected
                        ? "border-[#0096FF] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_#0096FF]"
                        : "border-[var(--line)] bg-white hover:border-[#0096FF]/50",
                    ].join(" ")}
                  >
                    <span className="font-medium text-[var(--ink)]">{opt.label}</span>
                    <span className="mt-1 block text-sm text-[var(--ink-soft)]">
                      {opt.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="unknown_answer_fallback">
            If a customer asks for something you don&apos;t offer, what should the receptionist
            say?
          </label>
          <textarea
            id="unknown_answer_fallback"
            value={unknownFallback}
            onChange={(e) => setUnknownFallback(e.target.value)}
            rows={2}
            placeholder={'e.g. "Let me note that down. The boss will call you back today to confirm."'}
            className={`${fieldClass} leading-relaxed`}
          />
          <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
            Optional. Without it, the receptionist says the team will follow up.
          </p>
        </div>
      </section>

      <section className="space-y-4 border-t border-[var(--line)] pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl tracking-tight text-[var(--ink)]">
              Team Directory
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              People the AI can escalate to. Their Phone / WhatsApp is the plug-and-play
              destination when Business messaging is connected. Tip: use role{" "}
              <span className="font-medium text-[var(--ink)]">General queries</span> as
              the catch-all when someone asks for a role you have not listed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTeam((prev) => [...prev, emptyMember()])}
            className="rounded-xl border border-[#0096FF]/40 px-3 py-2 text-sm font-medium text-[#0096FF] hover:bg-[var(--accent-soft)]"
          >
            Add teammate
          </button>
        </div>

        <div className="space-y-4">
          {team.map((member, index) => (
            <div
              key={`team-${index}`}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
            >
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-name-${index}`}>
                  Name
                </label>
                <input
                  id={`team-name-${index}`}
                  value={member.name}
                  onChange={(e) => updateTeam(index, "name", e.target.value)}
                  placeholder="Jane Doe"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-role-${index}`}>
                  Role
                </label>
                <input
                  id={`team-role-${index}`}
                  value={member.role}
                  onChange={(e) => updateTeam(index, "role", e.target.value)}
                  placeholder="General queries"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-phone-${index}`}>
                  Phone / WhatsApp
                </label>
                <input
                  id={`team-phone-${index}`}
                  value={member.phone}
                  onChange={(e) => updateTeam(index, "phone", e.target.value)}
                  placeholder="+2547…"
                  className={fieldClass}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setTeam((prev) =>
                    prev.length <= 1 ? [emptyMember()] : prev.filter((_, i) => i !== index)
                  )
                }
                className="mb-0.5 h-[46px] rounded-xl px-3 text-sm text-[var(--ink-soft)] hover:text-[var(--warn)]"
                aria-label={`Remove teammate ${index + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 border-t border-[var(--line)] pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl tracking-tight text-[var(--ink)]">
              Golden FAQs
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Loaded live on every call. The receptionist must answer these exactly when asked.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFaqs((prev) => [...prev, emptyFaq()])}
            className="rounded-xl border border-[#0096FF]/40 px-3 py-2 text-sm font-medium text-[#0096FF] hover:bg-[var(--accent-soft)]"
          >
            Add FAQ
          </button>
        </div>

        <div className="space-y-5">
          {faqs.map((faq, index) => (
            <div key={`faq-${index}`} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                  FAQ {index + 1}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setFaqs((prev) =>
                      prev.length <= 1 ? [emptyFaq()] : prev.filter((_, i) => i !== index)
                    )
                  }
                  className="text-sm text-[var(--ink-soft)] hover:text-[var(--warn)]"
                  aria-label={`Remove FAQ ${index + 1}`}
                >
                  Remove
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`faq-q-${index}`}>
                  Question
                </label>
                <input
                  id={`faq-q-${index}`}
                  value={faq.question}
                  onChange={(e) => updateFaq(index, "question", e.target.value)}
                  placeholder="Do you have parking?"
                  className={fieldClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`faq-a-${index}`}>
                  Answer
                </label>
                <textarea
                  id={`faq-a-${index}`}
                  value={faq.answer}
                  onChange={(e) => updateFaq(index, "answer", e.target.value)}
                  rows={2}
                  placeholder="Yes, free parking behind the building."
                  className={`${fieldClass} leading-relaxed`}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-[var(--line)] pt-6">
        <button
          type="submit"
          disabled={pending || !tone}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0096FF] px-5 py-3 text-white font-medium hover:bg-[var(--accent-deep)] disabled:opacity-60"
        >
          {pending ? (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
              Training your receptionist (usually under 15 seconds)…
            </>
          ) : (
            "Save & train receptionist"
          )}
        </button>

        {state.error ? (
          <p className="mt-3 text-sm text-[var(--warn)]" role="alert">
            {state.error}
          </p>
        ) : null}
        {flash && !state.error ? (
          <p className="mt-3 text-sm text-[var(--ok)]">{flash}</p>
        ) : null}
      </div>
    </form>
  );
}
