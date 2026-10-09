import { notFound } from "next/navigation";
import { DevQualityChrome } from "./chrome";

/** Dev Quality shares the Super Admin shell. DASHBOARD_OPEN=true only. */
export default function DevQualityLayout({ children }: { children: React.ReactNode }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return <DevQualityChrome>{children}</DevQualityChrome>;
}
