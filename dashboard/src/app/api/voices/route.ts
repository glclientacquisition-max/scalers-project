import { NextResponse } from "next/server";
import { listCuratedSonioxVoices } from "@/lib/sonioxVoiceCatalog";

/** Curated Soniox receptionist voices (DB allowlist; JSON fallback). */
export async function GET() {
  const voices = await listCuratedSonioxVoices();
  return NextResponse.json({ voices });
}
