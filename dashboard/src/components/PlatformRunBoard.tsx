import { ListRow } from "@/components/ui/ListRow";
import { Stamp } from "@/components/ui/Stamp";
import {
  buildPlatformRunRows,
  type PhoneLineTelecomInput,
  type PlatformHealthTone,
} from "@/lib/platformRunBoardModel";
import { fetchVoiceHealthz } from "@/lib/platformVoiceHealth";
import { getSautikitWallet, isSautikitConfigured, listSautikitNumbers } from "@/lib/sautikit";

function healthStampTone(tone: PlatformHealthTone): "ok" | "attention" | "neutral" {
  return tone;
}

async function loadPhoneLineTelecom(): Promise<PhoneLineTelecomInput> {
  if (!isSautikitConfigured()) {
    return { status: "not_configured" };
  }

  try {
    const numbers = await listSautikitNumbers();
    let wallet = null;
    let walletHidden = false;
    try {
      wallet = await getSautikitWallet();
      if (!wallet) walletHidden = true;
    } catch {
      walletHidden = true;
    }
    return { status: "ok", numbers, wallet, walletHidden };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}

/** Server component: line, speech, reasoning. Numbers live on /admin/numbers. */
export async function PlatformRunBoard() {
  const [telecom, voice] = await Promise.all([loadPhoneLineTelecom(), fetchVoiceHealthz()]);
  const rows = buildPlatformRunRows({ telecom, voice });
  const numberCount = telecom.status === "ok" ? telecom.numbers.length : 0;

  return (
    <section aria-label="Line">
      <p className="px-4 text-caption text-ink-3">Line</p>
      <ul className="divide-y divide-hairline">
        {rows.map((row) => (
          <ListRow
            key={row.id}
            title={row.title}
            preview={row.health.detail || undefined}
            when={row.money.primary !== "Unknown" ? row.money.primary : undefined}
            stamp={<Stamp tone={healthStampTone(row.health.tone)}>{row.health.label}</Stamp>}
          />
        ))}
        <ListRow
          href="/admin/numbers"
          title="Numbers"
          when={numberCount > 0 ? String(numberCount) : "None"}
        />
      </ul>
    </section>
  );
}
