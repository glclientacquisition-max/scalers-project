import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
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
    logAdminError("voices-list", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "upsert").trim();
  const actor = await adminActorName();
  const voiceBefore = async (id: string) =>
    (await listPlatformSonioxVoicesAdmin().catch(() => [])).find((v) => v.id === id) ?? null;

  try {
    if (action === "upsert") {
      const before = body.id ? await voiceBefore(String(body.id)) : null;
      const voice = await upsertPlatformSonioxVoice({
        id: body.id,
        description: body.description,
        is_default: Boolean(body.is_default),
        is_active: body.is_active !== false,
        sort_order: body.sort_order,
      });
      await recordAdminAction({ actor, action: "save_voice", before, after: voice });
      return NextResponse.json({ ok: true, voice });
    }

    if (action === "set_default") {
      const id = String(body.id || "").trim();
      if (!isSonioxVoiceUuid(id)) {
        return NextResponse.json({ error: "Invalid voice id" }, { status: 400 });
      }
      const before = await voiceBefore(id);
      await setPlatformSonioxVoiceDefault(id);
      await recordAdminAction({ actor, action: "set_default_voice", before, after: { id, is_default: true } });
      return NextResponse.json({ ok: true });
    }

    if (action === "set_active") {
      const id = String(body.id || "").trim();
      if (!isSonioxVoiceUuid(id)) {
        return NextResponse.json({ error: "Invalid voice id" }, { status: 400 });
      }
      const before = await voiceBefore(id);
      await setPlatformSonioxVoiceActive(id, Boolean(body.is_active));
      await recordAdminAction({ actor, action: "set_voice_active", before, after: { id, is_active: Boolean(body.is_active) } });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!isSonioxVoiceUuid(id)) {
        return NextResponse.json({ error: "Invalid voice id" }, { status: 400 });
      }
      const before = await voiceBefore(id);
      await deletePlatformSonioxVoice(id);
      await recordAdminAction({ actor, action: "delete_voice", before, after: null });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    logAdminError("voices", err);
    const message = err instanceof Error ? err.message : "";
    const error = /Voice id must be a .* UUID/i.test(message)
      ? "Voice id is not valid."
      : adminFacingError(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
