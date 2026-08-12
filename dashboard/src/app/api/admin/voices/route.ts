import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
  deletePlatformSonioxVoice,
  isSonioxVoiceUuid,
  listPlatformSonioxVoicesAdmin,
  setPlatformSonioxVoiceActive,
  setPlatformSonioxVoiceDefault,
  upsertPlatformSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const voices = await listPlatformSonioxVoicesAdmin();
    return NextResponse.json({ voices });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list voices" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "upsert").trim();

  try {
    if (action === "upsert") {
      const voice = await upsertPlatformSonioxVoice({
        id: body.id,
        description: body.description,
        is_default: Boolean(body.is_default),
        is_active: body.is_active !== false,
        sort_order: body.sort_order,
      });
      return NextResponse.json({ ok: true, voice });
    }

    if (action === "set_default") {
      const id = String(body.id || "").trim();
      if (!isSonioxVoiceUuid(id)) {
        return NextResponse.json({ error: "Invalid voice id" }, { status: 400 });
      }
      await setPlatformSonioxVoiceDefault(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "set_active") {
      const id = String(body.id || "").trim();
      if (!isSonioxVoiceUuid(id)) {
        return NextResponse.json({ error: "Invalid voice id" }, { status: 400 });
      }
      await setPlatformSonioxVoiceActive(id, Boolean(body.is_active));
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!isSonioxVoiceUuid(id)) {
        return NextResponse.json({ error: "Invalid voice id" }, { status: 400 });
      }
      await deletePlatformSonioxVoice(id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    if (/platform_soniox_voices|relation|column/i.test(message)) {
      return NextResponse.json(
        {
          error: `${message} Apply docs/supabase/soniox_voice_id.sql in Supabase.`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
