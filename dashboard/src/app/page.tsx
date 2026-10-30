import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { LandingPage } from "@/components/marketing/LandingPage";
import { marketingFontClass } from "@/app/marketingFonts";

export default function Home() {
  return (
    <div className={`${marketingFontClass} contents`}>
      <Suspense fallback={<LandingPage signedIn={false} />}>
        <HomeGate />
      </Suspense>
    </div>
  );
}

async function HomeGate() {
  const [user, legacy] = await Promise.all([
    getAuthUser(),
    isLegacyAuthenticated(),
  ]);
  if (legacy && !user) redirect("/admin");
  return <LandingPage signedIn={Boolean(user)} />;
}
