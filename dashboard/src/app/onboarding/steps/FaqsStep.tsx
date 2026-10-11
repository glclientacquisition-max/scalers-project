"use client";

import { deskShiftClass } from "@/components/ui/deskChrome";
import { useRef } from "react";
import { LIMITS, suggestedQuestions, type Vertical, type FaqsStep as Value, type FieldErrors } from "@/lib/setupFlow";
import { TextButton } from "./ui";
import { FieldCard, TextAreaField, TextField } from "@/components/ui/TextField";

export function FaqsStep({
  value,
  onChange,
  errors,
  vertical,
}: {
  value: Value;
  onChange: (v: Value) => void;
  errors: FieldErrors;
  vertical: Vertical;
}) {
  const items = value.items;
  const focusIndex = useRef<number | null>(null);
  const set = (next: Value["items"]) => onChange({ skipped: false, items: next });
  const has = (q: string) => items.some((i) => i.question.trim().toLowerCase() === q.toLowerCase());
  const add = (question = "") => {
    if (items.length >= LIMITS.faqItems) return;
    focusIndex.current = items.length;
    set([...items, { question, answer: "" }]);
  };

  return (
    <>
      <div className="mt-6">
        <p className="px-4 text-meta text-ink-2">Questions callers often ask</p>
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          {suggestedQuestions(vertical).map((q) => (
            <button
              key={q}
              type="button"
              disabled={has(q)}
              onClick={() => add(q)}
              className={`min-h-11 rounded-md bg-surface px-4 text-meta font-medium text-ink ${deskShiftClass} hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <ol className="mt-6 space-y-4" aria-label="Your answers">
        {items.map((item, i) => {
          const qErr = errors[`items.${i}.question`];
          const aErr = errors[`items.${i}.answer`];
          return (
            <li key={i} data-faq-card="">
              <FieldCard
                title={`Question ${i + 1}`}
                action={
                  <TextButton tone="danger" label={`Remove question ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}>
                    Remove
                  </TextButton>
                }
              >
                <TextField
                  id={`faq-${i}-q`}
                  data-field={`items.${i}.question`}
                  label={<>Question<span className="sr-only"> {i + 1}</span></>}
                  value={item.question}
                  maxLength={LIMITS.question}
                  error={qErr}
                  onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                />
                <TextAreaField
                  id={`faq-${i}-a`}
                  data-field={`items.${i}.answer`}
                  label={<>Answer<span className="sr-only"> to question {i + 1}</span></>}
                  value={item.answer}
                  rows={3}
                  maxLength={LIMITS.answer}
                  error={aErr}
                  autoFocus={focusIndex.current === i && Boolean(item.question) && !item.answer}
                  onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                />
              </FieldCard>
            </li>
          );
        })}
      </ol>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => add()}
          disabled={items.length >= LIMITS.faqItems}
          className="min-h-11 rounded-xl bg-surface px-4 text-body font-medium text-accent-deep hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Add your own question
        </button>
      </div>
      <p className="mt-4 px-1 text-meta text-ink-2">
        Your Business Assistant already knows your hours, prices and location. Add anything else callers ask.
      </p>
    </>
  );
}
