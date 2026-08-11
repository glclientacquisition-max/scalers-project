"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmPronunciationRecording,
  persistPronunciationLexicon,
  type ConfirmPronunciationState,
} from "@/app/(desk)/settings/pronunciationActions";
import {
  lexiconForStorage,
  parseTtsLexicon,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
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

const confirmInitial: ConfirmPronunciationState = {};

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
}) {
  const rawInitialCount = Array.isArray(initialLexicon)
    ? initialLexicon.length
    : 0;
  const [lexicon, setLexicon] = useState<TtsLexiconEntry[]>(() =>
    parseTtsLexicon(initialLexicon)
  );
  const [cleanNote, setCleanNote] = useState<string | null>(null);
  const cleanedOnceRef = useRef(false);

  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const lexiconJson = useMemo(
    () => JSON.stringify(lexiconForStorage(lexicon)),
    [lexicon]
  );

  // Auto-scrub polluted lexicon on open (common-word overrides).
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

  const items: CoachItem[] = useMemo(() => {
    return packs.map((s) => ({
      ...s,
      status: skippedIds.has(s.id)
        ? "skipped"
        : isPronunciationCovered(s, lexicon)
          ? "done"
          : "todo",
    }));
  }, [packs, skippedIds, lexicon]);

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
    }
  }, [confirmState]);

  useEffect(() => {
    return () => {
      stopStream();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const fd = new FormData();
    fd.set("id", tenantId);
    fd.set("tts_lexicon", JSON.stringify(lexiconForStorage(next)));
    persistAction(fd);
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

  const doneCount = items.filter((i) => i.status === "done").length;
  const totalFocus = items.filter((i) => i.status !== "skipped").length;
  const showMismatch = Boolean(confirmState.error && !confirmState.ok);

  return (
    <section
      id="pronunciation-coach"
      className="space-y-5 border-t border-[var(--line)] pt-8"
      aria-labelledby="pronunciation-coach-heading"
    >
      <input type="hidden" name="tts_lexicon" value={lexiconJson} />

      <div>
        <h2
          id="pronunciation-coach-heading"
          className="font-display text-2xl tracking-tight text-[var(--ink)]"
        >
          Pronunciation studio
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Train only the hard names — greeting, place, team — as full sentences.{" "}
          <span className="font-medium text-[var(--ink)]">
            Keep saves for the next call immediately
          </span>
          . Save &amp; train below is for the receptionist prompt, not required for Keep.
        </p>
        {cleanNote ? (
          <p className="mt-2 text-xs text-[var(--ok)]" role="status">
            {cleanNote}
          </p>
        ) : null}
        {items.length > 0 ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]" aria-live="polite">
            {doneCount} of {totalFocus} packs trained
            {skippedIds.size ? ` · ${skippedIds.size} skipped` : ""}
          </p>
        ) : null}
      </div>

      {greetingPreview ? (
        <div className="rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            Phone preview (greeting)
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink)]">
            {greetingPreview}
          </p>
        </div>
      ) : null}

      {!items.length ? (
        <p className="text-sm text-[var(--ink-soft)]">
          {lexicon.length
            ? "Core packs are trained. Refresh after you change business name, places, or team."
            : "Add business name, agent name, and a location above — packs appear here."}
        </p>
      ) : (
        <div className="space-y-6">
          {active ? (
            <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white via-[var(--accent-soft)]/40 to-white px-5 py-6 sm:px-7">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                {active.label} pack · say this full line
              </p>
              <p
                className="mt-3 font-display text-2xl leading-snug tracking-tight text-[var(--ink)] sm:text-3xl"
                aria-live="polite"
              >
                {active.prompt}
              </p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{active.reason}</p>
              {active.targets?.length ? (
                <p className="mt-3 text-xs text-[var(--ink-soft)]">
                  Learns only:{" "}
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
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-deep)] focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full bg-white"
                    />
                    Record line
                  </button>
                ) : null}

                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--warn)] px-5 py-3 text-sm font-medium text-white transition focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 animate-pulse rounded-sm bg-white"
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
                      className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)]"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={keepRecording}
                      disabled={confirmPending}
                      className="rounded-xl bg-[var(--ok)] px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
                    >
                      {confirmPending ? "Checking…" : "Keep"}
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={skipActive}
                  className="text-sm text-[var(--ink-soft)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
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
              {confirmState.ok && confirmState.entries?.length ? (
                <p className="mt-3 text-sm text-[var(--ok)]" role="status">
                  Saved {confirmState.entries.length} name
                  {confirmState.entries.length === 1 ? "" : "s"} from this pack.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--ok)]" role="status">
              Core packs done. Preview above shows how the greeting will read on the phone.
            </p>
          )}

          <ul className="space-y-2" aria-label="Pronunciation packs">
            {items.map((item) => {
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
                      "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
                      item.status === "done" ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block font-medium text-[var(--ink)]">
                        {item.prompt}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                        {(item.targets || []).map((t) => t.label).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
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

          {lexicon.length > 0 ? (
            <details className="text-sm text-[var(--ink-soft)]" open>
              <summary className="cursor-pointer font-medium text-[var(--ink)]">
                Live pronunciations ({lexicon.length}) — next call
              </summary>
              <ul className="mt-3 space-y-2">
                {lexicon.map((entry) => (
                  <li
                    key={entry.match}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-[var(--ink)]">
                        {entry.label || entry.match}
                      </span>
                      <span className="font-mono text-xs text-[var(--ink-soft)]">
                        phone says → {entry.say}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeEntry(entry.match)}
                      disabled={persistPending}
                      className="text-xs text-[var(--warn)] hover:underline disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {persistState.error ? (
                <p className="mt-2 text-xs text-[var(--warn)]">{persistState.error}</p>
              ) : null}
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
