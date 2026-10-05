"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Pagination } from "@/components/ui/Pagination";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import {
  confirmPronunciationRecording,
  minePronunciationFromCallsAction,
  persistPronunciationLexicon,
  quickAddPronunciationAction,
  type ConfirmPronunciationState,
  type MinePronunciationState,
} from "@/app/(desk)/settings/pronunciationActions";
import {
  approveGeminiScanCandidateAction,
  dismissGeminiScanCandidateAction,
  geminiScanRecentCallsAction,
  loadPronunciationReviewQueueAction,
  type GeminiScanQueueState,
  type GeminiScanState,
} from "@/app/(desk)/settings/pronunciationGeminiScanActions";
import {
  displayLexiconLabel,
  lexiconForStorage,
  parseTtsLexicon,
  pronunciationHearBody,
  sanitizeSayForm,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import {
  assertPreviewAudioPlayable,
  isAutoplayBlock,
  NO_VOICE_SAMPLE_COPY,
  objectUrlFromPreviewResponse,
  previewErrorCopy,
} from "@/lib/previewAudio";
import type { PronunciationReviewCandidate } from "@/lib/pronunciationGeminiScan";
import {
  GEMINI_SCAN_BATCH_OPTIONS,
  GEMINI_SCAN_DEFAULT_BATCH,
} from "@/lib/pronunciationGeminiScanPrompt";
import {
  buildUnifiedFixReviewRows,
  fixTabHint,
  practiceTabHint,
  reviewRowSpeakable,
} from "@/lib/pronunciationFixUi";
import { customTrainingLine } from "@/lib/pronunciationMine";
import { buildPronunciationPacks } from "@/lib/pronunciationPacks";
import {
  isPronunciationCovered,
  type PronunciationSuggestion,
} from "@/lib/pronunciationSuggest";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { deskShiftClass, filterTabClass, btnPrimary, deskPreviewClass, pendingSpinnerClass, pendingSpinnerInkClass } from "@/components/ui/deskChrome";
import { settingsGhostButtonClass } from "@/components/settingsUi";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useSettingsLeaveSource } from "@/components/SettingsLeaveGuard";

type CallerProofRow = { name: string; say: string };

const libraryMutedClass = `${settingsGhostButtonClass} w-auto shrink-0 whitespace-nowrap`;
const libraryLinkClass = `inline-flex min-h-11 items-center justify-center px-3 text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline ${deskShiftClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`;

function HearButton({
  name,
  busy,
  onClick,
  variant = "primary",
}: {
  name: string;
  busy: boolean;
  onClick: () => void;
  variant?: "primary" | "ghost";
}) {
  const filled = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      aria-label={`Hear ${name}`}
      data-testid="pronunciation-hear"
      className={
        filled
          ? `${btnPrimary} w-auto shrink-0 gap-2`
          : `${settingsGhostButtonClass} w-auto shrink-0 gap-2`
      }
    >
      {busy ? (
        <span
          className={filled ? pendingSpinnerClass : pendingSpinnerInkClass}
          aria-hidden="true"
        />
      ) : null}
      Hear
    </button>
  );
}

type CoachItem = PronunciationSuggestion & {
  status: "todo" | "done" | "skipped";
};

type StudioMode = "practice" | "library" | "fix";

const confirmInitial: ConfirmPronunciationState = {};
const mineInitial: MinePronunciationState = {};
const geminiScanInitial: GeminiScanState = {};
const geminiQueueInitial: GeminiScanQueueState = {};
const LEXICON_PAGE_SIZE = 6;

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || "audio/webm" });
}

