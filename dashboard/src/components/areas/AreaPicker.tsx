"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, MagnifyingGlassIcon, MinusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Sheet } from "@/components/ui/Sheet";
import { buttonClass } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import {
  AREA_NOTE_MAX,
  ROOT_ID,
  areaAncestors,
  areaChildren,
  areaCounties,
  areaNode,
  areaPick,
  areaPicksDiffCount,
  areaRowMeta,
  areaState,
  areaSummaryParts,
  areaWhere,
  previewCallerLine,
  moveOverAreas,
  resolveArea,
  searchAreaTree,
  setAreaDetail,
  toggleArea,
  type AreaHit,
  type AreaPicks,
  type CallerLine,
  type TriState,
} from "@/lib/areaPicks";
import { nearbyCounties } from "@/lib/kenyaCountyAdjacency";
import { areaLineNotes } from "@/lib/areaPicksToCoverageAreas";
import { saveAreaPicksAction } from "@/app/(desk)/settings/areas/actions";

export type AreaView = "home" | "check" | "hear";

function Box({ state, round = false }: { state: TriState; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-6 w-6 shrink-0 place-items-center border-2",
        round ? "rounded-full" : "rounded-md",
        state === "off" ? "border-ink-3 bg-surface" : "border-accent bg-accent text-accent-on",
      )}
    >
      {state === "on" ? <CheckIcon className="h-4 w-4" strokeWidth={3} /> : state === "part" ? <MinusIcon className="h-4 w-4" strokeWidth={3} /> : null}
    </span>
  );
}

function Tag({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "quiet" | "warn" }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-lg px-2 py-0.5 text-meta font-semibold",
        tone === "accent" && "bg-accent-tonal text-accent",
        tone === "quiet" && "bg-surface-2 text-ink-2",
        tone === "warn" && "bg-warn-soft text-warn",
      )}
    >
      {children}
    </span>
  );
}

