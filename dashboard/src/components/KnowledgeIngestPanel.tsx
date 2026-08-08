"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import type { IngestDraft } from "@/lib/ingest/extract";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/lib/faqs";
import {
  applyIngestAction,
  extractKnowledgeAction,
  type IngestApplyState,
  type IngestExtractState,
} from "@/app/(desk)/settings/ingestActions";

const fieldClass =
  "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[#0096FF]";

const extractInitial: IngestExtractState = {};
const applyInitial: IngestApplyState = {};

type SourceMode = "paste" | "url";

export function KnowledgeIngestPanel({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<SourceMode>("paste");
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<IngestDraft | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<number>>(new Set());
  const [selectedFaqs, setSelectedFaqs] = useState<Set<number>>(new Set());
  const [selectedTeam, setSelectedTeam] = useState<Set<number>>(new Set());
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const [mergeMode, setMergeMode] = useState<"merge" | "replace_services_faqs">("merge");

  const [extractState, extractAction, extractPending] = useActionState(
    extractKnowledgeAction,
    extractInitial
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyIngestAction,
    applyInitial
  );

  useEffect(() => {
    if (extractState.ok && extractState.draft) {
      setDraft(extractState.draft);
      setSelectedServices(new Set(extractState.draft.services.map((_, i) => i)));
      setSelectedFaqs(new Set(extractState.draft.faqs.map((_, i) => i)));
      setSelectedTeam(new Set(extractState.draft.team.map((_, i) => i)));
      setIncludeUnknown(Boolean(extractState.draft.unknownAnswerFallback));
    }
  }, [extractState]);

  useEffect(() => {
    if (applyState.ok) {
      setDraft(null);
      setPaste("");
      setUrl("");
      router.refresh();
    }
  }, [applyState, router]);

  const selectedServiceCsv = useMemo(
    () => [...selectedServices].sort((a, b) => a - b).join(","),
    [selectedServices]
  );
  const selectedFaqCsv = useMemo(
    () => [...selectedFaqs].sort((a, b) => a - b).join(","),
    [selectedFaqs]
  );
  const selectedTeamCsv = useMemo(
    () => [...selectedTeam].sort((a, b) => a - b).join(","),
    [selectedTeam]
  );

  function toggle(set: Set<number>, index: number, setter: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setter(next);
  }

  function updateDraftFaq(
    index: number,
    key: "question" | "answer",
    value: string
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      const faqs = prev.faqs.map((row, i) =>
        i === index ? { ...row, [key]: value } : row
      );
      return { ...prev, faqs };
    });
  }

  // While reviewing a draft, the extract tip already shows in the green box.
  const flash =
    applyState.error ||
    applyState.message ||
    (!draft ? extractState.error || extractState.message : extractState.error);
  const flashIsError = Boolean(applyState.error || extractState.error);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl tracking-tight text-[var(--ink)]">
          Import knowledge
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Paste a menu or drop a website link. We&apos;ll suggest services and FAQs —
          you tick what looks right before anything goes live.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-soft)]">
          Tip: set your weekly hours and tone of voice below once first — imports use
          those to retrain the receptionist.
        </p>
      </div>

      {!draft ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  id: "paste" as const,
                  label: "Paste text",
                  blurb: "Menu, prices, or FAQs from WhatsApp or a doc",
                },
                {
                  id: "url" as const,
                  label: "Website link",
                  blurb: "A public page that lists what you offer",
                },
              ] as const
            ).map((opt) => {
              const selected = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={[
                    "w-full rounded-xl border px-4 py-3 text-left transition",
                    selected
                      ? "border-[#0096FF] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_#0096FF]"
                      : "border-[var(--line)] bg-white hover:border-[#0096FF]/50",
                  ].join(" ")}
                >
                  <span className="font-medium text-[var(--ink)]">{opt.label}</span>
                  <span className="mt-1 block text-sm text-[var(--ink-soft)]">
                    {opt.blurb}
                  </span>
                </button>
              );
            })}
          </div>

          <form action={extractAction} className="space-y-3">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="source_mode" value={mode} />

            {mode === "paste" ? (
              <div>
                <label className="block text-sm font-medium" htmlFor="ingest_paste">
                  Paste your menu or FAQs
                </label>
                <textarea
                  id="ingest_paste"
                  name="paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={7}
                  placeholder={
                    "Home cleaning - from 2,500 KES\nPlumbing - call out 1,500\n\nQ: Do you cover Westlands?\nA: Yes, same-day when booked before noon."
                  }
                  className={`${fieldClass} leading-relaxed`}
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium" htmlFor="ingest_url">
                  Website link
                </label>
                <input
                  id="ingest_url"
                  name="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yourbusiness.co.ke/services"
                  className={fieldClass}
                />
                <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
                  Public pages only. If the scan is thin, paste the text instead.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={extractPending}
              className="rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {extractPending
                ? mode === "url"
                  ? "Opening page…"
                  : "Finding services…"
                : "Scan and suggest"}
            </button>
            {extractPending ? (
              <p className="text-xs text-[var(--ink-soft)]">
                {mode === "url"
                  ? "Usually under 10 seconds. If the site hides its menu in the browser, we’ll ask you to paste instead."
                  : "Usually a few seconds."}
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[#e8f4f1] px-4 py-3 text-sm text-[var(--ink)]">
            From <span className="font-medium">{draft.sourceLabel}</span>
            {extractState.message ? (
              <span className="mt-1 block text-[var(--ink-soft)]">{extractState.message}</span>
            ) : null}
          </div>

          {draft.services.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-[var(--ink)]">Services</h3>
                <button
                  type="button"
                  className="text-xs text-[#0096FF]"
                  onClick={() =>
                    setSelectedServices(
                      selectedServices.size === draft.services.length
                        ? new Set()
                        : new Set(draft.services.map((_, i) => i))
                    )
                  }
                >
                  {selectedServices.size === draft.services.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              </div>
              <ul className="space-y-2">
                {draft.services.map((s, i) => (
                  <li
                    key={`svc-${i}`}
                    className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedServices.has(i)}
                      onChange={() =>
                        toggle(selectedServices, i, setSelectedServices)
                      }
                      aria-label={`Keep service ${s.name}`}
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--ink)]">{s.name}</p>
                      {s.price_range ? (
                        <p className="text-sm text-[var(--ink-soft)]">{s.price_range}</p>
                      ) : null}
                      {s.notes ? (
                        <p className="text-sm text-[var(--ink-soft)]">{s.notes}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft.faqs.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-[var(--ink)]">FAQs</h3>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--accent-deep)]"
                  aria-label={
                    selectedFaqs.size === draft.faqs.length
                      ? `Clear all ${draft.faqs.length} FAQs`
                      : `Select all ${draft.faqs.length} FAQs`
                  }
                  onClick={() =>
                    setSelectedFaqs(
                      selectedFaqs.size === draft.faqs.length
                        ? new Set()
                        : new Set(draft.faqs.map((_, i) => i))
                    )
                  }
                >
                  {selectedFaqs.size === draft.faqs.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <ul className="space-y-2">
                {draft.faqs.map((f, i) => (
                  <li
                    key={`faq-${i}`}
                    className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedFaqs.has(i)}
                      onChange={() => toggle(selectedFaqs, i, setSelectedFaqs)}
                      aria-label={`Keep FAQ ${f.question || i + 1}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <label
                          className="block text-xs font-medium text-[var(--ink-soft)]"
                          htmlFor={`ingest-faq-q-${i}`}
                        >
                          Question
                        </label>
                        <input
                          id={`ingest-faq-q-${i}`}
                          value={f.question}
                          maxLength={FAQ_QUESTION_MAX}
                          onChange={(e) =>
                            updateDraftFaq(i, "question", e.target.value)
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[#0096FF]"
                        />
                      </div>
                      <div>
                        <label
                          className="block text-xs font-medium text-[var(--ink-soft)]"
                          htmlFor={`ingest-faq-a-${i}`}
                        >
                          Answer
                        </label>
                        <textarea
                          id={`ingest-faq-a-${i}`}
                          value={f.answer}
                          maxLength={FAQ_ANSWER_MAX}
                          rows={2}
                          onChange={(e) =>
                            updateDraftFaq(i, "answer", e.target.value)
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[#0096FF]"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft.team.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-[var(--ink)]">Team (optional)</h3>
              <ul className="space-y-2">
                {draft.team.map((t, i) => (
                  <li
                    key={`team-${i}`}
                    className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedTeam.has(i)}
                      onChange={() => toggle(selectedTeam, i, setSelectedTeam)}
                      aria-label={`Keep teammate ${t.name}`}
                    />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-[var(--ink)]">
                        {t.name}
                        {t.role ? ` · ${t.role}` : ""}
                      </p>
                      <p className="text-[var(--ink-soft)]">
                        {[t.phone, t.email].filter(Boolean).join(" · ") || "No contact yet"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft.unknownAnswerFallback ? (
            <label className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeUnknown}
                onChange={(e) => setIncludeUnknown(e.target.checked)}
              />
              <span>
                <span className="font-medium text-[var(--ink)]">
                  If we don&apos;t offer something, say:
                </span>
                <span className="mt-1 block text-[var(--ink-soft)]">
                  {draft.unknownAnswerFallback}
                </span>
              </span>
            </label>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink)]">
              Keep your current list, or start fresh?
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMergeMode("merge")}
                className={[
                  "rounded-xl border px-3 py-2.5 text-left text-sm",
                  mergeMode === "merge"
                    ? "border-[#0096FF] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] bg-white",
                ].join(" ")}
              >
                <span className="font-medium">Keep my current list</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                  Safe choice. We add the new ones you tick — nothing already
                  saved gets deleted.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMergeMode("replace_services_faqs")}
                className={[
                  "rounded-xl border px-3 py-2.5 text-left text-sm",
                  mergeMode === "replace_services_faqs"
                    ? "border-[#0096FF] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] bg-white",
                ].join(" ")}
              >
                <span className="font-medium">Start fresh</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                  Clears your old services &amp; FAQs. Only what you tick now
                  stays.
                </span>
              </button>
            </div>
          </div>

          <form action={applyAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="draft_json" value={JSON.stringify(draft)} />
            <input type="hidden" name="selected_services" value={selectedServiceCsv} />
            <input type="hidden" name="selected_faqs" value={selectedFaqCsv} />
            <input type="hidden" name="selected_team" value={selectedTeamCsv} />
            <input type="hidden" name="merge_mode" value={mergeMode} />
            <input
              type="hidden"
              name="include_unknown"
              value={includeUnknown ? "1" : "0"}
            />
            <button
              type="submit"
              disabled={
                applyPending ||
                (selectedServices.size === 0 &&
                  selectedFaqs.size === 0 &&
                  selectedTeam.size === 0 &&
                  !includeUnknown)
              }
              className="rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {applyPending ? "Adding…" : "Add to my receptionist"}
            </button>
            <button
              type="button"
              disabled={applyPending}
              onClick={() => setDraft(null)}
              className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink-soft)]"
            >
              Start over
            </button>
          </form>
        </div>
      )}

      {flash ? (
        <p
          className={[
            "text-sm",
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
