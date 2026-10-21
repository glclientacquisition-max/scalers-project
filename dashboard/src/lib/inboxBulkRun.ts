import "server-only";

/**
 * Server half of the inbox bulk action: one UPDATE … WHERE id IN (…) AND
 * tenant_id = … per call, plus the caller texts the single-row Confirm and
 * Done actions send. Injectable client so tests can count round trips.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderDeskCallerText } from "@/lib/callerSms";
import type { CallerTemplateKind } from "@/lib/messageTemplates";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import { inboxBulkWrite, type InboxBulkKind } from "@/lib/inboxBulk";

export type InboxBulkRow = Record<string, unknown> & { id: string };

export async function runInboxBulkUpdate(opts: {
  client: SupabaseClient;
  tenantId: string;
  kind: InboxBulkKind;
  ids: string[];
  now?: Date;
}): Promise<{ rows: InboxBulkRow[]; error: { message: string } | null }> {
  const write = inboxBulkWrite(opts.kind);
  const patch: Record<string, string> = { [write.column]: write.value };
  if (write.touchUpdatedAt) patch.updated_at = (opts.now ?? new Date()).toISOString();
  const { data, error } = await opts.client
    .from(write.table)
    .update(patch)
    .in("id", opts.ids)
    .eq("tenant_id", opts.tenantId)
    .select(write.select);
  if (error) return { rows: [], error: { message: error.message } };
  const rows = (Array.isArray(data) ? data : []) as unknown as InboxBulkRow[];
  return { rows, error: null };
}

export type InboxBulkCallerText = {
  kind: CallerTemplateKind;
  to: string;
  body: string;
  callId: string | null;
};

/**
 * The caller texts the single-row actions would have sent for these rows:
 * Confirm -> "appointment confirmed", hold Done -> "hold ready" (hold/order
 * requests only). Only when the business has caller texts on.
 */
export function inboxBulkCallerTexts(opts: {
  kind: InboxBulkKind;
  rows: InboxBulkRow[];
  tenant: { business_name: string; notify_channels?: unknown };
}): InboxBulkCallerText[] {
  if (opts.kind !== "confirm" && opts.kind !== "done") return [];
  const prefs = parseNotifyChannels(opts.tenant.notify_channels);
  if (!prefs.caller_sms) return [];
  const out: InboxBulkCallerText[] = [];
  for (const row of opts.rows) {
    const to = String(row.caller_phone || "").trim();
    if (!to) continue;
    const callId = row.call_id ? String(row.call_id) : null;
    if (opts.kind === "confirm") {
      const kind: CallerTemplateKind = "caller_appointment_confirmed";
      out.push({
        kind,
        to,
        callId,
        body: renderDeskCallerText({
          kind,
          businessName: opts.tenant.business_name,
          callerName: row.caller_name as string | null,
          service: row.service_name as string | null,
          when: row.when_text as string | null,
        }),
      });
    } else {
      const type = String(row.request_type || "").toLowerCase();
      if (type !== "hold" && type !== "order") continue;
      const kind: CallerTemplateKind = "caller_hold_ready";
      out.push({
        kind,
        to,
        callId,
        body: renderDeskCallerText({
          kind,
          businessName: opts.tenant.business_name,
          callerName: row.caller_name as string | null,
          service: row.item as string | null,
        }),
      });
    }
  }
  return out;
}
