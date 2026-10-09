/**
 * tenants columns behind every fact path in fieldPathRegistry (the columns
 * factValueForPath reads). readSavedFactRow selects exactly these, so a
 * "Looks right" or changed-only confirm can hash any registered path.
 * tests/factConfirmSave.test.js asserts the registry is a subset of this list.
 */
export const FACT_ROW_COLUMN_LIST = [
  "business_name",
  "vertical",
  "sautikit_virtual_number",
  "spoken_name",
  "voice_languages",
  "social_handles",
  "hours_schedule",
  "business_locations",
  "business_policies",
  "whatsapp_notification_number",
  "alert_email",
  "notify_channels",
  "agent_name",
  "agent_tone",
  "agent_tools",
  "daily_bulletin",
  "faqs",
  "services_catalog",
  "product_catalog",
] as const;

export const FACT_ROW_COLUMNS = FACT_ROW_COLUMN_LIST.join(", ");

/** Fallback when an older database lacks an optional column (Postgres 42703). */
export const FACT_ROW_CORE_COLUMNS = [
  "business_name",
  "vertical",
  "spoken_name",
  "social_handles",
  "hours_schedule",
  "business_locations",
  "business_policies",
  "agent_name",
  "agent_tone",
  "agent_tools",
  "faqs",
  "services_catalog",
  "product_catalog",
].join(", ");
