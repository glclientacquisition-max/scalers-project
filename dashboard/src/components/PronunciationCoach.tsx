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
  lexiconForStorage,
  parseTtsLexicon,
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

const confirmInitial: ConfirmPronunciationState = {};
const mineInitial: MinePronunciationState = {};

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

  const [extraItems, setExtraItems] = useState<PronunciationSuggestion[]>([]);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const [addPhrase, setAddPhrase] = useState("");
  const [addSay, setAddSay] = useState("");

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
    }
  }, [mineState]);

  useEffect(() => {
    if (quickState.ok && quickState.lexicon) {
      setLexicon(parseTtsLexicon(quickState.lexicon));
      setAddPhrase("");
      setAddSay("");
    }
  }, [quickState]);

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
      // Drop completed custom/mine items from extra queue
      setExtraItems((prev) =>
        prev.filter((p) => !isPronunciationCovered(p, confirmState.lexicon || []))
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

  function renewEntry(entry: TtsLexiconEntry) {
    const phrase = entry.label || entry.say || entry.match;
    const line = customTrainingLine({
      phrase,
      idPrefix: "renew",
      reason: `Renew “${entry.say}” — record a clearer take.`,
    });
    if (!line) return;
    // Force re-train even if covered: temporarily remove from coverage by using renew id
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
    clearTake();
  }

  function queueCustomPhrase(phrase: string, asRecord: boolean) {
    const line = customTrainingLine({
      phrase,
      idPrefix: "custom",
      reason: "You flagged this as sounding wrong.",
    });
    if (!line) return false;
    if (asRecord) {
      setExtraItems((prev) => {
        const without = prev.filter((p) => p.id !== line.id);
        return [line, ...without];
      });
      setActiveId(line.id);
      clearTake();
    }
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

  function submitQuickAdd(mode: "record" | "save") {
    const phrase = addPhrase.trim();
    if (!phrase) return;
    if (mode === "record") {
      if (!queueCustomPhrase(phrase, true)) {
        return;
      }
      setAddPhrase("");
      setAddSay("");
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
          See what is trained, renew a name, add anything you heard wrong, or scan
          recent calls for hard words.{" "}
          <span className="font-medium text-[var(--ink)]">
            Keep / Save word apply on the next call
          </span>
          .
        </p>
        {cleanNote ? (
          <p className="mt-2 text-xs text-[var(--ok)]" role="status">
            {cleanNote}
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

      {/* Trained library */}
      <div className="rounded-xl border border-[var(--line)] bg-white px-4 py-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-medium text-[var(--ink)]">
              Trained pronunciations ({lexicon.length})
            </h3>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              Live on the next call. Renew to re-record, or remove.
            </p>
          </div>
        </div>
        {lexicon.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            Nothing trained yet — use packs below or add a word you heard wrong.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {lexicon.map((entry) => (
              <li
                key={entry.match}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] py-2 last:border-0"
              >
                <span className="min-w-0">
                  <span className="block text-[var(--ink)]">
                    {entry.label || entry.match}
                  </span>
                  <span className="font-mono text-xs text-[var(--ink-soft)]">
                    phone says → {entry.say}
                  </span>
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
                    onClick={() => removeEntry(entry.match)}
                    disabled={persistPending}
                    className="text-xs text-[var(--warn)] hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {persistState.error ? (
          <p className="mt-2 text-xs text-[var(--warn)]">{persistState.error}</p>
        ) : null}
      </div>

      {/* Add heard wrong */}
      <div className="rounded-xl border border-[var(--line)] bg-white px-4 py-4">
        <h3 className="font-medium text-[var(--ink)]">
          Heard something wrong?
        </h3>
        <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
          Type the word or a short sentence, then record it — or save a typed “say
          like” spelling for a quick fix.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor="pron-add-phrase">
              Word or sentence
            </label>
            <input
              id="pron-add-phrase"
              value={addPhrase}
              onChange={(e) => setAddPhrase(e.target.value)}
              placeholder="Muindi Mbingu / White Paper Books"
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor="pron-add-say">
              Say like (optional quick fix)
            </label>
            <input
              id="pron-add-say"
              value={addSay}
              onChange={(e) => setAddSay(e.target.value)}
              placeholder="Moo-in-dee Mbeen-goo"
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => submitQuickAdd("record")}
            disabled={!addPhrase.trim()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-60"
          >
            Queue to record
          </button>
          <button
            type="button"
            onClick={() => submitQuickAdd("save")}
            disabled={!addPhrase.trim() || quickPending}
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-60"
          >
            {quickPending ? "Saving…" : "Save typed spelling"}
          </button>
        </div>
        {quickState.error ? (
          <p className="mt-2 text-xs text-[var(--warn)]" role="alert">
            {quickState.error}
          </p>
        ) : null}
        {quickState.ok ? (
          <p className="mt-2 text-xs text-[var(--ok)]" role="status">
            Saved — next call will use it.
          </p>
        ) : null}
      </div>

      {/* Mine from calls */}
      <div className="rounded-xl border border-[var(--line)] bg-white px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-[var(--ink)]">From recent calls</h3>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              Finds complicated names the receptionist already said — queue them to
              train.
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
          <p className="mt-2 text-xs text-[var(--warn)]">{mineState.error}</p>
        ) : null}
        {mineState.ok ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]" role="status">
            Scanned {mineState.scannedLines ?? 0} agent lines
            {mineState.suggestions?.length
              ? ` · added ${mineState.suggestions.length} to the queue`
              : " · nothing new to train"}
            .
          </p>
        ) : null}
      </div>

      {/* Training queue */}
      <div>
        <h3 className="font-medium text-[var(--ink)]">Training queue</h3>
        <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
          Core packs plus anything you added or mined
          {totalFocus ? ` · ${doneCount} of ${totalFocus} done` : ""}.
        </p>
      </div>

      {!todoItems.length && !active ? (
        <p className="text-sm text-[var(--ink-soft)]">
          Queue empty. Add a word you heard wrong, renew a trained name, or scan
          calls.
        </p>
      ) : (
        <div className="space-y-6">
          {active ? (
            <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-white via-[var(--accent-soft)]/40 to-white px-5 py-6 sm:px-7">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                {active.label} · say this full line
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
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-deep)]"
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
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--warn)] px-5 py-3 text-sm font-medium text-white"
                  >
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
                      {confirmPending ? "Checking…" : "Keep"}
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
              {confirmState.ok && confirmState.entries?.length ? (
                <p className="mt-3 text-sm text-[var(--ok)]" role="status">
                  Saved {confirmState.entries.length} pronunciation
                  {confirmState.entries.length === 1 ? "" : "s"}.
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className="space-y-2" aria-label="Training queue">
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
        </div>
      )}
    </section>
  );
}
