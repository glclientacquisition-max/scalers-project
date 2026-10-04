import { Suspense } from "react";
import { Sora } from "next/font/google";
import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { LandingPage } from "@/components/marketing/LandingPage";
import { loadPublicPackageOffers } from "@/lib/packageCatalog";

/* Display face ships on marketing only. The app runs on the system stack. */
const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export default function Home() {
  return (
    <div className={`${display.variable} contents`}>
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
  const board = await loadPublicPackageOffers();
  return <LandingPage board={board} signedIn={Boolean(user)} />;
}
