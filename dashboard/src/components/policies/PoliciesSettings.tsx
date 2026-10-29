"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { PlusIcon, SpeakerWaveIcon, ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/20/solid";
import { useCan, withRoleGate } from "@/components/DeskRole";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Switch } from "@/components/ui/Switch";
import { TextAreaField } from "@/components/ui/TextField";
import { SettingsPageHeader, settingsConsoleClass, settingsPanelClass } from "@/components/settingsUi";
import type { SettingsCompileState } from "@/app/(desk)/settings/actions";
import type { PoliciesCardResult, PoliciesUnknownInput } from "@/app/(desk)/settings/policiesCardActions";
import type { TenantRow } from "@/lib/supabase";
import { cx } from "@/lib/cx";
import { labelOfMethod, methodSummary, normalizePayments, type PaymentMethod } from "@/lib/payments";
import { normalizeBusinessPolicies, readBookingMode, readHoldRules, seedStarterPolicies } from "@/lib/businessPolicies";
import type { PolicyTopic } from "@/lib/policyRules";
import {
  UNKNOWN_ANSWER_DEFAULT_EN,
  ownerUnknownAnswer,
  parseUnknownAnswerSpoken,
  unknownAnswerBoxText,
} from "@/lib/unknownAnswerSpoken";
import {
  PATCH_TEXT_MAX,
  TEXT_KEY,
  applyPoliciesPatch,
  callersHearLines,
  hearItText,
  hiddenNotes,
  invertPoliciesPatch,
  paybillAccountSentence,
  payTimingSentence,
  policiesAnchor,
  policiesKind,
  policiesNiche,
  ruleRows,
  unknownAnswerSentence,
  type PoliciesKind,
  type PoliciesPatch,
  type StoredPolicies,
} from "@/lib/policiesRemake";
import { lexiconForStorage, parseTtsLexicon } from "@/lib/pronunciationLexicon";
import { listCuratedSonioxVoicesSync, resolveLiveCallVoiceId, type CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { NO_VOICE_SAMPLE_COPY, assertPreviewAudioPlayable, objectUrlFromPreviewResponse, previewErrorCopy } from "@/lib/previewAudio";
import { PolicyCard, SentenceRow, type CardSaveState } from "./policiesKit";
import { AddMethodSheet, HoldsSheet, MethodSheet, PayTimingSheet, RuleSheet, UnknownSheet, methodNeedsFields, withMethod } from "./policiesSheets";

type CardId = "payments" | "pay-timing" | "bookings" | "holds" | "rules" | "other" | "unsure";
type SheetState =
  | { kind: "rule"; topic: PolicyTopic }
  | { kind: "pay-timing" }
  | { kind: "add-method" }
  | { kind: "method"; method: PaymentMethod; isNew: boolean }
  | { kind: "holds" }
  | { kind: "unsure" };

export type SaveCardFn = (patch: PoliciesPatch) => Promise<PoliciesCardResult>;
export type SaveUnknownFn = (input: PoliciesUnknownInput) => Promise<SettingsCompileState>;

const SAVED_FOR_MS = 8000;
const OFFLINE_COPY = "Couldn't save. Check your connection and try again.";
const IDLE: CardSaveState = { state: "idle" };

function mergeCardStatus(...states: CardSaveState[]): CardSaveState {
  for (const s of states) {
    if (s.state === "saving") return s;
    if (s.state === "error") return s;
  }
  for (const s of states) {
    if (s.state === "saved") return s;
  }
  return IDLE;
}

/** Ordered card saves: one request at a time, newest view on screen at once. */
function useCardQueue(initial: StoredPolicies, save: SaveCardFn, niche: Parameters<typeof applyPoliciesPatch>[2], onSaveActivity?: () => void) {
  const [base, setBase] = useState<StoredPolicies>(initial);
  const baseRef = useRef(base);
  const [pending, setPending] = useState<Array<{ id: number; patch: PoliciesPatch }>>([]);
  const [status, setStatus] = useState<Partial<Record<CardId, CardSaveState>>>({});
  const chain = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);
  const timers = useRef<Partial<Record<CardId, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach((x) => x && clearTimeout(x));
  }, []);

  const setCard = useCallback((card: CardId, s: CardSaveState) => {
    const t = timers.current[card];
    if (t) clearTimeout(t);
    setStatus((prev) => ({ ...prev, [card]: s }));
    if (s.state === "saved") timers.current[card] = setTimeout(() => setStatus((prev) => ({ ...prev, [card]: IDLE })), SAVED_FOR_MS);
  }, []);

  const enqueue = useCallback(
    function run(card: CardId, patch: PoliciesPatch, undoable = true) {
      const id = ++seq.current;
      setPending((p) => [...p, { id, patch }]);
      setCard(card, { state: "saving" });
      onSaveActivity?.();
      chain.current = chain.current
        .then(async () => {
        let res: PoliciesCardResult;
        try {
          res = await save(patch);
        } catch {
          res = { ok: false, error: OFFLINE_COPY };
        }
        if (res.ok) {
          const before = baseRef.current;
          const after = applyPoliciesPatch(before, patch, niche);
          baseRef.current = after;
          setBase(after);
          setPending((p) => p.filter((x) => x.id !== id));
          const inverse = invertPoliciesPatch(before, patch);
          setCard(card, { state: "saved", undo: undoable ? () => run(card, inverse, false) : undefined });
          onSaveActivity?.();
        } else {
          setPending((p) => p.filter((x) => x.id !== id));
          setCard(card, { state: "error", error: res.error || OFFLINE_COPY, retry: () => run(card, patch, undoable) });
        }
      })
        .catch(() => {
          setPending((p) => p.filter((x) => x.id !== id));
          setCard(card, { state: "error", error: OFFLINE_COPY, retry: () => run(card, patch, undoable) });
        });
    },
    [niche, onSaveActivity, save, setCard]
  );

  const view = useMemo(() => pending.reduce((acc, p) => applyPoliciesPatch(acc, p.patch, niche), base), [base, pending, niche]);
  const statusOf = (card: CardId): CardSaveState => status[card] ?? IDLE;
  return { view, enqueue, statusOf, setCard };
}

