import { getSupabaseAdmin, type TenantRow } from "@/lib/supabase";
import { TenantForm } from "@/components/TenantForm";

export default async function SettingsPage() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active"
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load business: {error.message}
      </div>
    );
  }

  if (!data) {
    return <p className="text-[var(--ink-soft)]">No active tenant found in Supabase.</p>;
  }

  const tenant = data as TenantRow;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl tracking-tight">Business</h1>
      <p className="mt-2 text-[var(--ink-soft)]">
        Update how the phone receptionist introduces itself and what it knows.
      </p>

      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <p className="text-sm text-[var(--ink-soft)]">
          DID{" "}
          <span className="font-medium text-[var(--ink)]">{tenant.sautikit_virtual_number}</span>
        </p>
        <div className="mt-6">
          <TenantForm tenant={tenant} />
        </div>
      </div>
    </div>
  );
}
