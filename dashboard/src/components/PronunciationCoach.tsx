"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmPronunciationRecording,
  screenPronunciationSuggestionsAction,
  type ConfirmPronunciationState,
  type ScreenPronunciationState,
} from "@/app/(desk)/settings/pronunciationActions";
import {
  lexiconForStorage,
  parseTtsLexicon,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import {
  isPronunciationCovered,
  suggestPronunciations,
  type PronunciationSuggestion,
} from "@/lib/pronunciationSuggest";

type CoachItem = PronunciationSuggestion & {
  status: "todo" | "done" | "skipped";
};

const confirmInitial: ConfirmPronunciationState = {};
const screenInitial: ScreenPronunciationState = {};

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || "audio/webm" });
}

export function PronunciationCoach({
  tenantId,
  businessName,
  agentName,
  locationNotes,
  locations,
  team,
  services,
  faqs,
  bulletinTexts,
  initialLexicon,
  onLexiconChange,
}: {
  tenantId: string;
  businessName: string;
  agentName: string;
  locationNotes: string;
  locations: Array<{
    label: string;
    address: string;
    landmark: string;
    directions: string;
    coverage_notes?: string;
  }>;
  team: Array<{ name: string; role: string }>;
  services: Array<{ name: string }>;
  faqs: Array<{ question: string; answer: string }>;
  bulletinTexts?: string[];
  initialLexicon: TtsLexiconEntry[];
  onLexiconChange: (entries: TtsLexiconEntry[]) => void;
}) {
  const [lexicon, setLexicon] = useState<TtsLexiconEntry[]>(() =>
    parseTtsLexicon(initialLexicon)
  );
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<
    PronunciationSuggestion[] | null
  >(null);
  const [screenNote, setScreenNote] = useState<string | null>(null);
  const screenedKeyRef = useRef<string>("");

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
  const [screenState, screenAction, screenPending] = useActionState(
    screenPronunciationSuggestionsAction,
    screenInitial
  );

  const profileKey = useMemo(
    () =>
      JSON.stringify({
        businessName,
        agentName,
        locationNotes,
        locations,
        team: team.map((t) => t.name),
        services: services.map((s) => s.name),
        faqs: faqs.map((f) => f.question),
        bulletinTexts,
      }),
    [
      businessName,
      agentName,
      locationNotes,
      locations,
      team,
      services,
      faqs,
      bulletinTexts,
    ]
  );

  const localSuggestions = useMemo(
    () =>
      suggestPronunciations({
        businessName,
        agentName,
        locationNotes,
        locations,
        team,
        services,
        faqs,
        bulletinTexts,
        existingLexicon: lexicon,
      }),
    [
      businessName,
      agentName,
      locationNotes,
      locations,
      team,
      services,
      faqs,
      bulletinTexts,
      lexicon,
    ]
  );

  const suggestions = aiSuggestions ?? localSuggestions;

  const lexiconJson = useMemo(
    () => JSON.stringify(lexiconForStorage(lexicon)),
    [lexicon]
  );

  // AI-screen suggestions when profile settles (drops obvious words, prefers sentences).
  useEffect(() => {
    const key = `${tenantId}:${profileKey}:${lexiconJson}`;
    if (screenedKeyRef.current === key) return;
    const timer = window.setTimeout(() => {
      if (screenedKeyRef.current === key) return;
      screenedKeyRef.current = key;
      const fd = new FormData();
      fd.set("id", tenantId);
      fd.set("business_name", businessName);
      fd.set("agent_name", agentName);
      fd.set("location_notes", locationNotes);
      fd.set("locations", JSON.stringify(locations));
      fd.set("team", JSON.stringify(team));
      fd.set("services", JSON.stringify(services));
      fd.set("faqs", JSON.stringify(faqs));
      fd.set("bulletin_texts", JSON.stringify(bulletinTexts || []));
      fd.set("current_lexicon", lexiconJson);
      screenAction(fd);
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- screen when profile/lexicon identity changes
  }, [tenantId, profileKey, lexiconJson]);

  useEffect(() => {
    if (screenState.ok && Array.isArray(screenState.suggestions)) {
      setAiSuggestions(screenState.suggestions);
      setScreenNote(
        screenState.source === "gemini"
          ? "Suggestions screened by AI — obvious words removed."
          : "Basic suggestions (AI screen unavailable)."
      );
    }
    if (screenState.error && !screenState.ok) {
      setScreenNote(screenState.error);
    }
  }, [screenState]);

  const items: CoachItem[] = useMemo(() => {
    return suggestions.map((s) => ({
      ...s,
      status: skippedIds.has(s.id)
        ? "skipped"
        : isPronunciationCovered(s, lexicon)
          ? "done"
          : "todo",
    }));
  }, [suggestions, skippedIds, lexicon]);

  const todoItems = items.filter((i) => i.status === "todo");
  const active =
    items.find((i) => i.id === activeId && i.status === "todo") ||
    todoItems[0] ||
    null;

  useEffect(() => {
    if (active && active.id !== activeId) {
      setActiveId(active.id);
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
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
          Pronunciation coach
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Record short natural sentences — greetings, places, team names — not one
          word at a time. AI screens out obvious words. If you say something else,
          we ask you to try again.
        </p>
        {screenPending ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]" aria-live="polite">
            Screening suggestions…
          </p>
        ) : screenNote ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]" aria-live="polite">
            {screenNote}
          </p>
        ) : null}
        {items.length > 0 ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]" aria-live="polite">
            {doneCount} of {totalFocus} lines trained
            {skippedIds.size ? ` · ${skippedIds.size} skipped` : ""}
          </p>
        ) : null}
      </div>

      {!items.length ? (
        <p className="text-sm text-[var(--ink-soft)]">
          {lexicon.length
            ? "All suggested lines are trained. Update your business details above if new names appear."
            : "Add your business name, places, or team above — sentence suggestions will show up here."}
        </p>
      ) : (
        <div className="space-y-6">
          {active ? (
            <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white via-[var(--accent-soft)]/40 to-white px-5 py-6 sm:px-7">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                Say this full line
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
                  Trains:{" "}
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
                  Saved {confirmState.entries.length} pronunciation
                  {confirmState.entries.length === 1 ? "" : "s"} from this line.
                  Next call will use them.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--ok)]" role="status">
              Nice — suggested lines are done. Save &amp; train below when you’re ready.
            </p>
          )}

          <ul className="space-y-2" aria-label="Suggested pronunciation lines">
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
                      <span className="block font-medium text-[var(--ink)]">
                        {item.prompt}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                        {(item.targets || []).map((t) => t.label).join(" · ") ||
                          item.reason}
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
            <details className="text-sm text-[var(--ink-soft)]">
              <summary className="cursor-pointer font-medium text-[var(--ink)]">
                Trained pronunciations ({lexicon.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {lexicon.map((entry) => (
                  <li
                    key={entry.match}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] py-2"
                  >
                    <span className="text-[var(--ink)]">
                      {entry.label || entry.match}
                    </span>
                    <span className="font-mono text-xs text-[var(--ink-soft)]">
                      → {entry.say}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
