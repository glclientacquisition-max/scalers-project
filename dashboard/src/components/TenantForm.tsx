"use client";

import { useActionState, useEffect, useState } from "react";
import type { TenantRow } from "@/lib/supabase";
import type { OnboardingTone } from "@/lib/onboarding";
import { TONE_LABELS } from "@/lib/onboarding";
import {
  saveAndCompileSettings,
  type SettingsCompileState,
} from "@/app/(desk)/settings/actions";

const TONE_OPTIONS: { id: OnboardingTone; blurb: string }[] = [
  {
    id: "professional",
    blurb: "Calm, clear, and polished — best for clinics, offices, and formal brands.",
  },
  {
    id: "friendly",
    blurb: "Warm and helpful — like a receptionist people enjoy talking to.",
  },
  {
    id: "localized",
    blurb: "Natural Kenyan voice — light Sheng when the caller uses it.",
  },
];

function initialTone(tenant: TenantRow): OnboardingTone | "" {
  const t = String(tenant.agent_tone || "").toLowerCase();
  if (t === "professional" || t === "friendly" || t === "localized") return t;
  return "";
}

const initial: SettingsCompileState = {};

export function TenantForm({ tenant }: { tenant: TenantRow }) {
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [servicesOffered, setServicesOffered] = useState(tenant.services_offered || "");
  const [businessHours, setBusinessHours] = useState(tenant.business_hours || "");
  const [tone, setTone] = useState<OnboardingTone | "">(initialTone(tenant));
  const [state, formAction, pending] = useActionState(saveAndCompileSettings, initial);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) {
      setFlash(
        state.source === "gemini"
          ? "Saved. Your receptionist knowledge was rewritten for new calls."
          : "Saved with a local template (Gemini unavailable). New calls will use this knowledge."
      );
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="business_name" value={businessName} />
      <input type="hidden" name="whatsapp_notification_number" value={ownerWhatsapp} />
      <input type="hidden" name="services_offered" value={servicesOffered} />
      <input type="hidden" name="business_hours" value={businessHours} />
      <input type="hidden" name="agent_tone" value={tone} />

      <div>
        <label className="block text-sm font-medium" htmlFor="business_name">
          Business name
        </label>
        <input
          id="business_name"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="owner">
          Owner alert number (WhatsApp later / reference)
        </label>
        <input
          id="owner"
          value={ownerWhatsapp}
          onChange={(e) => setOwnerWhatsapp(e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="services_offered">
          Services & pricing
        </label>
        <textarea
          id="services_offered"
          value={servicesOffered}
          onChange={(e) => setServicesOffered(e.target.value)}
          rows={6}
          placeholder="What you offer and how pricing works…"
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)] leading-relaxed"
        />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="business_hours">
          Business hours & location
        </label>
        <textarea
          id="business_hours"
          value={businessHours}
          onChange={(e) => setBusinessHours(e.target.value)}
          rows={5}
          placeholder="Open hours and areas you cover…"
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)] leading-relaxed"
        />
      </div>

      <div>
        <p className="block text-sm font-medium">Tone of voice</p>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          We rewrite the live call prompt from these fields — you never edit the raw AI prompt.
        </p>
        <div className="mt-3 space-y-3">
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
                    ? "border-[var(--accent)] bg-[#e8f4f1] shadow-[inset_0_0_0_1px_var(--accent)]"
                    : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
                ].join(" ")}
              >
                <span className="font-medium text-[var(--ink)]">{TONE_LABELS[opt.id]}</span>
                <span className="mt-1 block text-sm text-[var(--ink-soft)]">{opt.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={pending || !tone}
        className="rounded-xl bg-[var(--accent)] px-5 py-3 text-white font-medium hover:bg-[var(--accent-deep)] disabled:opacity-60"
      >
        {pending ? "Saving & compiling…" : "Save & update receptionist"}
      </button>

      {state.error ? (
        <p className="text-sm text-[var(--warn)]" role="alert">
          {state.error}
        </p>
      ) : null}
      {flash && !state.error ? (
        <p className="text-sm text-[var(--ok)]">{flash}</p>
      ) : null}
    </form>
  );
}
