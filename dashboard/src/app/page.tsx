import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { LandingPage } from "@/components/marketing/LandingPage";

export default function Home() {
  return (
    <Suspense fallback={<LandingPage />}>
      <HomeGate />
    </Suspense>
  );
}

async function HomeGate() {
  const [user, legacy] = await Promise.all([
    getAuthUser(),
    isLegacyAuthenticated(),
  ]);
  if (user) redirect("/home");
  if (legacy) redirect("/admin");
  return <LandingPage />;
}
