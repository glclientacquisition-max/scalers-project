"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { FaqEntry, TeamDirectoryEntry, TenantRow } from "@/lib/supabase";
import type { OnboardingTone } from "@/lib/onboarding";
import { TONE_LABELS } from "@/lib/onboarding";
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

const initial: SettingsCompileState = {};

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[#0096FF]";

export function TenantForm({ tenant }: { tenant: TenantRow }) {
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [servicesOffered, setServicesOffered] = useState(tenant.services_offered || "");
  const [businessHours, setBusinessHours] = useState(tenant.business_hours || "");
  const [unknownFallback, setUnknownFallback] = useState(
    tenant.unknown_answer_fallback || ""
  );
  const [agentName, setAgentName] = useState(tenant.agent_name || "Receptionist");
  const [tone, setTone] = useState<OnboardingTone | "">(initialTone(tenant));
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

  return (
    <form action={formAction} className="space-y-10">
      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="business_name" value={businessName} />
      <input type="hidden" name="whatsapp_notification_number" value={ownerWhatsapp} />
      <input type="hidden" name="services_offered" value={servicesOffered} />
      <input type="hidden" name="business_hours" value={businessHours} />
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
              Used in the greeting: &quot;this is {agentName.trim() || "Receptionist"} speaking&quot;.
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
            Owner alert number (WhatsApp later / reference)
          </label>
          <input
            id="owner"
            value={ownerWhatsapp}
            onChange={(e) => setOwnerWhatsapp(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="services_offered">
            Services &amp; pricing
          </label>
          <textarea
            id="services_offered"
            value={servicesOffered}
            onChange={(e) => setServicesOffered(e.target.value)}
            rows={6}
            placeholder="What you offer and how pricing works…"
            className={`${fieldClass} leading-relaxed`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="business_hours">
            Business hours &amp; location
          </label>
          <textarea
            id="business_hours"
            value={businessHours}
            onChange={(e) => setBusinessHours(e.target.value)}
            rows={5}
            placeholder="Open hours and areas you cover…"
            className={`${fieldClass} leading-relaxed`}
          />
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
              People the AI can promise a callback from when a caller needs a human.
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
                  placeholder="Billing & Refunds"
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
              Short answers the receptionist should treat as ground truth.
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
