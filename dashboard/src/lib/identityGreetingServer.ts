import { createWorkspaceDataClient } from "@/lib/tenant";
import { greetingLanguagePickFromStored, greetingLanguageForStorage } from "@/lib/identityGreeting";

export type GreetingLanguageRow = {
  greeting_language: "en" | "sw" | null;
  greeting_text: string | null;
};

/**
 * Identity › How you answer: the business's default greeting language and the
 * owner's full greeting (Voice says greeting_text word for word; Desk only reads it).
 * Owner session, RLS. Off the shared tenant select so a database without the
 * columns keeps every other Settings page loading: then both read as null.
 */
export async function readGreetingLanguage(tenantId: string): Promise<GreetingLanguageRow> {
  const empty: GreetingLanguageRow = { greeting_language: null, greeting_text: null };
  const ws = await createWorkspaceDataClient();
  if (!ws) return empty;
  const { data, error } = await ws.client
    .from("tenants")
    .select("greeting_language, greeting_text")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return empty;
  const row = data as { greeting_language?: unknown; greeting_text?: unknown };
  return {
    greeting_language: greetingLanguageForStorage(greetingLanguagePickFromStored(row.greeting_language)),
    greeting_text: typeof row.greeting_text === "string" && row.greeting_text.trim() ? row.greeting_text : null,
  };
}
