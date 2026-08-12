"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmPronunciationRecording,
  minePronunciationFromCallsAction,
  persistPronunciationLexicon,
  quickAddPronunciationAction,
  type ConfirmPronunciationState,
  type MinePronunciationState,
} from "@/app/(desk)/settings/pronunciationActions";
import {
  displayLexiconLabel,
  lexiconForStorage,
  parseTtsLexicon,
  sanitizeSayForm,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import { customTrainingLine } from "@/lib/pronunciationMine";
import {
  buildPronunciationPacks,
  previewSpokenLine,
} from "@/lib/pronunciationPacks";
import {
  isPronunciationCovered,
  type PronunciationSuggestion,
} from "@/lib/pronunciationSuggest";

type CoachItem = PronunciationSuggestion & {
  status: "todo" | "done" | "skipped";
};

type StudioMode = "practice" | "library" | "fix";

const confirmInitial: ConfirmPronunciationState = {};
const mineInitial: MinePronunciationState = {};
const LEXICON_PAGE_SIZE = 6;

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || "audio/webm" });
}

export function PronunciationCoach({
  tenantId,
  businessName,
  agentName,
  sonioxVoiceId,
  locations,
  team,
  initialLexicon,
  onLexiconChange,
}: {
  tenantId: string;
  businessName: string;
  agentName: string;
  sonioxVoiceId?: string | null;
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
  const [mode, setMode] = useState<StudioMode>("practice");
  const [lexiconPage, setLexiconPage] = useState(0);
  const [showFullQueue, setShowFullQueue] = useState(false);

  const [addPhrase, setAddPhrase] = useState("");
  const [addSay, setAddSay] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [editSay, setEditSay] = useState("");
  const [keepNote, setKeepNote] = useState<string | null>(null);
  const [phonePreviewLoading, setPhonePreviewLoading] = useState(false);
  const [phonePreviewError, setPhonePreviewError] = useState<string | null>(null);
  const [phonePreviewUrl, setPhonePreviewUrl] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
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
      persistAction(fd);
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

  const greetingPreview = useMemo(() => {
    const sample =
      agentName && businessName
        ? `Hello, you've reached ${businessName}, this is ${agentName} speaking. How can I help?`
        : businessName
          ? `Thank you for calling ${businessName}.`
          : "";
    if (!sample) return "";
    return previewSpokenLine(sample, lexicon);
  }, [businessName, agentName, lexicon]);

  useEffect(() => {
    return () => {
      if (phonePreviewUrl) URL.revokeObjectURL(phonePreviewUrl);
    };
  }, [phonePreviewUrl]);

  async function playPhonePreview() {
    if (!greetingPreview) return;
    setPhonePreviewLoading(true);
    setPhonePreviewError(null);
    if (phonePreviewUrl) {
      URL.revokeObjectURL(phonePreviewUrl);
      setPhonePreviewUrl(null);
    }
    try {
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: greetingPreview,
          lexicon: lexiconForStorage(lexicon),
          voiceId: sonioxVoiceId || undefined,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson && typeof errJson.error === "string"
            ? errJson.error
            : `Preview failed (${res.status})`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPhonePreviewUrl(url);
      const audio = new Audio(url);
      await audio.play();
    } catch (err) {
      setPhonePreviewError(
        err instanceof Error ? err.message : "Could not play phone preview."
      );
    } finally {
      setPhonePreviewLoading(false);
    }
  }

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
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMicError(null);
      setAddError(null);
      setExtraItems((prev) =>
        prev.filter((p) => !isPronunciationCovered(p, confirmState.lexicon || []))
      );
    }
  }, [confirmState]);

  useEffect(() => {
    if (confirmState.ok && confirmState.entries?.length) {
      const n = confirmState.entries.length;
      const localNote =
        confirmState.source === "local"
          ? " (basic spelling — voice check was unavailable)"
          : "";
      setKeepNote(
        `Saved ${n} pronunciation${n === 1 ? "" : "s"} — live on the next call.${localNote}`
      );
    }
  }, [confirmState]);

  useEffect(() => {
    return () => {
      stopStream();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
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
    setKeepNote(null);
  }

  async function startRecording() {
    setMicError(null);
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
    persistAction(fd);
  }

  function saveEditedSay(match: string) {
    const say = sanitizeSayForm(editSay);
    if (!say) {
      setAddError("Enter how the phone should say it.");
      return;
    }
    const next = lexicon.map((e) =>
      e.match === match
        ? { ...e, say, label: displayLexiconLabel(e) }
        : e
    );
    setLexicon(next);
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("tts_lexicon", JSON.stringify(lexiconForStorage(next)));
    persistAction(fd);
  }

  function renewEntry(entry: TtsLexiconEntry) {
    // Never use phonetic `say` as the phrase — that would train the wrong match.
    const phrase = displayLexiconLabel(entry);
    const line = customTrainingLine({
      phrase,
      idPrefix: "renew",
      reason: `Renew “${entry.say}” — record a clearer take.`,
    });
    if (!line) {
      setAddError(
        `Couldn’t queue “${phrase}” for renew — try adding it under Fix.`
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
      reason: "You flagged this as sounding wrong.",
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
    if (!active || !audioBlob) return;
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
    confirmAction(fd);
  }

  function scanCalls() {
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("current_lexicon", lexiconJson);
    mineAction(fd);
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
    quickAction(fd);
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

  const modes: Array<{ id: StudioMode; label: string; hint: string }> = [
    {
      id: "practice",
      label: "Practice",
      hint: todoItems.length ? `${todoItems.length} left` : "Caught up",
    },
    {
      id: "library",
      label: "Library",
      hint: `${lexicon.length} saved`,
    },
    {
      id: "fix",
      label: "Fix",
      hint: "Heard wrong",
    },
  ];

  return (
    <section
      id="pronunciation-coach"
      className="space-y-5 border-t border-[var(--line)] pt-8"
      aria-labelledby="pronunciation-coach-heading"
    >
      <input type="hidden" name="tts_lexicon" value={lexiconJson} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="pronunciation-coach-heading"
            className="font-display text-2xl tracking-tight text-[var(--ink)]"
          >
            Pronunciation studio
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Teach how names and places should sound on the phone. Changes apply on
            the next call.
          </p>
          {cleanNote ? (
            <p className="mt-2 text-xs text-[var(--ok)]" role="status">
              {cleanNote}
            </p>
          ) : null}
        </div>
        {greetingPreview ? (
          <div className="max-w-sm text-right text-xs leading-relaxed text-[var(--ink-soft)]">
            <span className="font-medium text-[var(--ink)]">Greeting preview</span>
            <p className="mt-1">{greetingPreview}</p>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => playPhonePreview()}
                disabled={phonePreviewLoading}
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-60"
              >
                {phonePreviewLoading ? "Generating…" : "Play phone preview"}
              </button>
              {phonePreviewUrl ? (
                <audio src={phonePreviewUrl} controls className="max-w-full" />
              ) : null}
            </div>
            {phonePreviewError ? (
              <p className="mt-1 text-[var(--warn)]" role="alert">
                {phonePreviewError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-wrap gap-1 border-b border-[var(--line)] pb-px"
        role="tablist"
        aria-label="Pronunciation studio modes"
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
              className={[
                "-mb-px border-b-2 px-3 py-2 text-sm transition",
                selected
                  ? "border-[var(--accent)] font-medium text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]",
              ].join(" ")}
            >
              {m.label}
              <span className="ml-1.5 text-xs font-normal text-[var(--ink-soft)]">
                {m.hint}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "practice" ? (
        <div className="space-y-5">
          {!todoItems.length && !active ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-white/60 px-4 py-5">
              <p className="text-sm font-medium text-[var(--ink)]">Nothing left to practice</p>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Core names are covered. Fix something you heard wrong, or renew a
                word in Library.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMode("fix")}
                  className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-deep)]"
                >
                  Fix a word
                </button>
                <button
                  type="button"
                  onClick={() => setMode("library")}
                  className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)]"
                >
                  Open library
                </button>
              </div>
            </div>
          ) : (
            <>
              {active ? (
                <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white via-[var(--accent-soft)]/35 to-white px-5 py-6 sm:px-7">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      {active.label} · say this line
                    </p>
                    {totalFocus ? (
                      <p className="text-xs text-[var(--ink-soft)]">
                        {doneCount} of {totalFocus} done
                      </p>
                    ) : null}
                  </div>
                  <p
                    className="mt-3 font-display text-2xl leading-snug tracking-tight text-[var(--ink)] sm:text-3xl"
                    aria-live="polite"
                  >
                    {active.prompt}
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">{active.reason}</p>
                  {active.targets?.length ? (
                    <p className="mt-3 text-xs text-[var(--ink-soft)]">
                      Learns:{" "}
                      <span className="font-medium text-[var(--ink)]">
                        {active.targets.map((t) => t.label).join(" · ")}
                      </span>
                    </p>
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {!recording && !audioBlob ? (
                      <button
                        type="button"
                        onClick={startRecording}
                        className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-deep)]"
                      >
                        <span
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 rounded-full bg-white ${recording ? "animate-pulse" : ""}`}
                        />
                        Record line
                      </button>
                    ) : null}
                    {recording ? (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="inline-flex items-center gap-2 rounded-xl bg-[var(--warn)] px-5 py-3 text-sm font-medium text-white"
                      >
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 animate-pulse rounded-full bg-white"
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
                          className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-medium"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={keepRecording}
                          disabled={confirmPending}
                          className="rounded-xl bg-[var(--ok)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {confirmPending ? "Checking…" : "Use this take"}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={skipActive}
                      className="text-sm text-[var(--ink-soft)] underline-offset-2 hover:underline"
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
                  {keepNote ? (
                    <p className="mt-3 text-sm text-[var(--ok)]" role="status">
                      {keepNote}
                    </p>
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
                              "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                              selected
                                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
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
          <p className="text-sm text-[var(--ink-soft)]">
            Words already trained for the phone. Renew to re-record, edit the say-as, or remove.
          </p>
          {lexicon.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-white/60 px-4 py-5">
              <p className="text-sm font-medium text-[var(--ink)]">Nothing trained yet</p>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Practice core packs, or fix a word you heard wrong.
              </p>
              <button
                type="button"
                onClick={() => setMode("practice")}
                className="mt-3 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-deep)]"
              >
                Start practicing
              </button>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
                {visibleLexicon.map((entry) => {
                  const label = displayLexiconLabel(entry);
                  const isEditing = editingMatch === entry.match;
                  return (
                  <li
                    key={entry.match}
                    className="py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-[var(--ink)]">
                        {label}
                      </span>
                      {!isEditing ? (
                        <span className="font-mono text-xs text-[var(--ink-soft)]">
                          phone says → {entry.say}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => renewEntry(entry)}
                        className="text-xs font-medium text-[var(--accent-deep)] hover:underline"
                      >
                        Renew
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingMatch(null);
                            setEditSay("");
                          } else {
                            setEditingMatch(entry.match);
                            setEditSay(entry.say);
                            setAddError(null);
                          }
                        }}
                        className="text-xs font-medium text-[var(--ink-soft)] hover:underline"
                      >
                        {isEditing ? "Cancel" : "Edit say"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.match)}
                        disabled={persistPending}
                        className="text-xs text-[var(--warn)] hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </span>
                    </div>
                    {isEditing ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          value={editSay}
                          onChange={(e) => setEditSay(e.target.value)}
                          aria-label={`Say-as for ${label}`}
                          className="min-w-[12rem] flex-1 rounded-xl border border-[var(--line)] bg-white px-3 py-1.5 font-mono text-sm outline-none focus:border-[var(--accent)]"
                        />
                        <button
                          type="button"
                          onClick={() => saveEditedSay(entry.match)}
                          disabled={persistPending || !editSay.trim()}
                          className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          {persistPending ? "Saving…" : "Save"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
              {lexicon.length > LEXICON_PAGE_SIZE ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-[var(--ink-soft)]">
                    {safeLexiconPage * LEXICON_PAGE_SIZE + 1}–
                    {Math.min(lexicon.length, (safeLexiconPage + 1) * LEXICON_PAGE_SIZE)}{" "}
                    of {lexicon.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safeLexiconPage <= 0}
                      onClick={() => setLexiconPage((p) => Math.max(0, p - 1))}
                      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-[var(--ink-soft)]">
                      {safeLexiconPage + 1} / {lexiconPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={safeLexiconPage >= lexiconPageCount - 1}
                      onClick={() =>
                        setLexiconPage((p) => Math.min(lexiconPageCount - 1, p + 1))
                      }
                      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
          {persistState.error ? (
            <p className="text-xs text-[var(--warn)]">{persistState.error}</p>
          ) : null}
          {persistState.ok && !persistState.error ? (
            <p className="text-xs text-[var(--ok)]" role="status">
              Updated — next call will use it.
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
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <h3 className="font-medium text-[var(--ink)]">Heard something wrong?</h3>
              <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
                Type the word or a short sentence. Record it for the best fix, or
                save a typed “say like” spelling for a quick patch.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
                  placeholder="Muindi Mbingu / White Paper Books"
                  className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-[var(--ink-soft)]"
                  htmlFor="pron-add-say"
                >
                  Say like (for typed save)
                </label>
                <input
                  id="pron-add-say"
                  value={addSay}
                  onChange={(e) => {
                    setAddSay(e.target.value);
                    setAddError(null);
                  }}
                  placeholder="Moo-in-dee Mbeen-goo"
                  className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => submitQuickAdd("record")}
                disabled={!addPhrase.trim()}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-60"
              >
                Record it
              </button>
              <button
                type="button"
                onClick={() => submitQuickAdd("save")}
                disabled={!addPhrase.trim() || !addSay.trim() || quickPending}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-60"
              >
                {quickPending ? "Saving…" : "Save typed spelling"}
              </button>
            </div>
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
                Saved — next call will use it.
              </p>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-[var(--line)] pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-[var(--ink)]">From recent calls</h3>
                <p className="mt-0.5 text-sm text-[var(--ink-soft)]">
                  Finds hard names from recent agent lines (including lowercase ASR) and your profile places — queues them for Practice.
                </p>
              </div>
              <button
                type="button"
                onClick={scanCalls}
                disabled={minePending}
                className="rounded-xl border border-[var(--accent)]/40 px-4 py-2 text-sm font-medium text-[var(--accent-deep)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
              >
                {minePending ? "Scanning…" : "Scan recent calls"}
              </button>
            </div>
            {mineState.error ? (
              <p className="text-xs text-[var(--warn)]">{mineState.error}</p>
            ) : null}
            {mineState.ok ? (
              <p className="text-xs text-[var(--ink-soft)]" role="status">
                Scanned {mineState.scannedLines ?? 0} agent lines
                {mineState.suggestions?.length
                  ? ` · added ${mineState.suggestions.length} to Practice`
                  : " · nothing new to train"}
                .
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
