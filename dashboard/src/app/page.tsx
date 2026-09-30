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
      <Suspense fallback={<LandingPage />}>
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
  if (user) redirect("/home");
  if (legacy) redirect("/admin");
  const board = await loadPublicPackageOffers();
  return <LandingPage board={board} />;
}
