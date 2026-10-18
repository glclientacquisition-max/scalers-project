import { notFound } from "next/navigation";
import { LinePausedFixture } from "../fixture";

/** Desk after a send was refused because the line is paused. DASHBOARD_OPEN=true only. */
export default function DevLinePausedBlockedPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return <LinePausedFixture blocked />;
}