function Header({ title, onBack, backHref }: { title: string; onBack?: () => void; backHref?: string }) {
  const cls = "-ms-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
  return (
    <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-2.5">
      {onBack ? (
        <button type="button" aria-label="Back" className={cls} onClick={onBack}>
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
      ) : (
        <Link aria-label="Back to settings" href={backHref || "/settings"} className={cls}>
          <ChevronLeftIcon className="h-5 w-5" />
        </Link>
      )}
      <h1 className="font-display text-title text-ink">{title}</h1>
    </div>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-sticky mt-auto flex items-center gap-2.5 border-t border-hairline bg-surface px-4 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}

const rowBase = "flex min-h-14 items-center gap-3 border-b border-hairline px-4";
const hit = "flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function AreaPicker({
  initialPicks,
  oldList,
  confirmed,
  initialView,
  homeCounty = null,
  saveAction = saveAreaPicksAction,
}: {
  /** Dev harness only: a no-write stand-in. Live page uses the real action. */
  saveAction?: typeof saveAreaPicksAction;
  initialPicks: AreaPicks;
  /** Old Locations / coverage list. Non-empty with confirmed=false shows Check your areas. */
  oldList: string[];
  confirmed: boolean;
  initialView: AreaView;
  /** The business's own county (county:<slug>). Null shows every county. */
  homeCounty?: string | null;
}) {
  const [saved, setSaved] = useState<AreaPicks>(initialPicks);
  const [picks, setPicks] = useState<AreaPicks>(initialPicks);
  const [view, setViewState] = useState<AreaView>(initialView);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set([homeCounty && areaNode(homeCounty) ? homeCounty : "county:nairobi"]));
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [isConfirmed, setConfirmed] = useState(confirmed);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const setView = (v: AreaView) => {
    setViewState(v);
    const u = new URL(window.location.href);
    if (v === "home") u.searchParams.delete("view");
    else u.searchParams.set("view", v);
    window.history.replaceState(null, "", u.toString());
    window.scrollTo({ top: 0 });
  };

  const changes = areaPicksDiffCount(saved, picks);
  const save = (next: AreaPicks, confirm: boolean, after?: () => void) => {
    setMsg(null);
    start(async () => {
      const res = await saveAction(next, confirm);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      setSaved(next);
      setPicks(next);
      if (confirm) setConfirmed(true);
      setMsg({ ok: true, text: res.message });
      after?.();
    });
  };

  const needsCheck = oldList.length > 0 && !isConfirmed;
  const countyOrder = useMemo(
    () => [...areaCounties()].sort((a, b) => Number(areaState(saved, a.id) === "off") - Number(areaState(saved, b.id) === "off")),
    [saved],
  );
  // Default list: the business's county and its neighbours. Anything already
  // picked stays visible wherever it is. Unknown county: every county.
  const near = useMemo(() => nearbyCounties(homeCounty), [homeCounty]);
  const nearSet = near.length ? new Set(near) : null;
  const hasPicksIn = (countyId: string) =>
    areaState(picks, countyId) !== "off" ||
    picks.picks.some((p) => p.node === countyId || areaAncestors(p.node).some((a) => a.id === countyId));
  const shownCounties = !nearSet || showAll
    ? countyOrder
    : [
        ...countyOrder.filter((c) => c.id === homeCounty),
        ...countyOrder.filter((c) => c.id !== homeCounty && (nearSet.has(c.id) || hasPicksIn(c.id))),
      ];
  const hiddenCount = countyOrder.length - shownCounties.length;
  const homeName = homeCounty ? areaNode(homeCounty)?.name ?? null : null;

  if (view === "check") {
    return (
      <CheckView
        oldList={oldList}
        pending={pending}
        msg={msg}
        onBack={() => setView("home")}
        onEdit={(p) => {
          setPicks(p);
          setView("home");
        }}
        onConfirm={(p) => save(p, true, () => setView("home"))}
      />
    );
  }
  if (view === "hear") {
    return <HearView picks={saved} onBack={() => setView("home")} unsaved={changes > 0} />;
  }

  const summary = areaSummaryParts(picks);
  // What the phone line says until it reads this map (D2/D3, rule v1): saved picks only.
  const line = areaLineNotes(saved);
  const joinNames = (names: string[]) =>
    names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const lineNote = line.nothingReaches
    ? "Your phone line can't use these areas yet. Callers still hear your previous list."
    : [
        line.yesStill.length ? `Callers still hear yes for ${joinNames(line.yesStill)}. The phone line can't skip a place inside an area yet.` : "",
        line.notOnLine.length ? `${joinNames(line.notOnLine)} can't reach your phone line yet.` : "",
      ].filter(Boolean).join(" ");
  const results = query.trim() ? searchAreaTree(query) : null;

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-canvas">
      <Header title="Service areas" />
      <div className="mx-4 mt-3 rounded-2xl border border-hairline bg-surface p-3.5">
        <p className="text-meta text-ink-2">Where you work</p>
        <p className="mt-1 text-body text-ink" data-area-summary="">
          {summary.map((s, i) =>
            s.strong ? (
              <b key={i} className="font-semibold text-accent">
                {s.text}
              </b>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <button type="button" onClick={() => setView("hear")} className="mt-2 inline-flex min-h-11 items-center text-meta font-semibold text-accent underline-offset-2 hover:underline">
          What callers will hear
        </button>
      </div>
      {lineNote ? (
        <p className="mx-4 mt-1 rounded-2xl border border-hairline bg-surface p-3.5 text-meta text-attention" role="note" data-area-line-note="">
          {lineNote}
        </p>
      ) : null}
      {needsCheck ? (
        <div className="mx-4 mt-1 flex items-center gap-3 rounded-2xl border border-hairline bg-accent-tonal p-3.5">
          <p className="flex-1 text-meta text-ink">We moved your old area list into the new map.</p>
          <button type="button" className={buttonClass({ variant: "primary", size: "md" })} onClick={() => setView("check")}>
            Check it
          </button>
        </div>
      ) : null}
      <label className="mx-4 my-3 flex h-12 items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 focus-within:border-2 focus-within:border-accent">
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
        <span className="sr-only">Search area or landmark</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search area or landmark"
          className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          enterKeyHint="search"
        />
        {query ? (
          <button type="button" aria-label="Clear search" className={cx(hit, "-me-2 text-ink-2")} onClick={() => setQuery("")}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        ) : null}
      </label>

      {results ? (
        <SearchResults results={results} picks={picks} onToggle={(id) => setPicks(toggleArea(picks, id))} onOpen={setSheet} query={query} />
      ) : (
        <ul className="border-y border-hairline bg-surface" aria-label="Areas">
          <TreeRow id={ROOT_ID} picks={picks} depth={0} onToggle={(id) => setPicks(toggleArea(picks, id))} onOpen={setSheet} />
          {shownCounties.map((c) => {
            const kids = areaChildren(c.id);
            const isOpen = open.has(c.id);
            return (
              <li key={c.id}>
                <TreeRow
                  id={c.id}
                  picks={picks}
                  depth={1}
                  expandable={kids.length > 0}
                  expanded={isOpen}
                  onExpand={() => {
                    const n = new Set(open);
                    if (isOpen) n.delete(c.id);
                    else n.add(c.id);
                    setOpen(n);
                  }}
                  onToggle={(id) => setPicks(toggleArea(picks, id))}
                  onOpen={setSheet}
                />
                {isOpen ? (
                  <ul>
                    {kids.map((k) => (
                      <TreeRow key={k.id} id={k.id} picks={picks} depth={2} parentState={areaState(picks, c.id)} onToggle={(id) => setPicks(toggleArea(picks, id))} onOpen={setSheet} />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {nearSet && (hiddenCount > 0 || showAll) ? (
            <li className={cx(rowBase, "justify-between")} data-area-county-filter="">
              <span className="min-w-0 flex-1 py-2 text-meta text-ink-2">
                {showAll ? "Showing every county" : `Showing ${homeName} and nearby counties`}
              </span>
              <button
                type="button"
                aria-expanded={showAll}
                className={buttonClass({ variant: "ghost", size: "md" })}
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? "Show nearby only" : `Show all counties (${hiddenCount} more)`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
      <div className="h-6" />
      <Bar>
        <span role="status" className={cx("flex-1 text-meta", msg && !msg.ok ? "text-attention" : "text-ink-2")}>
          {msg && changes === 0 ? msg.text : msg && !msg.ok ? msg.text : changes === 0 ? "No changes" : `${changes} ${changes === 1 ? "change" : "changes"}`}
        </span>
        {changes > 0 ? (
          <button type="button" className={buttonClass({ variant: "ghost", size: "lg" })} onClick={() => setPicks(saved)} disabled={pending}>
            Undo
          </button>
        ) : null}
        <button type="button" className={buttonClass({ variant: "primary", size: "lg" })} disabled={changes === 0 || pending} onClick={() => save(picks, false)}>
          {pending ? "Saving…" : "Save"}
        </button>
      </Bar>
      {sheet ? (
        <AreaSheet
          key={sheet}
          id={sheet}
          picks={picks}
          onClose={() => setSheet(null)}
          onDone={(d) => {
            setPicks(setAreaDetail(picks, sheet, d));
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TreeRow({
  id,
  picks,
  depth,
  expandable,
  expanded,
  onExpand,
  onToggle,
  onOpen,
  parentState,
}: {
  id: string;
  picks: AreaPicks;
  depth: 0 | 1 | 2;
  expandable?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  parentState?: TriState;
}) {
  const n = areaNode(id)!;
  const state = areaState(picks, id);
  const pick = areaPick(picks, id);
  const res = resolveArea(picks, id);
  const meta = depth < 2 ? areaRowMeta(picks, id) : null;
  const Wrap = depth === 0 ? "li" : "div";
  return (
    <Wrap className={cx(rowBase, depth === 2 && "min-h-13 bg-surface-2/40 ps-12")}>
      <button type="button" role="checkbox" aria-checked={state === "on" ? true : state === "part" ? "mixed" : false} aria-label={`Serve ${n.name}`} className={cx(hit, "-ms-2.5")} onClick={() => onToggle(id)}>
        <Box state={state} />
      </button>
      {depth === 0 ? (
        <div className="min-w-0 flex-1 py-2">
          <div className="font-medium text-ink">{n.name}</div>
          {meta ? <div className="text-meta text-ink-2">{meta}</div> : null}
        </div>
      ) : (
        <button type="button" className="min-h-11 min-w-0 flex-1 py-2 text-start" onClick={() => onOpen(id)} aria-label={`${n.name} details`}>
          <div className="truncate font-medium text-ink">{n.name}</div>
          {meta ? <div className="truncate text-meta text-ink-2">{meta}</div> : null}
        </button>
      )}
      {pick?.fee_kes != null ? <Tag>+KES {pick.fee_kes.toLocaleString("en-KE")}</Tag> : null}
      {depth === 2 && !res.covered && parentState && parentState !== "off" ? <Tag tone="quiet">Off</Tag> : null}
      {expandable ? (
        <button type="button" aria-label={expanded ? `Hide ${n.name} areas` : `Show ${n.name} areas`} aria-expanded={expanded} className={cx(hit, "-me-2.5 text-ink-2")} onClick={onExpand}>
          {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
        </button>
      ) : null}
    </Wrap>
  );
}

function SearchResults({
  results,
  picks,
  onToggle,
  onOpen,
  query,
}: {
  results: ReturnType<typeof searchAreaTree>;
  picks: AreaPicks;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  query: string;
}) {
  const none = !results.areas.length && !results.didYouMean.length && !results.landmarks.length;
  const row = (h: AreaHit, landmark = false) => {
    const covered = resolveArea(picks, h.node.id).covered;
    return (
      <li key={`${h.via}:${h.node.id}:${h.label}`} className={rowBase}>
        <button type="button" role="checkbox" aria-checked={covered} aria-label={`Serve ${h.node.name}`} className={cx(hit, "-ms-2.5")} onClick={() => onToggle(h.node.id)}>
          <Box state={areaState(picks, h.node.id)} round={landmark} />
        </button>
        <button type="button" className="min-h-11 min-w-0 flex-1 py-2 text-start" onClick={() => onOpen(h.node.id)}>
          <div className="truncate font-medium text-ink">{h.label}</div>
          <div className="truncate text-meta text-ink-2">{h.where}</div>
        </button>
        {!landmark && covered ? <Tag>Covered</Tag> : null}
      </li>
    );
  };
  const section = (title: string, hits: AreaHit[], landmark = false) =>
    hits.length ? (
      <section>
        <h2 className="mx-4 mb-2 mt-4 text-body font-semibold text-ink-2">{title}</h2>
        <ul className="border-y border-hairline bg-surface">{hits.map((h) => row(h, landmark))}</ul>
      </section>
    ) : null;
  return (
    <div>
      {section("Areas", results.areas)}
      {section("Did you mean", results.didYouMean)}
      {section("Landmarks", results.landmarks, true)}
      {none ? <p className="mx-4 mt-4 text-body text-ink-2">No area matches “{query}”. Try a nearby estate or town.</p> : null}
      <p className="mx-4 mt-4 text-meta text-ink-2">Spelling is matched loosely, so “Kileleswa” finds Kileleshwa too.</p>
    </div>
  );
}

function AreaSheet({
  id,
  picks,
  onClose,
  onDone,
}: {
  id: string;
  picks: AreaPicks;
  onClose: () => void;
  onDone: (d: { serve: boolean; fee_kes: string; note: string }) => void;
}) {
  const n = areaNode(id)!;
  const pick = areaPick(picks, id);
  const res = resolveArea(picks, id);
  const [serve, setServe] = useState(res.covered);
  const [fee, setFee] = useState(pick?.fee_kes != null ? String(pick.fee_kes) : "");
  const [note, setNote] = useState(pick?.note ?? "");
  const preview = useMemo(() => {
    const trial = setAreaDetail(picks, id, { serve, fee_kes: fee, note });
    return previewCallerLine(trial, n.name).reply;
  }, [picks, id, serve, fee, note, n.name]);
  const where = n.kind === "county" ? "County" : n.kind === "town" ? `${areaWhere(id)} County` : areaWhere(id);
  const seg = (on: boolean) =>
    cx("flex min-h-11 flex-1 items-center justify-center text-body", on ? "bg-accent-tonal font-semibold text-accent" : "font-medium text-ink");
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={n.name}
      description={where}
      footer={
        <div className="flex w-full gap-2.5">
          <button type="button" className={buttonClass({ variant: "ghost", size: "lg" }) + " border border-hairline"} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass({ variant: "primary", size: "lg" }) + " flex-1"} onClick={() => onDone({ serve, fee_kes: fee, note })}>
            Done
          </button>
        </div>
      }
    >
      <fieldset>
        <legend className="mb-1.5 font-semibold text-ink">Do you serve here?</legend>
        <div className="flex overflow-hidden rounded-xl border border-hairline" role="radiogroup">
          <button type="button" role="radio" aria-checked={serve} className={seg(serve)} onClick={() => setServe(true)}>
            Yes
          </button>
          <button type="button" role="radio" aria-checked={!serve} className={seg(!serve)} onClick={() => setServe(false)}>
            No
          </button>
        </div>
      </fieldset>
      {serve ? (
        <>
          <label className="mb-1.5 mt-4 block font-semibold text-ink" htmlFor="area-fee">
            Extra fee (optional)
          </label>
          <div className="flex h-12 items-center gap-1.5 rounded-xl border border-hairline px-3.5 focus-within:border-2 focus-within:border-accent">
            <span className="text-meta text-ink-2">KES</span>
            <input id="area-fee" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none" />
          </div>
          <p className="mt-1 text-meta text-ink-2">Leave empty if there is none.</p>
          <label className="mb-1.5 mt-4 block font-semibold text-ink" htmlFor="area-note">
            Note for callers (optional)
          </label>
          <textarea id="area-note" value={note} maxLength={AREA_NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="For example: weekends only" className="w-full rounded-xl border border-hairline bg-surface px-3.5 py-3 text-body text-ink outline-none focus:border-2 focus:border-accent" />
        </>
      ) : null}
      <p className="mt-4 rounded-xl border border-hairline bg-surface-2/60 p-3.5 text-body text-ink">Callers hear: “{preview}”</p>
    </Sheet>
  );
}

function CheckView({
  oldList,
  pending,
  msg,
  onBack,
  onEdit,
  onConfirm,
}: {
  oldList: string[];
  pending: boolean;
  msg: { ok: boolean; text: string } | null;
  onBack: () => void;
  onEdit: (p: AreaPicks) => void;
  onConfirm: (p: AreaPicks) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, "county" | "town">>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const full = useMemo(() => moveOverAreas(oldList, answers), [oldList, answers]);
  const kept = useMemo(() => moveOverAreas(oldList.filter((o) => !skip.has(o.replace(/^(county|place):/, "").trim().toLowerCase())), answers), [oldList, answers, skip]);
  const seg = (on: boolean) =>
    cx("flex min-h-11 flex-1 items-center justify-center text-body", on ? "bg-accent-tonal font-semibold text-accent" : "font-medium text-ink");
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-canvas">
      <Header title="Check your areas" onBack={onBack} />
      <p className="border-b border-hairline bg-canvas px-4 py-3.5 text-body text-ink">We moved your area list into the new map. Check it looks right.</p>
      <ul className="border-b border-hairline bg-surface">
        {full.rows.map((r) => {
          const n = areaNode(r.node)!;
          const key = r.raw.toLowerCase();
          const on = !skip.has(key);
          const kids = areaChildren(n.id).length;
          const sub = n.kind === "county" ? (kids ? "Whole county · all areas" : "Whole county") : areaWhere(n.id);
          return (
            <li key={r.node} className={rowBase}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`Keep ${n.name}`}
                className={cx(hit, "-ms-2.5")}
                onClick={() => {
                  const s = new Set(skip);
                  if (on) s.add(key);
                  else s.delete(key);
                  setSkip(s);
                }}
              >
                <Box state={on ? "on" : "off"} />
              </button>
              <div className="min-w-0 flex-1 py-2">
                <div className="truncate font-medium text-ink">{n.name}</div>
                <div className="truncate text-meta text-ink-2">{sub}</div>
              </div>
              {r.insideOf ? <Tag>Inside {r.insideOf}</Tag> : null}
            </li>
          );
        })}
      </ul>
      {full.questions.map((q) => {
        const c = areaNode(q.county)!;
        const a = answers[q.county] ?? "county";
        return (
          <div key={q.county} className="mx-4 mt-4 rounded-2xl border border-hairline bg-surface p-3.5">
            <p className="font-semibold text-ink">Is {c.name} the whole county?</p>
            <p className="mt-1 text-meta text-ink-2">Your old list said “{q.raw.replace(/\b\w/g, (x) => x.toUpperCase())}”. That could mean the town or the county.</p>
            <div className="mt-3 flex overflow-hidden rounded-xl border border-hairline" role="radiogroup" aria-label={`${c.name}: county or town`}>
              <button type="button" role="radio" aria-checked={a === "county"} className={seg(a === "county")} onClick={() => setAnswers({ ...answers, [q.county]: "county" })}>
                Whole county
              </button>
              <button type="button" role="radio" aria-checked={a === "town"} className={seg(a === "town")} onClick={() => setAnswers({ ...answers, [q.county]: "town" })}>
                Town only
              </button>
            </div>
          </div>
        );
      })}
      {full.unmatched.length ? (
        <div className="mx-4 mt-4 rounded-2xl border border-hairline bg-surface p-3.5">
          <p className="font-semibold text-ink">Not on the map yet</p>
          <p className="mt-1 text-meta text-ink-2">{full.unmatched.join(", ")}. Tap Edit and search for the nearest estate or town.</p>
        </div>
      ) : null}
      <div className="h-6" />
      <Bar>
        {msg && !msg.ok ? <span role="status" className="sr-only">{msg.text}</span> : null}
        <button type="button" className={buttonClass({ variant: "ghost", size: "lg" }) + " border border-hairline"} onClick={() => onEdit(kept.picks)} disabled={pending}>
          Edit
        </button>
        <button type="button" className={buttonClass({ variant: "primary", size: "lg" }) + " flex-1"} onClick={() => onConfirm(kept.picks)} disabled={pending}>
          {pending ? "Saving…" : "Looks right"}
        </button>
      </Bar>
      {msg && !msg.ok ? <p className="px-4 pb-3 text-meta text-attention">{msg.text}</p> : null}
    </div>
  );
}

function examplePlaces(picks: AreaPicks): string[] {
  const out: string[] = [];
  const serving = picks.picks.find((p) => p.serve);
  if (serving) {
    const kids = areaChildren(serving.node).filter((k) => resolveArea(picks, k.id).covered);
    out.push(areaNode(kids[0]?.id ?? serving.node)!.name);
  }
  const off = picks.picks.find((p) => !p.serve) ?? null;
  if (off) out.push(areaNode(off.node)!.name);
  else {
    const notCovered = areaCounties().find((c) => {
      const r = resolveArea(picks, c.id);
      return !r.covered && r.via;
    });
    if (notCovered) out.push(notCovered.name);
  }
  out.push("the new mall");
  return out;
}

function Chat({ line, ask }: { line: CallerLine; ask: string }) {
  const tag =
    line.status === "covered"
      ? <Tag>Covered</Tag>
      : line.status === "not_covered"
        ? <Tag tone="quiet">Not covered</Tag>
        : line.status === "need_check"
          ? <Tag tone="warn">Owner confirms</Tag>
          : <Tag tone="warn">Not on map</Tag>;
  return (
    <li className="mx-4 mb-3 rounded-2xl border border-hairline bg-surface p-3.5">
      <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2.5 text-body text-ink" style={{ width: "fit-content" }}>{ask}</p>
      <p className="ms-auto mt-2.5 max-w-[80%] rounded-2xl rounded-br-sm bg-accent-tonal px-3 py-2.5 text-body text-ink" style={{ width: "fit-content" }}>{line.reply}</p>
      <div className="mt-2">{tag}</div>
    </li>
  );
}

function HearView({ picks, onBack, unsaved }: { picks: AreaPicks; onBack: () => void; unsaved: boolean }) {
  const [tryText, setTry] = useState("");
  const places = examplePlaces(picks);
  const asks = [(p: string) => `Do you come to ${p}?`, (p: string) => `What about ${p}?`, (p: string) => `I'm near ${p}.`];
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-canvas">
      <Header title="What callers hear" onBack={onBack} />
      <p className="px-4 py-3 text-meta text-ink-2">Based on your saved areas.{unsaved ? " Save first to hear your latest changes." : ""}</p>
      <ul>
        {places.map((p, i) => (
          <Chat key={p} line={previewCallerLine(picks, p)} ask={asks[Math.min(i, 2)](p)} />
        ))}
        {tryText.trim() ? <Chat line={previewCallerLine(picks, tryText)} ask={`Do you come to ${tryText.trim()}?`} /> : null}
      </ul>
      <label className="mx-4 flex h-12 items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 focus-within:border-2 focus-within:border-accent">
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
        <span className="sr-only">Try a place name</span>
        <input value={tryText} onChange={(e) => setTry(e.target.value)} placeholder="Try a place name" className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3" />
      </label>
      <div className="h-6" />
      <Bar>
        <button type="button" className={buttonClass({ variant: "primary", size: "lg" }) + " flex-1"} onClick={onBack}>
          Back to areas
        </button>
      </Bar>
    </div>
  );
}
