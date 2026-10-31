import { expect, test } from "@playwright/test";

const PANELS = ["hours", "locations", "faqs", "tools", "team", "pronunciation"] as const;

test("each train panel posts only its fields and Save starts disabled", async ({ page }) => {
  for (const panel of PANELS) {
    await page.goto(`/dev/settings-jobs?tab=train&panel=${panel}`, { waitUntil: "networkidle" });
    const names = await page.locator("#tenant-settings-form input[name]").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).name)
    );
    expect(names, panel).toContain("settings_scope");
    expect(names, panel).toContain("id");
    if (panel === "hours") {
      expect(names).toContain("hours_schedule");
      for (const banned of ["faqs", "business_locations", "team_directory", "tool_escalate", "tts_lexicon", "business_policies"]) {
        expect(names, banned).not.toContain(banned);
      }
    }
    if (panel === "faqs") expect(names).not.toContain("hours_schedule");
    if (panel === "locations") expect(names).toContain("business_locations");
    if (panel === "tools") expect(names).toContain("tool_escalate");
    if (panel === "team") expect(names).toContain("team_directory");
    if (panel === "pronunciation") expect(names).toContain("tts_lexicon");
    const save = page.locator("[data-settings-action-bar] button[data-settings-save]");
    await expect(save).toBeDisabled();
  }
});
