import { notFound } from "next/navigation";
import { FinishingScreen } from "@/app/onboarding/SetupFlow";

export default function DevFinishingPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return <FinishingScreen />;
}
