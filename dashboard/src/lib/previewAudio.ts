/**
 * Parse /api/pronunciation/preview into a playable audio Blob.
 * Guards against a Vercel regression that returned JSON-encoded byte maps
 * with Content-Type: audio/wav (browsers then report "no supported source").
 */
export async function audioBlobFromPreviewResponse(
  res: Response
): Promise<Blob> {
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throw new Error(
      errJson && typeof errJson.error === "string"
        ? errJson.error
        : `Preview failed (${res.status})`
    );
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 12) {
    throw new Error("Voice preview returned empty audio.");
  }

  // JSON object of bytes: {"0":82,"1":73,...}
  if (buf[0] === 0x7b /* { */) {
    throw new Error(
      "Voice preview returned invalid audio encoding. Redeploy the desk preview API."
    );
  }

  const isRiff =
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46;
  if (!isRiff) {
    throw new Error("Voice preview did not return a WAV file.");
  }

  const type = res.headers.get("content-type") || "audio/wav";
  return new Blob([buf], { type: type.includes("audio") ? type : "audio/wav" });
}
