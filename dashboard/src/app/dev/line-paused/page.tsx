import { notFound } from "next/navigation";
import { LinePausedFixture } from "./fixture";

/** Desk with the paused-line banner. DASHBOARD_OPEN=true only. */
export default function DevLinePausedPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return <LinePausedFixture blocked={false} />;
}
