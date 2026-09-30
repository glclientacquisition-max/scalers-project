import { notFound } from "next/navigation";
import { KitShowcase } from "./KitShowcase";

/**
 * Primitive kit fixture. DASHBOARD_OPEN=true only.
 * Every primitive from the Frontend 2.0 charter renders once, in light and dark, at every width.
 */
export default function DevKitPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  return <KitShowcase />;
}
