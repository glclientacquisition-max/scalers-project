import { notFound } from "next/navigation";
import { MotionCatalog } from "./MotionCatalog";

export default function DevMotionPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return <MotionCatalog />;
}
