import { notFound } from "next/navigation";
import { PronunciationStudioPreview } from "@/components/PronunciationStudioPreview";

/**
 * Local-only UI harness for Pronunciation studio (no desk login).
 * Enabled only when DASHBOARD_OPEN=true.
 */
export default function DevPronunciationPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return <PronunciationStudioPreview />;
}
