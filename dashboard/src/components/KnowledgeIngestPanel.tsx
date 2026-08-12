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
  "mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-accent focus-visible:shadow-focus";

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
  const [includeLocations, setIncludeLocations] = useState(true);
  const [includeHours, setIncludeHours] = useState(true);
  const [includePolicies, setIncludePolicies] = useState(true);
  const [includeVertical, setIncludeVertical] = useState(true);
  const [includeContactPhone, setIncludeContactPhone] = useState(true);
  const [renameBusiness, setRenameBusiness] = useState(false);
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
      setIncludeLocations(Boolean(extractState.draft.locations?.length));
      setIncludeHours(
        Boolean(extractState.draft.hoursNotes || extractState.draft.hoursSchedule)
      );
      setIncludePolicies(
        Boolean(
          extractState.draft.policies &&
            Object.values(extractState.draft.policies).some((v) =>
              String(v || "").trim()
            )
        )
      );
      setIncludeVertical(Boolean(extractState.draft.vertical));
      setIncludeContactPhone(Boolean(extractState.draft.contactPhone));
      setRenameBusiness(false);
      // For a full business brief, default to start fresh so headings/junk don't linger.
      const looksLikeBrief =
        Boolean(extractState.draft.locations?.length) ||
        Boolean(extractState.draft.hoursNotes) ||
        (extractState.draft.faqs?.length || 0) >= 3;
      setMergeMode(looksLikeBrief ? "replace_services_faqs" : "merge");
    }
  }, [extractState]);

  useEffect(() => {
    if (applyState.ok) {
      setDraft(null);
      setPaste("");
      setUrl("");
      router.refresh();
      // Bring Train into view so the remounted form is obvious.
      window.setTimeout(() => {
        document.getElementById("train")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 250);
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
          Paste a menu, FAQ list, or short overview. We suggest services, FAQs,
          hours, location, and policies.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-soft)]">
          Tip: for shops, paste a full overview. Location, hours, and delivery map
          into Train (not as fake services). Review under Train after adding.
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
                  blurb: "Menu, business overview, or FAQs from WhatsApp or a doc",
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
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent)]"
                      : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
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
                  Paste your menu, overview, or FAQs
                </label>
                <textarea
                  id="ingest_paste"
                  name="paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={7}
                  placeholder={
                    "ChapterOne Bookstore, Nairobi CBD\nMon-Sat 9am-7pm\nSame-day Nairobi delivery\n\nOr a menu:\nHome cleaning - from 2,500 KES\n\nQ: Do you cover Westlands?\nA: Yes, same-day when booked before noon."
                  }
                  className={`${fieldClass} leading-relaxed`}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={extractPending}
                    className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
                  >
                    {extractPending ? "Finding services…" : "Scan and suggest"}
                  </button>
                </div>
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
                <div className="mt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={extractPending}
                    className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
                  >
                    {extractPending ? "Opening page…" : "Scan and suggest"}
                  </button>
                </div>
              </div>
            )}

            {extractPending ? (
              <p className="text-right text-xs text-[var(--ink-soft)]">
                {mode === "url"
                  ? "Usually under 10 seconds. If the site hides its menu, paste instead."
                  : "Usually a few seconds."}
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-[var(--accent)]/30 bg-accent-soft px-4 py-3 text-sm text-[var(--ink)]">
            From <span className="font-medium">{draft.sourceLabel}</span>
            {extractState.message ? (
              <span className="mt-1 block text-[var(--ink-soft)]">{extractState.message}</span>
            ) : null}
          </div>

          {(draft.vertical ||
            draft.businessNameSuggestion ||
            draft.locations?.length ||
            draft.hoursNotes ||
            draft.hoursSchedule ||
            draft.contactPhone ||
            (draft.policies &&
              Object.values(draft.policies).some((v) =>
                String(v || "").trim()
              ))) ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-[var(--ink)]">
                Business details
              </h3>
              <ul className="space-y-2">
                {draft.businessNameSuggestion ? (
                  <li className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={renameBusiness}
                      onChange={(e) => setRenameBusiness(e.target.checked)}
                      aria-label="Rename business from import"
                    />
                    <span>
                      <span className="font-medium text-[var(--ink)]">
                        Rename business to
                      </span>
                      <span className="mt-0.5 block text-[var(--ink-soft)]">
                        {draft.businessNameSuggestion}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--ink-soft)]">
                        Off by default so we don&apos;t overwrite the wrong workspace.
                      </span>
                    </span>
                  </li>
                ) : null}
                {draft.vertical ? (
                  <li className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={includeVertical}
                      onChange={(e) => setIncludeVertical(e.target.checked)}
                      aria-label="Apply business type"
                    />
                    <span>
                      <span className="font-medium text-[var(--ink)]">
                        Business type
                      </span>
                      <span className="mt-0.5 block text-[var(--ink-soft)]">
                        {draft.vertical}
                      </span>
                    </span>
                  </li>
                ) : null}
                {draft.locations?.length ? (
                  <li className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={includeLocations}
                      onChange={(e) => setIncludeLocations(e.target.checked)}
                      aria-label="Apply location"
                    />
                    <span>
                      <span className="font-medium text-[var(--ink)]">
                        Location
                      </span>
                      {draft.locations.map((loc, i) => (
                        <span
                          key={`loc-${i}`}
                          className="mt-0.5 block text-[var(--ink-soft)]"
                        >
                          {[loc.label, loc.address, loc.landmark, loc.coverage_notes]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ))}
                    </span>
                  </li>
                ) : null}
                {draft.hoursNotes || draft.hoursSchedule ? (
                  <li className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={includeHours}
                      onChange={(e) => setIncludeHours(e.target.checked)}
                      aria-label="Apply hours"
                    />
                    <span>
                      <span className="font-medium text-[var(--ink)]">Hours</span>
                      <span className="mt-0.5 block text-[var(--ink-soft)]">
                        {draft.hoursNotes ||
                          "Weekly schedule extracted from the brief"}
                      </span>
                    </span>
                  </li>
                ) : null}
                {draft.policies &&
                Object.values(draft.policies).some((v) =>
                  String(v || "").trim()
                ) ? (
                  <li className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={includePolicies}
                      onChange={(e) => setIncludePolicies(e.target.checked)}
                      aria-label="Apply policies"
                    />
                    <span>
                      <span className="font-medium text-[var(--ink)]">
                        Policies
                      </span>
                      {Object.entries(draft.policies)
                        .filter(([, v]) => String(v || "").trim())
                        .map(([k, v]) => (
                          <span
                            key={k}
                            className="mt-0.5 block text-[var(--ink-soft)]"
                          >
                            {k}: {v}
                          </span>
                        ))}
                    </span>
                  </li>
                ) : null}
                {draft.contactPhone ? (
                  <li className="flex gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={includeContactPhone}
                      onChange={(e) => setIncludeContactPhone(e.target.checked)}
                      aria-label="Apply contact phone"
                    />
                    <span>
                      <span className="font-medium text-[var(--ink)]">
                        Sales / WhatsApp phone
                      </span>
                      <span className="mt-0.5 block text-[var(--ink-soft)]">
                        {draft.contactPhone}
                      </span>
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {draft.services.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-[var(--ink)]">Services</h3>
                <button
                  type="button"
                  className="text-xs text-[var(--accent)]"
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
                          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
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
                          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
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
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] bg-white",
                ].join(" ")}
              >
                <span className="font-medium">Keep my current list</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                  Safe choice. We add the new ones you tick; nothing already
                  saved gets deleted.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMergeMode("replace_services_faqs")}
                className={[
                  "rounded-xl border px-3 py-2.5 text-left text-sm",
                  mergeMode === "replace_services_faqs"
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
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
            <input
              type="hidden"
              name="include_locations"
              value={includeLocations ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_hours"
              value={includeHours ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_policies"
              value={includePolicies ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_vertical"
              value={includeVertical ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_contact_phone"
              value={includeContactPhone ? "1" : "0"}
            />
            <input
              type="hidden"
              name="rename_business"
              value={renameBusiness ? "1" : "0"}
            />
            <button
              type="submit"
              disabled={
                applyPending ||
                (selectedServices.size === 0 &&
                  selectedFaqs.size === 0 &&
                  selectedTeam.size === 0 &&
                  !includeUnknown &&
                  !includeLocations &&
                  !includeHours &&
                  !includePolicies &&
                  !includeVertical &&
                  !includeContactPhone &&
                  !renameBusiness)
              }
              className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-105 disabled:opacity-60"
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
