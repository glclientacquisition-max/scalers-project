import { sortWorstFirst, VOICE_CHECKS, type BusinessQualityRow, type QualityRange } from "@/lib/adminQualityModel";
import { fixtureRows } from "../quality/fixtures";

const NAMES = [
  "Mama Pima Salon", "Kilele Hardware", "Nyota Dental", "Baraka Movers", "Upendo Pharmacy", "Jua Kali Motors",
  "Tamu Bakery", "Safari Clean", "Pwani Fish Supply", "Mvua Plumbing", "Neema Clinic", "Shamba Fresh",
  "Kazi Print", "Zuri Tailors", "Simba Security", "Rafiki Vets", "Mto Laundry", "Bidii Tutors",
  "Amani Guest House", "Duka la Nuru", "Mawingu Travel", "Kipepeo Florist",
];

/** Real fixture businesses (they open a pane) plus a realistic-size tail. */
export function adminQualityRows(range: QualityRange): BusinessQualityRow[] {
  const tail: BusinessQualityRow[] = NAMES.map((name, i) => {
    const score = 52 + ((i * 37) % 47);
    return {
      businessId: `biz-q${i}`,
      name,
      score,
      trend: [score + 6 - (i % 5), score + 3, score - 2 + (i % 4), score + 1, score],
      topFailure: score > 88 ? null : VOICE_CHECKS[i % VOICE_CHECKS.length],
      checksLogged: true,
      dropping: i % 7 === 3,
      droppingReason: i % 7 === 3 ? "Score fell 9 points versus the prior 7 days." : "",
      callsTraced: 3 + ((i * 5) % 19),
      lastCallAt: new Date(Date.parse("2026-10-06T12:00:00.000Z") - i * 5_400_000).toISOString(),
    };
  });
  return sortWorstFirst([...fixtureRows(range), ...(range === "30d" ? tail : tail.slice(0, 16))]);
}
