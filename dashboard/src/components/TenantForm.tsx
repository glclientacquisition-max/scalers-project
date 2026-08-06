"use client";

import { useState } from "react";
import type { TenantRow } from "@/lib/supabase";

export function TenantForm({ tenant }: { tenant: TenantRow }) {
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [prompt, setPrompt] = useState(tenant.llm_system_prompt || "");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: tenant.id,
          business_name: businessName,
          whatsapp_notification_number: ownerWhatsapp,
          llm_system_prompt: prompt,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setStatus("Saved. New calls will use this knowledge.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
        <label className="block text-sm font-medium" htmlFor="prompt">
          Receptionist knowledge / system prompt
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={14}
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-mono text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
        />
        <p className="mt-2 text-xs text-[var(--ink-soft)]">
          Loaded into Gemini on each call. Keep services, hours, and area accurate.
          Language is automatic: English, Kiswahili, and Sheng.
        </p>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-[var(--accent)] px-5 py-3 text-white font-medium hover:bg-[var(--accent-deep)] disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save business"}
      </button>
      {status ? <p className="text-sm text-[var(--ink-soft)]">{status}</p> : null}
    </form>
  );
}