/** Jumps from Home (#payments) land on the card, focus its heading and mark it for a moment. */
function useAnchorFocus(refs: Partial<Record<CardId, RefObject<HTMLHeadingElement | null>>>) {
  const [highlight, setHighlight] = useState<CardId | null>(null);
  useEffect(() => {
    function go() {
      const id = policiesAnchor(window.location.hash) as CardId | null;
      if (!id) return;
      const el = refs[id]?.current;
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.closest("section")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
      setHighlight(id);
      window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2400);
    }
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
    // refs are stable objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return highlight;
}

/** Starter text removed: emptied and marked as the owner's choice. */
function starterRemovePatch(key: string): PoliciesPatch {
  if (key === "other") return { other: "" };
  if (key === "deposit") return { deposit: "" };
  return { text: { [key]: "" } as PoliciesPatch["text"] };
}

function ActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-4 py-2">{children}</div>;
}

const linkRowClass =
  "-me-2 inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-body font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
const quietButtonClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-body font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function useCallersHearPreview(
  lines: ReturnType<typeof callersHearLines>,
  tenant: TenantRow,
  voices: CuratedSonioxVoice[],
) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      setLoading(false);
    };
  }, []);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const text = hearItText(lines);

  async function hear() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    if (url) {
      URL.revokeObjectURL(url);
      setUrl(null);
    }
    try {
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          text,
          language: "en",
          lexicon: lexiconForStorage(parseTtsLexicon(tenant.tts_lexicon)),
          voiceId: resolveLiveCallVoiceId(String(tenant.soniox_voice_id || ""), voices),
        }),
      });
      if (ac.signal.aborted) return;
      const preview = await objectUrlFromPreviewResponse(res);
      try {
        await assertPreviewAudioPlayable(preview.url);
      } catch (err) {
        URL.revokeObjectURL(preview.url);
        throw err;
      }
      if (ac.signal.aborted) {
        URL.revokeObjectURL(preview.url);
        return;
      }
      setUrl(preview.url);
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(previewErrorCopy(err));
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  return { lines, text, url, error, loading, hear, onPreviewAudioError: () => {
    setUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setError(NO_VOICE_SAMPLE_COPY);
  } };
}

