import { NextResponse } from "next/server";
import { listCuratedSonioxVoices } from "@/lib/sonioxVoiceCatalog";

/** Curated Soniox receptionist voices (Option A allowlist). */
export async function GET() {
  return NextResponse.json({ voices: listCuratedSonioxVoices() });
}
