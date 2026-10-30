import { notFound } from "next/navigation";
import { LandingPage } from "@/components/marketing/LandingPage";
import { marketingFontClass } from "@/app/marketingFonts";

/** Local landing harness (signed out, no auth redirect). DASHBOARD_OPEN=true only. */
export default function DevLanding() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <div className={`${marketingFontClass} contents`}>
      <LandingPage signedIn={false} />
    </div>
  );
}