export function PronunciationCoach({
  tenantId,
  businessName,
  agentName,
  locations,
  team,
  initialLexicon,
  onLexiconChange,
  voiceId = null,
  omitLexiconField = false,
  initialMode = "practice",
  initialReview = [],
}: {
  tenantId: string;
  businessName: string;
  agentName: string;
  locationNotes?: string;
  locations: Array<{
    label: string;
    address: string;
    landmark: string;
    directions: string;
    coverage_notes?: string;
  }>;
  team: Array<{ name: string; role: string }>;
  services?: Array<{ name: string }>;
  faqs?: Array<{ question: string; answer: string }>;
  bulletinTexts?: string[];
  initialLexicon: TtsLexiconEntry[];
  onLexiconChange: (entries: TtsLexiconEntry[]) => void;
  /** Stored tenant.soniox_voice_id. Preview route resolves the live voice. */
  voiceId?: string | null;
  /** When embedded in TenantForm, lexicon is submitted via the parent hidden field. */
  omitLexiconField?: boolean;
  /** Dev fixture only. Owner desk stays on Practice. */
  initialMode?: StudioMode;
  /** Dev fixture queue. A signed-in load replaces it. */
  initialReview?: PronunciationReviewCandidate[];
}) {
  const rawInitialCount = Array.isArray(initialLexicon)
    ? initialLexicon.length
    : 0;
  const [lexicon, setLexicon] = useState<TtsLexiconEntry[]>(() =>
    parseTtsLexicon(initialLexicon)
  );
  const [cleanNote, setCleanNote] = useState<string | null>(null);
  const cleanedOnceRef = useRef(false);

  const [extraItems, setExtraItems] = useState<PronunciationSuggestion[]>([]);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<StudioMode>(initialMode);
  const [lexiconPage, setLexiconPage] = useState(0);
  const [showFullQueue, setShowFullQueue] = useState(false);

  const [addPhrase, setAddPhrase] = useState("");
  const [addSay, setAddSay] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [editSay, setEditSay] = useState("");
  const [callerProof, setCallerProof] = useState<CallerProofRow[] | null>(null);
  const [hearUrl, setHearUrl] = useState<string | null>(null);
  const [hearBusyKey, setHearBusyKey] = useState<string | null>(null);
  const [hearError, setHearError] = useState<string | null>(null);
  const hearUrlsRef = useRef<Map<string, string>>(new Map());
  const hearAudioRef = useRef<HTMLAudioElement | null>(null);
  const hearFlightRef = useRef(false);

  const [geminiBatch, setGeminiBatch] = useState<number>(GEMINI_SCAN_DEFAULT_BATCH);
  const [geminiConfirmOpen, setGeminiConfirmOpen] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<PronunciationReviewCandidate[]>(
    () =>
      initialReview.filter(
        (c) => c.status === "pending" && c.type === "AGENT_MISPRONUNCIATION"
      )
  );
  const [sttHints, setSttHints] = useState<PronunciationReviewCandidate[]>(() =>
    initialReview.filter(
      (c) => c.status === "pending" && c.type === "LIKELY_MISHEARD"
    )
  );
  const [reviewEdits, setReviewEdits] = useState<Record<string, string>>({});
  const [spellingOpenId, setSpellingOpenId] = useState<string | null>(null);
  const [geminiNote, setGeminiNote] = useState<string | null>(null);
  const [showTypedSave, setShowTypedSave] = useState(false);
  const [heardEdit, setHeardEdit] = useState<string | null>(null);
  const [heardReview, setHeardReview] = useState<Record<string, string>>({});
  const [listenNote, setListenNote] = useState<string | null>(null);
  const [unsavedReview, setUnsavedReview] = useState(false);
  const unsavedReviewRef = useRef(false);
  unsavedReviewRef.current = unsavedReview;
  const [removeTarget, setRemoveTarget] = useState<{ match: string; label: string } | null>(
    null
  );
  useSettingsLeaveSource("pronunciation", unsavedReview);
  const reviewTouchedRef = useRef(false);

  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [keptTakeUrl, setKeptTakeUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const keptTakeUrlRef = useRef<string | null>(null);
  audioUrlRef.current = audioUrl;
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmPronunciationRecording,
    confirmInitial
  );
  const [persistState, persistAction, persistPending] = useActionState(
    persistPronunciationLexicon,
    confirmInitial
  );
  const [quickState, quickAction, quickPending] = useActionState(
    quickAddPronunciationAction,
    confirmInitial
  );
  const [mineState, mineAction, minePending] = useActionState(
    minePronunciationFromCallsAction,
    mineInitial
  );
  const [geminiState, geminiAction, geminiPending] = useActionState(
    geminiScanRecentCallsAction,
    geminiScanInitial
  );
  const [approveState, approveAction, approvePending] = useActionState(
    approveGeminiScanCandidateAction,
    geminiQueueInitial
  );
  const [dismissState, dismissAction, dismissPending] = useActionState(
    dismissGeminiScanCandidateAction,
    geminiQueueInitial
  );
  const [loadQueueState, loadQueueAction] = useActionState(
    loadPronunciationReviewQueueAction,
    geminiQueueInitial
  );

  const lexiconJson = useMemo(
    () => JSON.stringify(lexiconForStorage(lexicon)),
    [lexicon]
  );

  useEffect(() => {
    if (cleanedOnceRef.current) return;
    cleanedOnceRef.current = true;
    const cleaned = parseTtsLexicon(initialLexicon);
    setLexicon(cleaned);
    if (rawInitialCount > cleaned.length) {
      setCleanNote(
        `Removed ${rawInitialCount - cleaned.length} unsafe pronunciation overrides (common words).`
      );
      const fd = new FormData();
      fd.set("id", tenantId);
      fd.set("tts_lexicon", JSON.stringify(lexiconForStorage(cleaned)));
      startTransition(() => persistAction(fd));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mineState.ok && Array.isArray(mineState.suggestions)) {
      setExtraItems((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const next = [...prev];
        for (const s of mineState.suggestions || []) {
          if (!ids.has(s.id)) next.push(s);
        }
        return next;
      });
      if ((mineState.suggestions || []).length > 0) {
        setMode("practice");
      }
    }
  }, [mineState]);

  useEffect(() => {
    const fd = new FormData();
    fd.set("id", tenantId);
    startTransition(() => loadQueueAction(fd));
  }, [tenantId]);

  const applyPendingQueue = useCallback((queue: PronunciationReviewCandidate[]) => {
    const pending = queue.filter((c) => c.status === "pending");
    setReviewQueue(
      pending.filter((c) => c.type === "AGENT_MISPRONUNCIATION")
    );
    setSttHints(pending.filter((c) => c.type === "LIKELY_MISHEARD"));
  }, []);

  useEffect(() => {
    if (!loadQueueState.ok || unsavedReviewRef.current || reviewTouchedRef.current) {
      return;
    }
    setReviewQueue(loadQueueState.queue || []);
    setSttHints(loadQueueState.sttHints || []);
  }, [loadQueueState]);

  useEffect(() => {
    if (geminiState.needsConfirm) {
      setGeminiConfirmOpen(true);
      return;
    }
    if (geminiState.unsaved && Array.isArray(geminiState.queue)) {
      setGeminiConfirmOpen(false);
      setUnsavedReview(true);
      reviewTouchedRef.current = true;
      if (geminiState.message) setListenNote(geminiState.message);
      applyPendingQueue(geminiState.queue);
      return;
    }
    if (geminiState.saved) {
      setGeminiConfirmOpen(false);
      setUnsavedReview(false);
      reviewTouchedRef.current = true;
      if (Array.isArray(geminiState.queue)) applyPendingQueue(geminiState.queue);
      return;
    }
    if (geminiState.ok) {
      setGeminiConfirmOpen(false);
      setUnsavedReview(false);
      setGeminiNote(null);
      setListenNote(geminiState.message || null);
      if (Array.isArray(geminiState.queue)) {
        reviewTouchedRef.current = true;
        applyPendingQueue(geminiState.queue);
      }
    } else if (geminiState.error) {
      setGeminiConfirmOpen(false);
    }
  }, [applyPendingQueue, geminiState]);

  useEffect(() => {
    const state = approveState.ok
      ? approveState
      : dismissState.ok
        ? dismissState
        : null;
    if (!state) {
      if (approveState.error) setGeminiNote(approveState.error);
      if (dismissState.error) setGeminiNote(dismissState.error);
      return;
    }
    if (unsavedReviewRef.current) return;
    setReviewQueue(state.queue || []);
    setSttHints(state.sttHints || []);
    if (state.message) setGeminiNote(state.message);
    if (state.lexicon) {
      setLexicon(parseTtsLexicon(state.lexicon));
    }
  }, [approveState, dismissState]);

  useEffect(() => {
    if (quickState.ok && quickState.lexicon) {
      setLexicon(parseTtsLexicon(quickState.lexicon));
      setAddPhrase("");
      setAddSay("");
      setAddError(null);
    }
  }, [quickState]);

  useEffect(() => {
    if (persistState.ok && persistState.lexicon) {
      setLexicon(parseTtsLexicon(persistState.lexicon));
      setEditingMatch(null);
      setEditSay("");
    }
  }, [persistState]);

  const packs = useMemo(
    () =>
      buildPronunciationPacks({
        businessName,
        agentName,
        locations,
        team,
        existingLexicon: lexicon,
      }),
    [businessName, agentName, locations, team, lexicon]
  );

  const queue = useMemo(() => {
    const byId = new Map<string, PronunciationSuggestion>();
    for (const p of [...packs, ...extraItems]) byId.set(p.id, p);
    return [...byId.values()];
  }, [packs, extraItems]);

  const items: CoachItem[] = useMemo(() => {
    return queue.map((s) => {
      const isRenew = s.id.startsWith("renew:");
      return {
        ...s,
        reason: "",
        status: skippedIds.has(s.id)
          ? "skipped"
          : !isRenew && isPronunciationCovered(s, lexicon)
            ? "done"
            : "todo",
      };
    });
  }, [queue, skippedIds, lexicon]);

  const todoItems = items.filter((i) => i.status === "todo");
  const active =
    items.find((i) => i.id === activeId && i.status === "todo") ||
    todoItems[0] ||
    null;

  useEffect(() => {
    if (active && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  useEffect(() => {
    onLexiconChange(lexicon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lexicon]);

  useEffect(() => {
    if (confirmState.ok && confirmState.lexicon) {
      setLexicon(parseTtsLexicon(confirmState.lexicon));
      setRecording(false);
      setAudioBlob(null);
      const take = audioUrlRef.current;
      if (take) {
        setKeptTakeUrl((current) => {
          if (current && current !== take) URL.revokeObjectURL(current);
          return take;
        });
        keptTakeUrlRef.current = take;
        audioUrlRef.current = null;
      }
      setAudioUrl(null);
      setMicError(null);
      setAddError(null);
      setExtraItems((prev) =>
        prev.filter((p) => !isPronunciationCovered(p, confirmState.lexicon || []))
      );
    }
  }, [confirmState]);

  useEffect(() => {
    if (!confirmState.ok || !confirmState.entries?.length) return;
    const rows = confirmState.entries
      .map((entry) => ({
        name: displayLexiconLabel(entry),
        say: entry.say,
      }))
      .filter((row) => row.name);
    if (!rows.length) return;
    for (const url of hearUrlsRef.current.values()) URL.revokeObjectURL(url);
    hearUrlsRef.current.clear();
    const audio = hearAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setHearUrl(null);
    setHearError(null);
    setCallerProof(rows);
  }, [confirmState]);

  useEffect(() => {
    const urls = hearUrlsRef.current;
    return () => {
      stopStream();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      if (keptTakeUrlRef.current) URL.revokeObjectURL(keptTakeUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLexiconPage(0);
  }, [lexicon.length]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
  }

  function clearTake() {
    setRecording(false);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setMicError(null);
  }

  function clearCallerHear() {
    hearFlightRef.current = false;
    for (const url of hearUrlsRef.current.values()) URL.revokeObjectURL(url);
    hearUrlsRef.current.clear();
    const audio = hearAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setHearUrl(null);
    setHearBusyKey(null);
    setHearError(null);
    setCallerProof(null);
    if (keptTakeUrlRef.current) URL.revokeObjectURL(keptTakeUrlRef.current);
    keptTakeUrlRef.current = null;
    setKeptTakeUrl(null);
  }

  async function playHearUrl(url: string) {
    const audio = hearAudioRef.current;
    if (!audio) return;
    if (audio.getAttribute("src") !== url) audio.src = url;
    else {
      try {
        audio.currentTime = 0;
      } catch {
        // Metadata may not be ready on the first replay.
      }
    }
    try {
      await audio.play();
    } catch (err) {
      if (!isAutoplayBlock(err)) throw err;
    }
  }

  async function hearSavedName(key: string, name: string): Promise<boolean> {
    const text = name.trim();
    if (!text || hearFlightRef.current) return false;
    setHearError(null);
    const cached = hearUrlsRef.current.get(key);
    if (cached) {
      setHearUrl(cached);
      try {
        await playHearUrl(cached);
        return true;
      } catch (err) {
        setHearError(previewErrorCopy(err));
        return false;
      }
    }
    hearFlightRef.current = true;
    setHearBusyKey(key);
    try {
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          pronunciationHearBody({
            name: text,
            lexicon,
            voiceId,
          })
        ),
      });
      const preview = await objectUrlFromPreviewResponse(res);
      try {
        await assertPreviewAudioPlayable(preview.url);
      } catch (probeErr) {
        URL.revokeObjectURL(preview.url);
        throw probeErr;
      }
      hearUrlsRef.current.set(key, preview.url);
      setHearUrl(preview.url);
      await playHearUrl(preview.url);
      return true;
    } catch (err) {
      setHearError(previewErrorCopy(err));
      return false;
    } finally {
      hearFlightRef.current = false;
      setHearBusyKey(null);
    }
  }

  async function hearEditedSay(match: string) {
    const say = sanitizeSayForm(editSay);
    if (!say) return;
    const ok = await hearSavedName(`edit:${match}:${say}`, say);
    if (ok) setHeardEdit(`${match}:${say}`);
  }

  async function hearReviewSay(id: string, say: string) {
    const spoken = sanitizeSayForm(say);
    if (!spoken) return;
    const ok = await hearSavedName(`review:${id}:${spoken}`, spoken);
    if (ok) setHeardReview((prev) => ({ ...prev, [id]: spoken }));
  }

  async function startRecording() {
    setMicError(null);
    clearCallerHear();
    clearTake();
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicError("This browser can’t record audio. Try Chrome or Safari.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecording(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setMicError(
        "Microphone permission blocked. Allow mic access to train pronunciation."
      );
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    } else {
      setRecording(false);
      stopStream();
    }
  }

  function skipActive() {
    if (!active) return;
    setSkippedIds((prev) => new Set(prev).add(active.id));
    clearTake();
  }

  function removeEntry(match: string) {
    const next = lexicon.filter((e) => e.match !== match);
    setLexicon(next);
    if (editingMatch === match) {
      setEditingMatch(null);
      setEditSay("");
    }
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("tts_lexicon", JSON.stringify(lexiconForStorage(next)));
    startTransition(() => persistAction(fd));
  }

  function saveEditedSay(match: string) {
    const say = sanitizeSayForm(editSay);
    if (!say) {
      setAddError("Enter how the phone should say it.");
      return;
    }
    if (heardEdit !== `${match}:${say}`) return;
    const next = lexicon.map((e) =>
      e.match === match
        ? { ...e, say, label: displayLexiconLabel(e) }
        : e
    );
    setLexicon(next);
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("tts_lexicon", JSON.stringify(lexiconForStorage(next)));
    startTransition(() => persistAction(fd));
  }

  function renewEntry(entry: TtsLexiconEntry) {
    // Never use phonetic `say` as the phrase; that would train the wrong match.
    const phrase = displayLexiconLabel(entry);
    const line = customTrainingLine({
      phrase,
      idPrefix: "renew",
      reason: "",
    });
    if (!line) {
      setAddError(
        `Couldn’t queue “${phrase}” for renew. Try adding it under Fix.`
      );
      setMode("fix");
      return;
    }
    setExtraItems((prev) => {
      const without = prev.filter((p) => p.id !== line.id);
      return [line, ...without];
    });
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.delete(line.id);
      return next;
    });
    setActiveId(line.id);
    setAddError(null);
    clearTake();
    setMode("practice");
  }

  function queueCustomPhrase(phrase: string) {
    const line = customTrainingLine({
      phrase,
      idPrefix: "custom",
      reason: "",
    });
    if (!line) {
      setAddError(
        "That looks like a common English word. Use a hard name/place, or a short sentence with it."
      );
      return false;
    }
    setExtraItems((prev) => {
      const without = prev.filter((p) => p.id !== line.id);
      return [line, ...without];
    });
    setActiveId(line.id);
    setAddError(null);
    clearTake();
    setMode("practice");
    return true;
  }

  function keepRecording() {
    if (!active || !audioBlob || confirmPending) return;
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("prompt", active.prompt);
    fd.set("label", active.label);
    fd.set("kind", "sentence");
    fd.set("match", active.match);
    fd.set("targets", JSON.stringify(active.targets || []));
    fd.set("current_lexicon", lexiconJson);
    fd.set(
      "audio",
      blobToFile(
        audioBlob,
        `pronunciation-${active.id.replace(/[^a-z0-9-]/gi, "")}.webm`
      )
    );
    startTransition(() => confirmAction(fd));
  }

  function scanCalls() {
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("current_lexicon", lexiconJson);
    startTransition(() => mineAction(fd));
  }

  function runGeminiScan(confirmed: boolean) {
    setGeminiNote(null);
    if (geminiBatch > 10 && !confirmed) {
      setGeminiConfirmOpen(true);
      return;
    }
    setListenNote(null);
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("current_lexicon", lexiconJson);
    fd.set("batch_size", String(geminiBatch));
    if (confirmed) fd.set("confirmed", "1");
    startTransition(() => geminiAction(fd));
  }

  function saveHeldReview() {
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("save_only", "1");
    fd.set("review_queue", JSON.stringify([...reviewQueue, ...sttHints]));
    startTransition(() => geminiAction(fd));
  }

  function approveCandidate(c: PronunciationReviewCandidate) {
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("candidate_id", c.id);
    fd.set("current_lexicon", lexiconJson);
    const edited = (reviewEdits[c.id] ?? c.suggested_form).trim();
    if (edited) fd.set("edited_say", edited);
    startTransition(() => approveAction(fd));
  }

  function dismissCandidate(
    c: PronunciationReviewCandidate,
    mode: "rejected" | "snoozed"
  ) {
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("candidate_id", c.id);
    fd.set("mode", mode);
    startTransition(() => dismissAction(fd));
  }

  function recordCandidateInstead(c: PronunciationReviewCandidate) {
    const line = customTrainingLine({
      phrase: c.word_or_phrase,
      reason: "",
      idPrefix: "gemini-record",
    });
    if (!line) {
      setGeminiNote("Could not queue that phrase for recording.");
      return;
    }
    setExtraItems((prev) =>
      prev.some((p) => p.id === line.id) ? prev : [...prev, line]
    );
    setMode("practice");
    setActiveId(line.id);
  }

  function submitQuickAdd(modeAdd: "record" | "save") {
    const phrase = addPhrase.trim();
    if (!phrase) return;
    setAddError(null);
    if (modeAdd === "record") {
      if (!queueCustomPhrase(phrase)) return;
      setAddPhrase("");
      setAddSay("");
      return;
    }
    if (!addSay.trim()) {
      setAddError(
        "Add how it should sound, or use Record it instead."
      );
      return;
    }
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("phrase", phrase);
    fd.set("say", addSay.trim());
    fd.set("current_lexicon", lexiconJson);
    startTransition(() => quickAction(fd));
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const totalFocus = items.filter((i) => i.status !== "skipped").length;
  const showMismatch = Boolean(confirmState.error && !confirmState.ok);

  const lexiconPageCount = Math.max(1, Math.ceil(lexicon.length / LEXICON_PAGE_SIZE));
  const safeLexiconPage = Math.min(lexiconPage, lexiconPageCount - 1);
  const visibleLexicon = lexicon.slice(
    safeLexiconPage * LEXICON_PAGE_SIZE,
    (safeLexiconPage + 1) * LEXICON_PAGE_SIZE
  );

  const queueList = showFullQueue
    ? items
    : items.filter((i) => i.status === "todo").slice(0, 5);
  const hiddenQueueCount = items.length - queueList.length;

  const fixReviewRows = useMemo(
    () => buildUnifiedFixReviewRows({ speech: reviewQueue, hearing: sttHints }),
    [reviewQueue, sttHints]
  );
  /** Fix mode: one filled primary: Use this when review waits; else Record & train; Save review when held. */
  const fixHasUsePrimary = fixReviewRows.some((r) => r.primaryAction === "use");

  const modes: Array<{ id: StudioMode; label: string; hint: string | null }> = [
    {
      id: "practice",
      label: "Practice",
      hint: practiceTabHint(todoItems.length),
    },
    {
      id: "library",
      label: "Library",
      hint: `${lexicon.length} saved`,
    },
    {
      id: "fix",
      label: "Fix",
      hint: fixTabHint(fixReviewRows.length),
    },
  ];

  return (
    <section
      id="pronunciation-coach"
      className={omitLexiconField ? "space-y-4" : "space-y-5 border-t border-[var(--line)] pt-8"}
      aria-labelledby="pronunciation-coach-heading"
    >
      {omitLexiconField ? null : (
        <input type="hidden" name="tts_lexicon" value={lexiconJson} />
      )}

      <div className="min-w-0">
        {omitLexiconField ? (
          <h3 id="pronunciation-coach-heading" className="sr-only">
            Pronunciation
          </h3>
        ) : (
          <h2
            id="pronunciation-coach-heading"
            className="font-display text-2xl tracking-tight text-ink"
          >
            Pronunciation
          </h2>
        )}
        {cleanNote ? (
          <p className="mt-2 text-xs text-[var(--ok)]" role="status">
            {cleanNote}
          </p>
        ) : null}
      </div>

      <div
        className="inline-flex max-w-full justify-start gap-1 overflow-x-auto [scrollbar-width:thin]"
        role="tablist"
        aria-label="Pronunciation studio modes"
        data-settings-strip=""
      >
        {modes.map((m) => {
          const selected = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setMode(m.id)}
              className={`${filterTabClass(selected)} shrink-0`}
            >
              {m.label}
              {m.hint ? (
                <span className="ml-1.5 text-xs font-normal text-ink-soft">
                  {m.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {mode === "practice" ? (
        <div className="space-y-5">
          {callerProof?.length ? (
            <div data-testid="caller-proof">
              <p className="text-sm font-medium text-ink" role="status">
                Callers hear this
              </p>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {callerProof.map((row, index) => {
                  const key = `proof:${row.name}:${row.say}:${index}`;
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-ink">
                        {row.name}
                      </span>
                      <HearButton
                        name={row.name}
                        busy={hearBusyKey === key}
                        onClick={() => void hearSavedName(key, row.name)}
                      />
                    </li>
                  );
                })}
              </ul>
              {keptTakeUrl ? (
                <audio
                  src={keptTakeUrl}
                  controls
                  preload="metadata"
                  className="mt-2 h-10 max-w-full"
                  data-testid="saved-take-audio"
                  aria-label="Saved take"
                />
              ) : null}
            </div>
          ) : null}
          {!todoItems.length && !active ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-surface/60 px-4 py-5">
              <p className="text-sm font-medium text-[var(--ink)]">Nothing left to practice</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMode("fix")}
                  className={btnPrimary}
                >
                  Fix a word
                </button>
                <Button variant="ghost" onClick={() => setMode("library")}>
                  Open library
                </Button>
              </div>
            </div>
          ) : (
            <>
              {active ? (
                <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-surface px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      {active.label}
                    </p>
                    {totalFocus ? (
                      <p className="text-xs text-[var(--ink-soft)]">
                        {doneCount} of {totalFocus} done
                      </p>
                    ) : null}
                  </div>
                  <p
                    className="mt-2 font-display text-xl leading-snug tracking-tight text-[var(--ink)] sm:text-2xl"
                    aria-live="polite"
                  >
                    {active.prompt}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {!recording && !audioBlob ? (
                      <button
                        type="button"
                        onClick={startRecording}
                        className={`${btnPrimary} w-auto shrink-0 gap-2`}
                      >
                        Record line
                      </button>
                    ) : null}
                    {recording ? (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className={`${btnPrimary} w-auto shrink-0 gap-2`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent-on-fill"
                        />
                        Stop
                      </button>
                    ) : null}
                    {audioBlob && audioUrl && !recording ? (
                      <>
                        <audio
                          src={audioUrl}
                          controls
                          className="h-10 max-w-full"
                          preload="metadata"
                        />
                        <button
                          type="button"
                          onClick={startRecording}
                          className={libraryMutedClass}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={keepRecording}
                          disabled={confirmPending}
                          className={`${btnPrimary} w-auto shrink-0 gap-2`}
                        >
                          {confirmPending ? (
                            <span className={pendingSpinnerClass} aria-hidden="true" />
                          ) : null}
                          {confirmPending ? "Checking…" : "Use this take"}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={skipActive}
                      className={libraryLinkClass}
                    >
                      Skip for now
                    </button>
                  </div>

                  {micError ? (
                    <p className="mt-3 text-sm text-[var(--warn)]" role="alert">
                      {micError}
                    </p>
                  ) : null}
                  {showMismatch ? (
                    <div className="mt-3 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-3 py-2">
                      <p className="text-sm text-[var(--warn)]" role="alert">
                        {confirmState.error}
                      </p>
                      {confirmState.heard ? (
                        <p className="mt-1 text-xs text-[var(--ink-soft)]">
                          We heard something like: “{confirmState.heard}”
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {(todoItems.length > 1 || showFullQueue) && queueList.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      Up next
                    </p>
                    {items.length > 5 || showFullQueue ? (
                      <button
                        type="button"
                        onClick={() => setShowFullQueue((v) => !v)}
                        className="text-xs font-medium text-[var(--accent-deep)] hover:underline"
                      >
                        {showFullQueue
                          ? "Show remaining only"
                          : hiddenQueueCount > 0
                            ? `Show all (${items.length})`
                            : "Hide finished"}
                      </button>
                    ) : null}
                  </div>
                  <ul className="space-y-1.5" aria-label="Training queue">
                    {queueList.map((item) => {
                      const selected = active?.id === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            disabled={item.status === "done"}
                            onClick={() => {
                              if (item.status === "skipped") {
                                setSkippedIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(item.id);
                                  return next;
                                });
                              }
                              setActiveId(item.id);
                              clearTake();
                            }}
                            className={[
                              "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm",
                              deskShiftClass,
                              selected
                                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                : "border-[var(--line)] bg-surface hover:border-[var(--accent)]/50",
                              item.status === "done" ? "opacity-60" : "",
                            ].join(" ")}
                          >
                            <span className="min-w-0">
                              <span className="block text-xs text-[var(--ink-soft)]">
                                {item.label}
                              </span>
                              <span className="mt-0.5 block truncate font-medium text-[var(--ink)]">
                                {item.prompt}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-[var(--ink-soft)]">
                              {item.status === "done"
                                ? "Done"
                                : item.status === "skipped"
                                  ? "Skipped"
                                  : "Todo"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {mode === "library" ? (
        <div className="space-y-4">
          {lexicon.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-surface/60 px-4 py-5">
              <p className="text-sm font-medium text-[var(--ink)]">Nothing trained yet</p>
              <button
                type="button"
                onClick={() => setMode("practice")}
                className={`mt-3 ${btnPrimary}`}
              >
                Start practicing
              </button>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-line border-y border-line">
                {visibleLexicon.map((entry) => {
                  const label = displayLexiconLabel(entry);
                  const isEditing = editingMatch === entry.match;
                  const hearKey = `library:${entry.match}:${entry.say}`;
                  return (
                  <li key={entry.match} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{label}</p>
                        {!isEditing ? (
                          <p className="truncate font-mono text-xs text-ink-soft">{entry.say}</p>
                        ) : null}
                      </div>
                      <HearButton
                        name={label}
                        busy={
                          hearBusyKey ===
                          (isEditing
                            ? `edit:${entry.match}:${sanitizeSayForm(editSay)}`
                            : hearKey)
                        }
                        onClick={() => {
                          if (isEditing) {
                            void hearEditedSay(entry.match);
                            return;
                          }
                          void hearSavedName(hearKey, label);
                        }}
                      />
                    </div>
                    <div className="flex basis-full flex-wrap items-center justify-end gap-1 md:basis-auto md:shrink-0">
                      <button
                        type="button"
                        onClick={() => renewEntry(entry)}
                        className={libraryMutedClass}
                      >
                        Renew
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingMatch(null);
                            setEditSay("");
                            setHeardEdit(null);
                          } else {
                            setEditingMatch(entry.match);
                            setEditSay(entry.say);
                            setHeardEdit(null);
                            setAddError(null);
                          }
                        }}
                        className={libraryMutedClass}
                      >
                        {isEditing ? "Cancel" : "Edit say"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRemoveTarget({
                            match: entry.match,
                            label: label || "this word",
                          })
                        }
                        disabled={persistPending}
                        className={`${libraryLinkClass} disabled:opacity-60`}
                      >
                        Remove
                      </button>
                    </div>
                    {isEditing ? (
                      <div className="flex w-full flex-wrap items-center gap-2">
                        <input
                          value={editSay}
                          onChange={(e) => setEditSay(e.target.value)}
                          aria-label={`Say-as for ${label}`}
                          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                        <button
                          type="button"
                          onClick={() => saveEditedSay(entry.match)}
                          disabled={
                            persistPending ||
                            !sanitizeSayForm(editSay) ||
                            heardEdit !== `${entry.match}:${sanitizeSayForm(editSay)}`
                          }
                          className={`${btnPrimary} w-auto shrink-0`}
                        >
                          {persistPending ? "Saving…" : "Save"}
                        </button>
                        {heardEdit === `${entry.match}:${sanitizeSayForm(editSay)}` ? null : (
                          <p className="w-full text-xs text-ink-soft">Hear it first.</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
              <Pagination
                page={safeLexiconPage + 1}
                pageSize={LEXICON_PAGE_SIZE}
                total={lexicon.length}
                noun="line"
                onPage={(next) => setLexiconPage(next - 1)}
              />
            </>
          )}
          {persistState.error ? (
            <p className="text-xs text-[var(--warn)]">{persistState.error}</p>
          ) : null}
          {persistState.ok && !persistState.error ? (
            <p className="text-xs text-[var(--ok)]" role="status">
              Updated. Next call will use it.
            </p>
          ) : null}
          {addError && mode === "library" ? (
            <p className="text-xs text-[var(--warn)]" role="alert">
              {addError}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "fix" ? (
        <div className="space-y-8">
          <div className="space-y-3">
            <h3 className="font-medium text-ink">Needs review</h3>

            {geminiNote && (approveState.error || dismissState.error) ? (
              <p className="text-xs text-[var(--warn)]" role="alert">
                {geminiNote}
              </p>
            ) : null}
            {geminiNote && !approveState.error && !dismissState.error ? (
              <p className="text-xs text-[var(--ink-soft)]" role="status">
                {geminiNote}
              </p>
            ) : null}
            {loadQueueState.error ? (
              <p className="text-xs text-[var(--warn)]" role="alert">
                {loadQueueState.error}
              </p>
            ) : null}

            {fixReviewRows.length === 0 ? (
              loadQueueState.error ? null : (
                <p className="text-sm text-ink" role="status">
                  Nothing waiting.
                </p>
              )
            ) : (
              <ul
                className="divide-y divide-line border-y border-line"
                aria-label="Pronunciation review queue"
              >
                {fixReviewRows.map((row) => {
                  const c = row.candidate;
                  const proposed = sanitizeSayForm(
                    (reviewEdits[c.id] ?? c.suggested_form).trim()
                  );
                  const heardThis =
                    Boolean(proposed) && heardReview[c.id] === proposed;
                  const hearSay = proposed || row.phrase;
                  const hearKey = `review:${c.id}:${hearSay}`;
                  const spellingOpen = spellingOpenId === row.id;
                  const showHear =
                    row.kind === "speech"
                      ? Boolean(proposed)
                      : reviewRowSpeakable(row.phrase, proposed);
                  return (
                    <li
                      key={row.id}
                      className="flex min-w-0 flex-wrap items-center gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {row.phrase}
                        </p>
                        {proposed ? (
                          <p
                            className={`${deskPreviewClass} font-mono text-xs text-ink-soft`}
                          >
                            {proposed}
                          </p>
                        ) : null}
                      </div>
                      <div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                        {showHear ? (
                          <HearButton
                            name={row.phrase}
                            variant="ghost"
                            busy={hearBusyKey === hearKey}
                            onClick={() => {
                              if (row.kind === "speech") {
                                void hearReviewSay(c.id, proposed);
                                return;
                              }
                              void hearSavedName(hearKey, hearSay);
                            }}
                          />
                        ) : null}
                        {row.primaryAction === "use" ? (
                          <button
                            type="button"
                            onClick={() => approveCandidate(c)}
                            disabled={
                              approvePending ||
                              dismissPending ||
                              unsavedReview ||
                              !heardThis
                            }
                            className={
                              unsavedReview || geminiConfirmOpen
                                ? `${libraryMutedClass} disabled:opacity-60`
                                : `${btnPrimary} w-auto shrink-0`
                            }
                          >
                            {approvePending ? "Saving…" : "Use this"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => dismissCandidate(c, "rejected")}
                            disabled={dismissPending || unsavedReview}
                            className={`${libraryMutedClass} disabled:opacity-60`}
                          >
                            Dismiss
                          </button>
                        )}
                        {row.primaryAction === "use" ? (
                          <button
                            type="button"
                            onClick={() => recordCandidateInstead(c)}
                            disabled={unsavedReview}
                            className={`${libraryMutedClass} disabled:opacity-60`}
                          >
                            Record
                          </button>
                        ) : null}
                        {row.canApproveSpelling ? (
                          <button
                            type="button"
                            aria-pressed={spellingOpen}
                            onClick={() =>
                              setSpellingOpenId(spellingOpen ? null : row.id)
                            }
                            className={libraryMutedClass}
                          >
                            Spelling
                          </button>
                        ) : null}
                        {row.primaryAction === "use" && !heardThis ? (
                          <p className="basis-full text-xs text-ink-soft">
                            Hear it first.
                          </p>
                        ) : null}
                      </div>
                      {spellingOpen && row.canApproveSpelling ? (
                        <input
                          value={reviewEdits[c.id] ?? c.suggested_form}
                          onChange={(e) =>
                            setReviewEdits((prev) => ({
                              ...prev,
                              [c.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          aria-label={`Spelling for ${row.phrase}`}
                          className="min-h-11 w-40 max-w-full rounded-xl border border-line bg-surface px-3 font-mono text-sm text-ink outline-none focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={scanCalls}
              disabled={minePending || geminiPending || unsavedReview}
              className={`${libraryLinkClass} disabled:opacity-60`}
            >
              {minePending ? "Scanning…" : "Scan"}
            </button>
            {mineState.error ? (
              <p className="text-xs text-warn" role="alert">
                {mineState.error}
              </p>
            ) : null}
            {mineState.ok ? (
              <p className="text-xs text-ink-soft" role="status">
                Scan: {mineState.scannedLines ?? 0} lines
                {mineState.suggestions?.length
                  ? ` · ${mineState.suggestions.length} sent to Practice`
                  : " · nothing new"}
                .
              </p>
            ) : null}
          </div>

          {/* 2) Add a fix */}
          <div className="space-y-3 border-t border-[var(--line)] pt-6">
            <div>
              <h3 className="font-medium text-[var(--ink)]">Add a fix</h3>
            </div>
            <div>
              <label
                className="block text-xs font-medium text-[var(--ink-soft)]"
                htmlFor="pron-add-phrase"
              >
                Word or sentence
              </label>
              <input
                id="pron-add-phrase"
                value={addPhrase}
                onChange={(e) => {
                  setAddPhrase(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder="Muindi Mbingu"
                className="mt-1 w-full max-w-lg rounded-xl border border-[var(--line)] bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:border-[var(--accent)]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => submitQuickAdd("record")}
                disabled={!addPhrase.trim()}
                className={
                  fixHasUsePrimary || unsavedReview || geminiConfirmOpen
                    ? `${libraryMutedClass} disabled:opacity-60`
                    : btnPrimary
                }
              >
                Record &amp; train
              </button>
              <button
                type="button"
                onClick={() => setShowTypedSave((v) => !v)}
                className="text-sm font-medium text-[var(--ink-soft)] underline-offset-2 hover:underline"
              >
                {showTypedSave ? "Hide typed spelling" : "Or save a spelling…"}
              </button>
            </div>
            {showTypedSave ? (
              <div className="max-w-lg space-y-2">
                <label
                  className="block text-xs font-medium text-[var(--ink-soft)]"
                  htmlFor="pron-add-say"
                >
                  Say like
                </label>
                <input
                  id="pron-add-say"
                  value={addSay}
                  onChange={(e) => {
                    setAddSay(e.target.value);
                    setAddError(null);
                  }}
                  placeholder="Moo-in-dee Mbeen-goo"
                  className="w-full rounded-xl border border-[var(--line)] bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => submitQuickAdd("save")}
                  disabled={!addPhrase.trim() || !addSay.trim() || quickPending}
                  className="rounded-xl border border-[var(--line)] bg-surface px-4 py-2 text-sm font-medium text-[var(--ink)] disabled:opacity-60"
                >
                  {quickPending ? "Saving…" : "Save spelling"}
                </button>
              </div>
            ) : null}
            {addError ? (
              <p className="text-xs text-[var(--warn)]" role="alert">
                {addError}
              </p>
            ) : null}
            {quickState.error ? (
              <p className="text-xs text-[var(--warn)]" role="alert">
                {quickState.error}
              </p>
            ) : null}
            {quickState.ok && !quickState.error ? (
              <p className="text-xs text-[var(--ok)]" role="status">
                Saved. Next call will use it. Confirm on{" "}
                <Link
                  href={businessSettingsHref("test")}
                  className="font-medium text-accent-deep underline-offset-2 hover:underline"
                >
                  Test
                </Link>
                .
              </p>
            ) : null}
          </div>

          {/* 3) Find more */}
          <div className="space-y-3 border-t border-[var(--line)] pt-6">
            <div>
              <h3 className="font-medium text-[var(--ink)]">Find more</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  unsavedReview ? saveHeldReview() : runGeminiScan(false)
                }
                disabled={geminiPending || minePending}
                className={
                  unsavedReview
                    ? `${btnPrimary} w-auto shrink-0 gap-2`
                    : `${libraryMutedClass} disabled:opacity-60`
                }
              >
                {geminiPending ? (
                  <span className={pendingSpinnerClass} aria-hidden="true" />
                ) : null}
                {geminiPending
                  ? unsavedReview
                    ? "Saving…"
                    : "Listening…"
                  : unsavedReview
                    ? "Save review"
                    : "AI listen"}
              </button>
              <DeskSelect
                id="gemini-batch"
                aria-label="Calls for AI listen"
                value={String(geminiBatch)}
                disabled={geminiPending || unsavedReview}
                className="min-h-11 min-w-[7.5rem] rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                options={GEMINI_SCAN_BATCH_OPTIONS.map((n) => ({
                  value: String(n),
                  label: `Last ${n}`,
                }))}
                onChange={(next) => setGeminiBatch(Number(next))}
              />
              {listenNote ? (
                <p className="text-sm text-ink-soft" role="status">
                  {listenNote}
                </p>
              ) : null}
            </div>

            {geminiConfirmOpen ? (
              <div
                className="rounded-xl border border-warn/40 px-3 py-3 text-sm"
                role="alertdialog"
                aria-label="Confirm AI listen"
              >
                <p className="text-ink">
                  Listen to the last {geminiBatch} recordings.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runGeminiScan(true)}
                    disabled={geminiPending}
                    className={btnPrimary}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGeminiConfirmOpen(false);
                      setGeminiNote(null);
                    }}
                    className={settingsGhostButtonClass}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {geminiState.error ? (
              <p className="text-xs text-warn" role="alert">
                {geminiState.error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {hearError ? (
        <p className="text-sm text-warn" role="alert">
          {hearError}
        </p>
      ) : null}
      <audio
        ref={hearAudioRef}
        controls
        preload="metadata"
        aria-label="Callers hear this"
        aria-hidden={hearUrl ? undefined : true}
        tabIndex={hearUrl ? 0 : -1}
        data-testid="pronunciation-hear-audio"
        className={
          hearUrl
            ? "h-10 max-w-full"
            : "pointer-events-none absolute h-px w-px overflow-hidden"
        }
        onError={() => {
          const src = hearAudioRef.current?.getAttribute("src");
          if (!src) return;
          setHearError(NO_VOICE_SAMPLE_COPY);
          setHearUrl(null);
        }}
      />
      <ConfirmSheet
        open={removeTarget != null}
        title={removeTarget ? `Remove ${removeTarget.label}?` : "Remove?"}
        confirmLabel="Remove"
        danger
        pending={persistPending}
        onClose={() => {
          if (!persistPending) setRemoveTarget(null);
        }}
        onConfirm={() => {
          if (!removeTarget) return;
          removeEntry(removeTarget.match);
          setRemoveTarget(null);
        }}
      >
        The phone stops using it.
      </ConfirmSheet>
    </section>
  );
}