function CallersHearLinesList({ lines }: { lines: ReturnType<typeof callersHearLines> }) {
  if (!lines.length) {
    return <p className="text-body text-ink-2">Nothing yet. Callers hear that the team will confirm.</p>;
  }
  return (
    <dl className="space-y-3">
      {lines.map((l) => (
        <div key={l.key}>
          <dt className="text-meta text-ink-2">{l.label}</dt>
          <dd className="text-body text-ink [overflow-wrap:anywhere]">{l.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function CallersHearControls({
  text,
  url,
  error,
  loading,
  hear,
  onPreviewAudioError,
}: {
  text: string;
  url: string | null;
  error: string | null;
  loading: boolean;
  hear: () => void;
  onPreviewAudioError: () => void;
}) {
  return (
    <>
      {text ? (
        <div className="flex flex-wrap items-center gap-2" data-role-exempt="">
          <Button variant="tonal" size="md" pending={loading} leading={<SpeakerWaveIcon aria-hidden className="size-4" />} onClick={() => void hear()}>
            Hear it
          </Button>
        </div>
      ) : null}
      {url ? (
        <audio
          controls
          autoPlay
          preload="metadata"
          className="max-w-full"
          onError={onPreviewAudioError}
        >
          <source src={url} type="audio/wav" />
        </audio>
      ) : error ? (
        <p className="text-meta text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Phone: sticky preview while scrolling cards. Desktop: side column (unchanged). */
function CallersHearCompact({
  preview,
}: {
  preview: ReturnType<typeof useCallersHearPreview>;
}) {
  const [expanded, setExpanded] = useState(false);
  const compactLine = preview.text || (preview.lines[0] ? `${preview.lines[0].label}: ${preview.lines[0].text}` : "");
  return (
    <div
      className={cx(
        "sticky top-0 z-10 col-span-full border-b border-hairline bg-surface px-3 py-2 shadow-sm xl:hidden",
        expanded ? "" : "max-h-[4.5rem] overflow-hidden",
      )}
      data-callers-hear-compact=""
    >
      <div className="flex min-h-11 max-h-11 items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate text-body text-ink"
          title={compactLine || undefined}
        >
          {compactLine || "Nothing set yet."}
        </p>
        {preview.text ? (
          <Button
            variant="tonal"
            size="sm"
            pending={preview.loading}
            leading={<SpeakerWaveIcon aria-hidden className="size-4" />}
            onClick={() => void preview.hear()}
          >
            Hear it
          </Button>
        ) : null}
        <IconButton
          label={expanded ? "Collapse callers hear" : "Expand callers hear"}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? <ChevronUpIcon className="size-5" aria-hidden /> : <ChevronDownIcon className="size-5" aria-hidden />}
        </IconButton>
      </div>
      {expanded ? (
        <div className="mt-2 space-y-2 border-t border-hairline pt-2 pb-1">
          <p className="text-meta font-medium text-ink-2">Callers hear</p>
          <CallersHearLinesList lines={preview.lines} />
          <CallersHearControls {...preview} />
        </div>
      ) : null}
    </div>
  );
}

function CallersHearAside({ preview }: { preview: ReturnType<typeof useCallersHearPreview> }) {
  return (
    <aside
      aria-labelledby="policies-hear-title"
      className="hidden min-w-0 space-y-1.5 xl:col-start-2 xl:row-start-1 xl:block xl:sticky xl:top-6"
      data-callers-hear=""
    >
      <div className="flex min-h-11 items-center px-1">
        <h2 id="policies-hear-title" className="text-meta font-medium text-ink-2">
          Callers hear
        </h2>
      </div>
      <div className="space-y-3 rounded-2xl border border-hairline bg-surface px-4 py-4">
        <CallersHearLinesList lines={preview.lines} />
        <CallersHearControls {...preview} />
      </div>
    </aside>
  );
}

function PoliciesSettingsInner({
  tenant,
  heading,
  sidebar,
  curatedVoices,
  onSaveActivity,
  saveCard,
  saveUnknown,
  initialSheet = null,
}: {
  tenant: TenantRow;
  heading?: string | null;
  sidebar?: ReactNode;
  curatedVoices?: CuratedSonioxVoice[];
  onSaveActivity?: () => void;
  /** Injected so the page and the /dev fixture share every line of UI. */
  saveCard: SaveCardFn;
  saveUnknown: SaveUnknownFn;
  initialSheet?: SheetState | null;
}) {
  const canEdit = useCan("settings.edit");
  const kind: PoliciesKind = policiesKind(tenant);
  const niche = useMemo(() => policiesNiche(tenant, kind), [tenant, kind]);
  const voices = curatedVoices && curatedVoices.length ? curatedVoices : listCuratedSonioxVoicesSync();
  const { view, enqueue, statusOf, setCard } = useCardQueue(
    (tenant.business_policies as StoredPolicies | null) ?? {},
    saveCard,
    niche,
    onSaveActivity
  );
  const bp = normalizeBusinessPolicies(view);
  const payments = bp.payments ?? null;
  const rows = ruleRows(view, kind, niche);
  const hidden = hiddenNotes(view, kind, niche);
  const starters = seedStarterPolicies(bp);
  const starterSet = new Set<string>(starters.map((s) => s.key));
  const lines = callersHearLines(view, kind, niche);

  /* Sheets: one at a time; focus goes back to the control that opened it. */
  const [sheet, setSheet] = useState<SheetState | null>(initialSheet);
  const [sheetOpen, setSheetOpen] = useState(Boolean(initialSheet));
  const [sheetKey, setSheetKey] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  function openSheet(s: SheetState) {
    if (!sheetOpen) opener.current = (document.activeElement as HTMLElement | null) ?? null;
    setSheet(s);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }
  function closeSheet() {
    setSheetOpen(false);
    const back = opener.current;
    window.setTimeout(() => {
      setSheet((s) => (s && !sheetOpenRef.current ? null : s));
      if (back && back.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus();
    }, 320);
  }
  const sheetOpenRef = useRef(sheetOpen);
  sheetOpenRef.current = sheetOpen;
  function saveFromSheet(card: CardId, patch: PoliciesPatch) {
    closeSheet();
    enqueue(card, patch);
  }

  /* Anything else: a free-text extra with its own Save while it has changes. */
  const [other, setOther] = useState(starterSet.has("other") ? "" : bp.other || "");
  const otherDirty = other.trim() !== (starterSet.has("other") ? "" : String(bp.other || "").trim());

  /* When unsure: its own column, its own save. */
  const [unknown, setUnknown] = useState(() => {
    const stored = parseUnknownAnswerSpoken(tenant.unknown_answer_spoken);
    const pair = stored && stored.source === ownerUnknownAnswer(tenant.unknown_answer_fallback) ? stored : null;
    return { text: unknownAnswerBoxText(tenant.unknown_answer_fallback), en: pair?.en ?? "", sw: pair?.sw ?? "" };
  });
  async function saveUnsure(next: { text: string; english: string; swahili: string; touched: boolean }, undoable = true) {
    const prev = unknown;
    closeSheet();
    setUnknown({ text: next.text, en: next.english, sw: next.swahili });
    setCard("unsure", { state: "saving" });
    onSaveActivity?.();
    let res: SettingsCompileState;
    try {
      res = await saveUnknown({ line: ownerUnknownAnswer(next.text), english: next.english, swahili: next.swahili, touched: next.touched });
    } catch {
      res = { error: OFFLINE_COPY };
    }
    if (res.error) {
      setUnknown(prev);
      setCard("unsure", { state: "error", error: res.error, retry: () => void saveUnsure(next, undoable) });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(res, "unknownAnswerSpoken")) {
      setUnknown((u) => ({ ...u, en: res.unknownAnswerSpoken?.en ?? "", sw: res.unknownAnswerSpoken?.sw ?? "" }));
    }
    setCard("unsure", {
      state: "saved",
      undo: undoable ? () => void saveUnsure({ text: prev.text, english: prev.en, swahili: prev.sw, touched: true }, false) : undefined,
    });
  }

  const refs = {
    payments: useRef<HTMLHeadingElement | null>(null),
    bookings: useRef<HTMLHeadingElement | null>(null),
    holds: useRef<HTMLHeadingElement | null>(null),
    rules: useRef<HTMLHeadingElement | null>(null),
    other: useRef<HTMLHeadingElement | null>(null),
    unsure: useRef<HTMLHeadingElement | null>(null),
  } satisfies Partial<Record<CardId, RefObject<HTMLHeadingElement | null>>>;
  const highlight = useAnchorFocus(refs);

  const timing = payTimingSentence(payments, kind);
  const holds = readHoldRules(bp.holds);
  const holdLabel = (h: number) => (h < 24 ? `${h} hours` : h === 24 ? "1 day" : `${h / 24} days`);
  const unsure = unknownAnswerSentence(ownerUnknownAnswer(unknown.text));
  const payNeedsCheck = Boolean(payments && payments.methods.length && !payments.confirmed);
  const legacyPay = !payments?.methods.length && !starterSet.has("payment") ? String(bp.payment || "").trim() : "";
  const callersHearPreview = useCallersHearPreview(lines, tenant, voices);

  function addMethod(m: PaymentMethod) {
    if (methodNeedsFields(m)) {
      openSheet({ kind: "method", method: m, isNew: true });
      return;
    }
    closeSheet();
    const base = payments ?? normalizePayments({ methods: [], timings: [] });
    enqueue("payments", { payments: { ...withMethod(base!, m), source: "owner", confirmed: true } });
  }

  return (
    <div className={settingsConsoleClass}>
      {sidebar}
      <div className={`${settingsPanelClass} space-y-4`}>
        <SettingsPageHeader businessName={tenant.business_name?.trim() || "Business"} lineLive={false} showBack wide title={heading ?? "Policies"} />
        <div className="grid w-full min-w-0 max-w-desk grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-policies-page={kind}>
          <CallersHearCompact preview={callersHearPreview} />
          <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
            <PolicyCard
              id="payments"
              title="Payment"
              status={mergeCardStatus(statusOf("payments"), statusOf("pay-timing"))}
              headingRef={refs.payments}
              highlight={highlight === "payments"}
            >
              {payments?.methods.map((m) => (
                <SentenceRow
                  key={m}
                  id={`pay-${m}`}
                  title={labelOfMethod(m)}
                  sentence={m === "mpesa_paybill" && payments.mpesa_paybill?.business_no ? payments.mpesa_paybill.business_no : methodSummary(payments, m) || (m === "cash" ? "Paid in person" : "By cheque")}
                  canEdit={canEdit}
                  onChange={() => openSheet({ kind: "method", method: m, isNew: false })}
                >
                  {m === "mpesa_paybill" && payments.mpesa_paybill?.business_no ? (
                    <p className="mt-0.5 text-meta text-ink-2">{paybillAccountSentence(payments.mpesa_paybill)}</p>
                  ) : null}
                </SentenceRow>
              ))}
              {!payments?.methods.length ? (
                <div className="px-4 py-3">
                  {legacyPay ? (
                    <>
                      <p className="text-body font-medium text-ink">Your words</p>
                      <p className="mt-0.5 text-body text-ink-2 [overflow-wrap:anywhere]">{legacyPay}</p>
                      <p className="mt-1 text-meta text-ink-2">Add the ways you take payment so callers get exact numbers.</p>
                    </>
                  ) : (
                    <p className="text-body text-ink-2">No way to pay added yet. Callers hear that the team will confirm.</p>
                  )}
                </div>
              ) : null}
              {payNeedsCheck && canEdit ? (
                <div className="space-y-2 px-4 py-3" data-pay-check="">
                  <p className="text-body text-ink">We read these from your notes. Are they right?</p>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => enqueue("payments", { payments: { ...payments!, source: "owner", confirmed: true }, confirm: ["payment"] })}
                  >
                    {"Yes, they're right"}
                  </Button>
                </div>
              ) : null}
              {canEdit ? (
                <ActionRow>
                  <button type="button" className={quietButtonClass} aria-haspopup="dialog" onClick={() => openSheet({ kind: "add-method" })} data-add-way="">
                    <PlusIcon aria-hidden className="size-4" />
                    Add a way to pay
                  </button>
                </ActionRow>
              ) : null}
              <div className="border-t border-hairline">
                <SentenceRow
                  id="pay-when"
                  title="When"
                  sentence={timing.text}
                  suggested={timing.suggested}
                  canEdit={canEdit}
                  onChange={() => openSheet({ kind: "pay-timing" })}
                />
              </div>
            </PolicyCard>

            {kind === "services" ? (
              <PolicyCard id="bookings" title="Bookings" status={statusOf("bookings")} headingRef={refs.bookings} highlight={highlight === "bookings"}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-ink" id="booking-mode-label">
                      Book a time slot directly
                    </p>
                    <p className="mt-0.5 text-body text-ink-2">
                      {readBookingMode(bp) === "confirmed_slot"
                        ? "On. Your Business Assistant notes the time callers ask for, and you confirm it."
                        : "Off. Callers ask for a time and you confirm it."}
                    </p>
                  </div>
                  <Switch
                    label="Book a time slot directly"
                    checked={readBookingMode(bp) === "confirmed_slot"}
                    disabled={!canEdit}
                    onCheckedChange={(on) => enqueue("bookings", { booking_mode: on ? "confirmed_slot" : "request" })}
                  />
                </div>
              </PolicyCard>
            ) : (
              <PolicyCard id="holds" title="Holds" status={statusOf("holds")} headingRef={refs.holds} highlight={highlight === "holds"}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-ink">Hold items for customers</p>
                    <p className="mt-0.5 text-body text-ink-2">
                      {holds.allowed === "yes"
                        ? `Up to ${holdLabel(holds.max_hours ?? 24)}, ${holds.deposit_required === "yes" ? "with a deposit" : "no deposit needed"}. You get an alert each time.`
                        : "Off. Callers are told items are not held."}
                    </p>
                    {holds.allowed === "yes" && bp.deposit && !starterSet.has("deposit") ? <p className="mt-0.5 text-meta text-ink-2 [overflow-wrap:anywhere]">{bp.deposit}</p> : null}
                  </div>
                  <Switch
                    label="Hold items for customers"
                    checked={holds.allowed === "yes"}
                    disabled={!canEdit}
                    onCheckedChange={(on) =>
                      enqueue("holds", {
                        holds: { allowed: on ? "yes" : "no", max_hours: on ? (holds.max_hours ?? 24) : null, deposit_required: on ? holds.deposit_required || "no" : "", source: "owner", confirmed: true },
                      })
                    }
                  />
                </div>
                {holds.allowed === "yes" && canEdit ? (
                  <ActionRow>
                    <button type="button" className={quietButtonClass} aria-haspopup="dialog" onClick={() => openSheet({ kind: "holds" })}>
                      Change hold rules
                    </button>
                  </ActionRow>
                ) : null}
              </PolicyCard>
            )}

            <PolicyCard id="rules" title="Topics" status={statusOf("rules")} headingRef={refs.rules} highlight={highlight === "rules"}>
              {rows.map((r) => (
                <SentenceRow
                  key={r.topic}
                  id={`rule-${r.topic}`}
                  title={r.label}
                  sentence={r.sentence}
                  suggested={r.state === "suggested"}
                  canEdit={canEdit}
                  onChange={() => openSheet({ kind: "rule", topic: r.topic })}
                />
              ))}
              {kind === "services" ? (
                <div className="flex items-start gap-3 px-4 py-3" data-travel-fee="">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-ink">Travel fee</p>
                    <p className="mt-0.5 text-body text-ink-2">Set an extra fee for far areas in Service areas.</p>
                  </div>
                  <Link href="/settings/areas" className={linkRowClass} aria-label="Open Service areas to set a travel fee">
                    Open
                  </Link>
                </div>
              ) : null}
            </PolicyCard>

            <PolicyCard id="other" title="Extra note" status={statusOf("other")} headingRef={refs.other} highlight={highlight === "other"}>
              <div className="space-y-3 px-4 py-3">
                <TextAreaField
                  id="policy-other"
                  label="Note (optional)"
                  hint="One or two short sentences. Use Topics above where you can."
                  rows={3}
                  maxLength={PATCH_TEXT_MAX}
                  disabled={!canEdit}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                />
                {otherDirty && canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="md" onClick={() => enqueue("other", { other })}>
                      Save
                    </Button>
                    <Button variant="ghost" size="md" onClick={() => setOther(bp.other || "")}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </div>
              {starters.map((s) => (
                <div key={s.key} className="space-y-1 px-4 py-3" data-starter={s.key}>
                  <p className="text-meta text-ink-2">{s.label}: starter text, not used yet</p>
                  <p className="text-body text-ink [overflow-wrap:anywhere]">{s.text}</p>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={quietButtonClass} onClick={() => enqueue("other", { confirm: [s.key] })}>
                        Keep it
                      </button>
                      <button type="button" className={cx(quietButtonClass, "text-ink-2")} onClick={() => enqueue("other", starterRemovePatch(s.key))}>
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {kind === "services" && bp.deposit && !starterSet.has("deposit") ? (
                <div className="space-y-1 px-4 py-3" data-hidden-note="deposit">
                  <p className="text-meta text-ink-2">Deposits: note callers still hear</p>
                  <p className="text-body text-ink [overflow-wrap:anywhere]">{bp.deposit}</p>
                  {canEdit ? (
                    <button type="button" className={cx(quietButtonClass, "-ms-3")} aria-label="Remove the deposits note" onClick={() => enqueue("other", { deposit: "" })}>
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}
              {hidden.map((n) => (
                <div key={n.topic} className="space-y-1 px-4 py-3" data-hidden-note={n.topic}>
                  <p className="text-meta text-ink-2">{n.label}: callers still hear this</p>
                  <p className="text-body text-ink [overflow-wrap:anywhere]">{n.text}</p>
                  {canEdit ? (
                    <button
                      type="button"
                      className={cx(quietButtonClass, "-ms-3")}
                      aria-label={`Remove the ${n.label.toLowerCase()} note`}
                      onClick={() => enqueue("other", { rules: { [n.topic]: null }, text: { [TEXT_KEY[n.topic]]: "" } as PoliciesPatch["text"] })}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </PolicyCard>

            <PolicyCard id="unsure" title="When unsure" status={statusOf("unsure")} headingRef={refs.unsure} highlight={highlight === "unsure"}>
              <SentenceRow
                id="unsure-line"
                title={unsure.automatic ? "Automatic" : "Your words"}
                sentence={unsure.text}
                canEdit={canEdit}
                onChange={() => openSheet({ kind: "unsure" })}
              />
            </PolicyCard>
          </div>
          <CallersHearAside preview={callersHearPreview} />
        </div>
      </div>

      {sheet?.kind === "rule" ? (
        <RuleSheet key={sheetKey} open={sheetOpen} topic={sheet.topic} kind={kind} niche={niche} raw={view} onClose={closeSheet} onSave={(p) => saveFromSheet("rules", p)} />
      ) : null}
      {sheet?.kind === "pay-timing" ? (
        <PayTimingSheet key={sheetKey} open={sheetOpen} kind={kind} payments={payments} onClose={closeSheet} onSave={(p) => saveFromSheet("pay-timing", p)} />
      ) : null}
      {sheet?.kind === "add-method" ? <AddMethodSheet key={sheetKey} open={sheetOpen} payments={payments} onClose={closeSheet} onPick={addMethod} /> : null}
      {sheet?.kind === "method" ? (
        <MethodSheet
          key={sheetKey}
          open={sheetOpen}
          method={sheet.method}
          isNew={sheet.isNew}
          payments={payments}
          onClose={closeSheet}
          onSave={(p) => saveFromSheet("payments", p)}
        />
      ) : null}
      {sheet?.kind === "holds" ? (
        <HoldsSheet key={sheetKey} open={sheetOpen} holds={bp.holds} holdNote={starterSet.has("deposit") ? "" : bp.deposit || ""} onClose={closeSheet} onSave={(p) => saveFromSheet("holds", p)} />
      ) : null}
      {sheet?.kind === "unsure" ? (
        <UnknownSheet
          key={sheetKey}
          open={sheetOpen}
          text={unknown.text}
          english={unknown.en}
          swahili={unknown.sw}
          onClose={closeSheet}
          onReset={() => void saveUnsure({ text: UNKNOWN_ANSWER_DEFAULT_EN, english: "", swahili: "", touched: false })}
          onSave={(v) => void saveUnsure(v)}
        />
      ) : null}
    </div>
  );
}

/** Settings › Policies: cards that each save on their own, beside what callers hear. */
export const PoliciesSettings = withRoleGate("settings.edit", PoliciesSettingsInner);
export type { SheetState as PoliciesSheetState };
