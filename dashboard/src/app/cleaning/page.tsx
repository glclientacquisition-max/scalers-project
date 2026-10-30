import type { Metadata } from "next";
import { Suspense } from "react";
import { getAuthUser } from "@/lib/auth";
import { LandingPage } from "@/components/marketing/LandingPage";
import { CLEANING_COPY } from "@/components/marketing/landingCopy";
import { marketingFontClass } from "@/app/marketingFonts";

export const metadata: Metadata = {
  title: "Scalers for cleaning businesses",
  description: "Never miss a cleaning job. Your Business Assistant answers your calls when you're mid-clean, closed, or on another call.",
};

/** Cleaning trade page: the home skeleton with cleaning words. For cleaning ads and referrals. */
export default function CleaningPage() {
  return (
    <div className={`${marketingFontClass} contents`}>
      <Suspense fallback={<LandingPage signedIn={false} copy={CLEANING_COPY} />}>
        <CleaningGate />
      </Suspense>
    </div>
  );
}

async function CleaningGate() {
  const user = await getAuthUser();
  return <LandingPage signedIn={Boolean(user)} copy={CLEANING_COPY} />;
}
