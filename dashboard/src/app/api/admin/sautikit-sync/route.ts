import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { syncPoolFromSautikit } from "@/lib/didPool";
import {
  getSautikitKeyDiagnostics,
  isSautikitConfigured,
} from "@/lib/sautikit";

export async function POST() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  if (!isSautikitConfigured()) {
    return NextResponse.json(
      {
        error: "SAUTIKIT_API_KEY is not set on the dashboard server.",
        diagnostics: getSautikitKeyDiagnostics(),
      },
      { status: 500 }
    );
  }

  try {
    const result = await syncPoolFromSautikit();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    return NextResponse.json(
      {
        error: message,
        code: code || null,
        diagnostics: getSautikitKeyDiagnostics(),
      },
      { status: 500 }
    );
  }
}
