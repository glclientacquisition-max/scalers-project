"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/lib/faqs";
import type { FaqSuggestion } from "@/lib/faqFromTranscript";
import {
  applyFaqSuggestionsAction,
  suggestFaqsFromCallAction,
  type FaqApplyState,
  type FaqSuggestState,
} from "@/app/(desk)/calls/faqActions";

const fieldClass =
  "mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[#0096FF]";

const suggestInitial: FaqSuggestState = {};
const applyInitial: FaqApplyState = {};

type EditableSuggestion = FaqSuggestion & { selected: boolean };

export function CallFaqSuggestions({
  tenantId,
  callId,
  hasTranscript,
}: {
  tenantId: string;
  callId: string;
  hasTranscript: boolean;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [items, setItems] = useState<EditableSuggestion[] | null>(null);

  const [suggestState, suggestAction, suggestPending] = useActionState(
    suggestFaqsFromCallAction,
    suggestInitial
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyFaqSuggestionsAction,
    applyInitial
  );

  useEffect(() => {
    if (suggestState.ok && Array.isArray(suggestState.suggestions)) {
      setItems(
        suggestState.suggestions.map((s) => ({
          ...s,
          selected: !s.needsOwnerAnswer && Boolean(s.answer),
        }))
      );
    }
  }, [suggestState]);

  useEffect(() => {
    if (items) {
      resultsHeadingRef.current?.focus();
    }
  }, [items]);

  useEffect(() => {
    if (applyState.ok) {
      setItems(null);
      router.refresh();
    }
  }, [applyState, router]);

  const faqsJson = useMemo(() => {
    if (!items) return "[]";
    return JSON.stringify(
      items
        .filter((i) => i.selected)
        .map((i) => ({
          question: i.question.trim(),
          answer: i.answer.trim(),
        }))
        .filter((i) => i.question && i.answer)
    );
  }, [items]);

  const selectedReady = useMemo(() => {
    if (!items) return 0;
    return items.filter((i) => i.selected && i.question.trim() && i.answer.trim())
      .length;
  }, [items]);

  function updateItem(index: number, patch: Partial<EditableSuggestion>) {
    setItems((prev) => {
      if (!prev) return prev;
      return prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if ("answer" in patch) {
          next.needsOwnerAnswer = !String(patch.answer || "").trim();
          if (next.needsOwnerAnswer) next.selected = false;
        }
        return next;
      });
    });
  }

  const flash =
    applyState.error ||
    applyState.message ||
    suggestState.error ||
    (!items ? suggestState.message : null);
  const flashIsError = Boolean(applyState.error || suggestState.error);

  return (
    <section
      ref={panelRef}
      className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
      aria-labelledby="call-faq-heading"
    >
      <div>
        <h2
          id="call-faq-heading"
          className="font-display text-2xl tracking-tight"
        >
          FAQ ideas from this call
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]" id="call-faq-help">
          If the caller asked something useful, we&apos;ll suggest a Golden FAQ. You
          edit and approve — nothing goes live on its own.
        </p>
      </div>

      {!items ? (
        <form action={suggestAction} className="mt-4">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <input type="hidden" name="call_id" value={callId} />
          <button
            type="submit"
            disabled={suggestPending || !hasTranscript}
            aria-describedby={
              !hasTranscript ? "call-faq-no-transcript" : "call-faq-help"
            }
            className="rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
          >
            {suggestPending ? "Looking through the call…" : "Find FAQ ideas"}
          </button>
          {!hasTranscript ? (
            <p
              id="call-faq-no-transcript"
              className="mt-2 text-xs text-[var(--ink-soft)]"
            >
              Needs a conversation transcript first.
            </p>
          ) : suggestPending ? (
            <p className="mt-2 text-xs text-[var(--ink-soft)]" aria-live="polite">
              Usually a few seconds.
            </p>
          ) : null}
        </form>
      ) : items.length === 0 ? (
        <div className="mt-4 space-y-3">
          <h3
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-sm font-medium text-[var(--ink)] outline-none"
          >
            Results
          </h3>
          <p className="text-sm text-[var(--ink-soft)]">
            {suggestState.message || "No new FAQ ideas from this call."}
          </p>
          <button
            type="button"
            onClick={() => setItems(null)}
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink-soft)]"
          >
            Back
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <h3
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="sr-only outline-none"
          >
            FAQ suggestions ready to review
          </h3>
          {suggestState.message ? (
            <p
              className="rounded-xl border border-[var(--accent)]/30 bg-[#e8f4f1] px-4 py-3 text-sm text-[var(--ink)]"
              role="status"
            >
              {suggestState.message}
            </p>
          ) : null}

          <ul className="space-y-3">
            {items.map((item, index) => {
              const answerId = `faq-a-${index}`;
              const questionId = `faq-q-${index}`;
              const reasonId = `faq-reason-${index}`;
              const warnId = `faq-warn-${index}`;
              const incomplete = item.selected && !item.answer.trim();
              return (
                <li
                  key={`faq-idea-${index}`}
                  className="rounded-xl border border-[var(--line)] bg-white px-3 py-3"
                >
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={item.selected}
                      disabled={item.needsOwnerAnswer && !item.answer.trim()}
                      onChange={(e) =>
                        updateItem(index, { selected: e.target.checked })
                      }
                      aria-labelledby={`${questionId}-label`}
                      aria-describedby={[reasonId, item.needsOwnerAnswer ? warnId : null]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p id={reasonId} className="text-xs text-[var(--ink-soft)]">
                        {item.reason}
                      </p>
                      {item.needsOwnerAnswer ? (
                        <p
                          id={warnId}
                          className="text-xs font-medium text-[var(--warn)]"
                          role="status"
                        >
                          Fill in your answer before adding
                        </p>
                      ) : null}
                      <div>
                        <label
                          id={`${questionId}-label`}
                          className="block text-xs font-medium text-[var(--ink-soft)]"
                          htmlFor={questionId}
                        >
                          Question callers ask
                        </label>
                        <input
                          id={questionId}
                          value={item.question}
                          maxLength={FAQ_QUESTION_MAX}
                          onChange={(e) =>
                            updateItem(index, { question: e.target.value })
                          }
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label
                          className="block text-xs font-medium text-[var(--ink-soft)]"
                          htmlFor={answerId}
                        >
                          What the receptionist should say
                        </label>
                        <textarea
                          id={answerId}
                          value={item.answer}
                          maxLength={FAQ_ANSWER_MAX}
                          onChange={(e) =>
                            updateItem(index, { answer: e.target.value })
                          }
                          rows={2}
                          placeholder="Write the answer you want used on the next call"
                          aria-invalid={incomplete || undefined}
                          aria-describedby={incomplete ? `${answerId}-err` : undefined}
                          className={`${fieldClass} leading-relaxed`}
                        />
                        {incomplete ? (
                          <p
                            id={`${answerId}-err`}
                            className="mt-1 text-xs text-[var(--warn)]"
                            role="alert"
                          >
                            Add an answer, or untick this FAQ.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <form action={applyAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="faqs_json" value={faqsJson} />
            <button
              type="submit"
              disabled={applyPending || selectedReady === 0}
              aria-describedby="call-faq-add-help"
              className="rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {applyPending
                ? "Adding…"
                : selectedReady === 1
                  ? "Add 1 FAQ"
                  : `Add ${selectedReady} FAQs`}
            </button>
            <button
              type="button"
              disabled={applyPending}
              onClick={() => setItems(null)}
              className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink-soft)]"
            >
              Start over
            </button>
            <p id="call-faq-add-help" className="w-full text-xs text-[var(--ink-soft)]">
              {selectedReady === 0
                ? "Tick a FAQ with both a question and answer to enable Add."
                : "Selected FAQs are added to your Golden FAQs for the next call."}
            </p>
          </form>
        </div>
      )}

      {flash ? (
        <p
          className={[
            "mt-3 text-sm",
            flashIsError ? "text-[var(--warn)]" : "text-[var(--accent-deep)]",
          ].join(" ")}
          role={flashIsError ? "alert" : "status"}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}
