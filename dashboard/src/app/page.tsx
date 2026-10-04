import { Suspense } from "react";
import { DM_Sans, Sora } from "next/font/google";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

/* Marketing only. The desk stays on the system stack. */
const display = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const landingBody = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-landing",
  display: "swap",
});

export default function Home() {
  return (
    <div className={`${display.variable} ${landingBody.variable} landing-root min-h-dvh`}>
      <Suspense fallback={<LandingPage />}>
        <HomeGate />
      </Suspense>
    </div>
  );
}

async function HomeGate() {
  const [user, legacy] = await Promise.all([getAuthUser(), isLegacyAuthenticated()]);
  if (user) redirect("/home");
  if (legacy) redirect("/admin");
  return <LandingPage />;
}
