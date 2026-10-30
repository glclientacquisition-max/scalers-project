"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/20/solid";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Segmented, SegmentedControl } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { Empty } from "@/components/ui/Empty";
import { notify } from "@/components/ui/DeskNotice";
import { deskShiftClass } from "@/lib/deskMotion";
import { cx } from "@/lib/cx";
import { PHOTO_MAX_BASE64 } from "@/lib/importPhoto";
import { IMPORT_FILE_ACCEPT, IMPORT_FILE_MAX_BYTES, delimitedToPasteText } from "@/lib/importCsv";
import { CHECK_FIX, CHECK_LABEL, ISSUE_LINE, type KbCategory, type KbDraft, type KbItem, type KbKind, type KbPasteRow, type KbReadiness, type KbSnapshotRow } from "@/lib/kbCore";
import {
  PRICE_CHOICES,
  SEARCH_FROM,
  catalogueCounts,
  editDraft,
  filterItems,
  isUnpriced,
  itemState,
  newDraft,
  nextUnpriced,
  pasteRowLine,
  pasteSummary,
  pasteSummaryLine,
  replaceConfirmLine,
  replaceKindClashes,
  replaceRemovals,
  rowPriceInWords,
  rowTags,
  searchCountLine,
  statusChoices,
  savedLine,
  draftDirty,
  sheetErrors,
  statusLine,
  withAmount,
  withChoice,
  type PriceChoice,
} from "@/lib/catalogueView";
import type { KbActionResult } from "@/app/(desk)/settings/knowledge/actions";

/** The KB v2 server actions this screen calls. Injected so the dev fixture can render without a database. */
export type CatalogueActions = {
  saveItem: (d: KbDraft) => Promise<KbActionResult>;
  hideItem: (id: string) => Promise<KbActionResult>;
  decideSwName: (id: string, decision: "approve" | "edit" | "reject", text?: string) => Promise<KbActionResult>;
  compile: () => Promise<KbActionResult>;
  previewPaste: (text: string) => Promise<{ ok: true; rows: KbPasteRow[] } | { ok: false; error: string }>;
  importPaste: (rows: KbPasteRow[], kind: KbKind, group: string, mode?: "append" | "replace") => Promise<KbActionResult>;
  /** Add many from a photo or a website (DESK_IMPORT_PHOTO): both return paste lines for the same preview. */
  photoToLines?: (mimeType: string, base64: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  websiteToLines?: (url: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
};

export type CatalogueScreenProps = {
  items: KbItem[];
  categories: KbCategory[];
  live: KbSnapshotRow | null;
  latest: KbSnapshotRow | null;
  readiness: KbReadiness;
  liveVersion: number | null;
  /**
   * On calls: the shared isKbLive decided on the server (kbLive.server), passed down as a boolean. Never rebuilt
   * here from versions or readiness.
   */
  onCalls: boolean;
  /** home_services never sees a Products concept. */
  vertical: string;
  canEdit: boolean;
  /** ?filter=unpriced from Overview "Add prices". Always shown with a way out. */
  initialNeedPrice?: boolean;
  /** ?paste=1 (old Import links) opens Paste a list. */
  initialPaste?: boolean;
  /** "Add many" (staging flag DESK_ADD_MANY): one sheet for a pasted list or a CSV file. Off: Paste a list. */
  addMany?: boolean;
  /** Photo and Website sources in Add many (staging flag DESK_IMPORT_PHOTO). Needs addMany. */
  importPhoto?: boolean;
  /**
   * Paused and Not offered (the item Status control). Server flag DESK_KB_ITEM_STATES, off by default
   * until the KB writers and the Brain KB reader are live. Off: an item already in one of those states
   * still shows it, with the way back to Offered.
   */
  statesEnabled?: boolean;
  actions: CatalogueActions;
};

const card = "overflow-hidden rounded-2xl border border-hairline bg-surface";
const heading = "text-body font-semibold text-ink";
const SHOW_STEP = 150;

export function CatalogueScreen(props: CatalogueScreenProps) {
  const { items, categories, live, latest, readiness, liveVersion, onCalls, vertical, canEdit, actions } = props;
  const addMany = !!props.addMany;
  const manyLabel = addMany ? "Add many" : "Paste a list";
  const statesEnabled = !!props.statesEnabled;
  const router = useRouter();
  const homeServices = vertical === "home_services";
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | KbKind>("all");
  const [needPrice, setNeedPrice] = useState(!!props.initialNeedPrice);
  const [shown, setShown] = useState(SHOW_STEP);
  const [editing, setEditing] = useState<{ draft: KbDraft; fixing: boolean } | null>(null);
  const [pasting, setPasting] = useState(!!props.initialPaste && canEdit);
  const [checksOpen, setChecksOpen] = useState(false);
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [swEdit, setSwEdit] = useState<{ id: string; text: string } | null>(null);

  const counts = useMemo(() => catalogueCounts(items), [items]);
  const list = useMemo(() => filterItems(items, categories, { query, kind, needPrice }), [items, categories, query, kind, needPrice]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name_en])), [categories]);
  const both = counts.services > 0 && counts.products > 0 && !homeServices;
  const todo = (readiness?.checks || []).filter((c) => !c.ok);
  const failed = latest && latest.status === "failed" && latest.version !== liveVersion;
  const waiting = items.filter((i) => i.name_sw_state === "suggested" && i.name_sw_suggested);
  // "No price" is the status card's job (one count, one Fix), so it is not listed twice.
  const issues = (latest?.issues || []).filter((i) => i.severity !== "info" && i.code !== "no_price");
  const hasAside = !!live?.doc?.preview?.length || (waiting.length > 0 && canEdit) || issues.length > 0;
  const nameOf = (id?: string) => items.find((i) => i.id === id)?.name_en;
  const defaultKind: KbKind = homeServices || kind === "service" ? "service" : kind === "product" || vertical === "retail" || (counts.products > 0 && !counts.services) ? "product" : "service";

  const run = (fn: () => Promise<KbActionResult>, done?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) notify(r.error, { tone: "error" });
      else {
        if (done) notify(done);
        router.refresh();
      }
    });

  const openFix = (afterId?: string | null, justSaved = false) => {
    const next = nextUnpriced(items, afterId);
    if (!next || next.id === afterId) {
      setEditing(null);
      if (justSaved) notify("Every item has a price now.");
      return;
    }
    setEditing({ draft: editDraft(next, categories), fixing: true });
  };

  return (
    <div className="space-y-4 px-4 py-4 md:px-0" data-catalogue="">
      <h1 className="text-title font-semibold text-ink">Catalogue</h1>
      <div className={cx("grid min-w-0 grid-cols-1 items-start gap-4", hasAside ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : "max-w-2xl")}>
      <div className="min-w-0 space-y-4">

      {/* Card A: one line of status, one Fix. */}
      <section className={card} data-catalogue-status="" data-on-calls={onCalls ? "yes" : "no"}>
        <div className="flex min-h-16 items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className={heading} data-status-line="">
              {statusLine(counts)}
            </p>
            <p className="text-meta text-ink-2">
              {onCalls ? "On calls. Changes reach calls within a minute." : todo.length ? `Not on calls yet. ${todo.length} ${todo.length === 1 ? "check" : "checks"} to do.` : "Not on calls yet."}
            </p>
          </div>
          {canEdit && counts.needPrice ? (
            <Button size="md" variant="primary" onClick={() => openFix(null)} data-fix="">
              Fix
            </Button>
          ) : null}
        </div>
        {readiness && !onCalls ? (
          <div className="border-t border-hairline">
            <button
              type="button"
              aria-expanded={checksOpen}
              aria-controls="catalogue-checks"
              onClick={() => setChecksOpen((v) => !v)}
              className={cx("flex min-h-11 w-full items-center justify-between px-4 text-meta font-medium text-accent", deskShiftClass)}
            >
              {checksOpen ? "Hide checks" : "See checks"}
              <ChevronDownIcon aria-hidden="true" className={cx("size-4", checksOpen && "rotate-180")} />
            </button>
            {checksOpen ? (
              <div id="catalogue-checks" className="space-y-2 px-4 pb-3">
                <ul className="space-y-2">
                  {readiness.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-meta">
                      <span className={c.ok ? "w-12 shrink-0 text-ink-2" : "w-12 shrink-0 font-semibold text-attention"}>{c.ok ? "Done" : "To do"}</span>
                      <span className="min-w-0 flex-1 text-ink">{CHECK_LABEL[c.id] || c.id}</span>
                      {!c.ok && c.id === "catalogue" && canEdit ? (
                        <button type="button" className="-my-3 inline-flex min-h-11 items-center text-meta font-semibold text-accent" onClick={() => openFix(null)}>
                          Fix
                        </button>
                      ) : !c.ok && CHECK_FIX[c.id] && CHECK_FIX[c.id] !== "/settings/knowledge" ? (
                        <Link href={CHECK_FIX[c.id]} className="-my-3 inline-flex min-h-11 items-center text-meta font-semibold text-accent">
                          Fix
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canEdit ? (
                  <Button variant="tonal" size="md" pending={pending} onClick={() => run(actions.compile, "Checking now. This takes a few seconds.")}>
                    Check again
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {failed ? (
        <p className="rounded-xl bg-attention-tonal p-3 text-body text-attention" role="status">
          Your last change could not be used, so calls still use the earlier catalogue. Fix the items below, then save again.
        </p>
      ) : null}

      {/* Card B: what you sell. */}
      <section className={card} data-catalogue-list="">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-2">
          <h2 className={heading}>What you sell</h2>
          {canEdit && counts.total ? (
            <div className="flex gap-2">
              <Button variant="tonal" size="md" onClick={() => setPasting(true)}>
                {manyLabel}
              </Button>
              {/* One filled button per screen: Fix while prices are missing, else Add. */}
              <Button variant={counts.needPrice ? "tonal" : "primary"} size="md" leading={<PlusIcon aria-hidden="true" className="size-4" />} onClick={() => setEditing({ draft: newDraft(defaultKind, categories), fixing: false })} data-add="">
                Add
              </Button>
            </div>
          ) : null}
        </div>

        {counts.total ? (
          <>
            {both ? (
              <div className="px-4">
                <Segmented
                  label="Show"
                  items={[
                    { key: "all", label: "All", count: counts.total, active: kind === "all" },
                    { key: "service", label: "Services", count: counts.services, active: kind === "service" },
                    { key: "product", label: "Products", count: counts.products, active: kind === "product" },
                  ]}
                  onSelect={(k) => setKind(k === "service" || k === "product" ? k : "all")}
                />
              </div>
            ) : null}
            {counts.total >= SEARCH_FROM ? (
              <div className="relative px-4 pt-3" data-catalogue-search="">
                <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute left-7 top-1/2 mt-1.5 size-4 -translate-y-1/2 text-ink-3" />
                <Input type="search" aria-label="Search your catalogue" placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(SHOW_STEP); }} className="pl-9" />
              </div>
            ) : null}
            {query.trim() ? (
              <p className="px-4 pt-2 text-meta text-ink-2" role="status" aria-live="polite" data-search-count={list.length}>
                {searchCountLine(list.length)}
              </p>
            ) : null}
            {needPrice ? (
              <div className="mx-4 mt-3 flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3" role="status" data-need-price-banner="">
                <p className="text-meta text-ink">{`Showing ${list.length} that ${list.length === 1 ? "needs" : "need"} a price`}</p>
                <button type="button" onClick={() => setNeedPrice(false)} className="min-h-11 text-meta font-semibold text-accent">
                  Show all
                </button>
              </div>
            ) : null}

            {list.length ? (
              <ul className="mt-2 divide-y divide-hairline border-t border-hairline" data-catalogue-rows="">
                {list.slice(0, shown).map((it) => {
                  const unpriced = it.status !== "not_offered" && isUnpriced(it);
                  const tags = rowTags(it);
                  const group = it.category_id ? catName.get(it.category_id) : null;
                  const muted = itemState(it) !== "offered";
                  const body = (
                    <>
                      <span className="min-w-0 flex-1 max-[399px]:basis-full">
                        <span className={cx("block truncate text-body font-medium", muted ? "text-ink-2" : "text-ink")}>{it.name_en}</span>
                        {group || tags.length ? (
                          <span className="block truncate text-meta text-ink-2">{[...tags, group].filter(Boolean).join(" · ")}</span>
                        ) : null}
                      </span>
                      <span className={cx("shrink-0 text-right text-body tabular-nums max-[399px]:text-left max-[399px]:text-meta", unpriced ? "font-semibold text-attention" : "text-ink")} data-price-words="">
                        {it.status === "not_offered" ? "" : rowPriceInWords(it)}
                      </span>
                    </>
                  );
                  return (
                    <li key={it.id} data-item-row={it.id} data-item-state={itemState(it)}>
                      {canEdit ? (
                        <button type="button" onClick={() => setEditing({ draft: editDraft(it, categories), fixing: false })} className={cx("flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-left hover:bg-surface-2", deskShiftClass)} data-row-two-line="">
                          {body}
                        </button>
                      ) : (
                        <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-body text-ink-2">{query ? `Nothing matches "${query}".` : "Nothing here."}</p>
            )}
            {list.length > shown ? (
              <div className="border-t border-hairline px-4 py-2">
                <Button variant="ghost" size="md" onClick={() => setShown((n) => n + SHOW_STEP)}>
                  {`Show ${Math.min(SHOW_STEP, list.length - shown)} more`}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <Empty
            title={homeServices ? "Add the services you offer" : "Add what you sell"}
            line="Callers hear your prices when they ask."
            action={
              canEdit ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="tonal" onClick={() => setPasting(true)}>
                    {manyLabel}
                  </Button>
                  <Button variant="primary" onClick={() => setEditing({ draft: newDraft(defaultKind, categories), fixing: false })}>
                    {homeServices ? "Add a service" : "Add an item"}
                  </Button>
                </div>
              ) : undefined
            }
          />
        )}
      </section>

      </div>
      {hasAside ? (
      <aside className="min-w-0 space-y-4" data-catalogue-aside="">
      {live?.doc?.preview?.length ? (
        <section className={card} data-kb-preview="">
          <div className="flex min-h-14 items-center justify-between gap-2 px-4 py-2">
            <h2 className={heading}>What callers hear</h2>
            <SegmentedControl
              label="Language"
              value={lang}
              onChange={(v) => setLang(v === "sw" ? "sw" : "en")}
              items={[
                { value: "en", label: "English" },
                { value: "sw", label: "Kiswahili" },
              ]}
            />
          </div>
          <ul className="space-y-3 px-4 pb-4">
            {live.doc.preview.map((p) => (
              <li key={p.asked}>
                <p className="text-meta text-ink-2">Caller: {p.asked}</p>
                <p className="text-body text-ink">{(lang === "sw" ? p.sw : p.en) || "Nothing to say yet."}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {waiting.length && canEdit ? (
        <section className={card} data-kb-swahili="">
          <div className="px-4 pt-3">
            <h2 className={heading}>Kiswahili names to check</h2>
            <p className="text-meta text-ink-2">Callers only hear a Kiswahili name after you approve it.</p>
          </div>
          <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
            {waiting.slice(0, 30).map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 text-body text-ink">
                  {it.name_en}
                  <span className="block text-meta text-ink-2">Suggested: {it.name_sw_suggested}</span>
                </span>
                {swEdit?.id === it.id ? (
                  <>
                    <Input aria-label={`Kiswahili name for ${it.name_en}`} value={swEdit.text} onChange={(e) => setSwEdit({ id: it.id, text: e.target.value })} className="max-w-56" />
                    <Button size="md" variant="tonal" pending={pending} onClick={() => run(() => actions.decideSwName(it.id, "edit", swEdit.text), "Saved")}>
                      Save
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="md" variant="tonal" pending={pending} onClick={() => run(() => actions.decideSwName(it.id, "approve"), "Approved")}>
                      Approve
                    </Button>
                    <Button size="md" variant="ghost" onClick={() => setSwEdit({ id: it.id, text: it.name_sw_suggested || "" })}>
                      Edit
                    </Button>
                    <Button size="md" variant="ghost" pending={pending} onClick={() => run(() => actions.decideSwName(it.id, "reject"))}>
                      Reject
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {issues.length ? (
        <section className={card} data-kb-issues="">
          <h2 className={cx(heading, "px-4 pt-3")}>Worth fixing</h2>
          <ul className="space-y-1 px-4 pb-3 pt-1 text-meta">
            {issues.slice(0, 10).map((i, n) => (
              <li key={`${i.code}-${i.item_id || n}`} className="text-ink">
                {i.item_id ? <span className="font-semibold">{nameOf(i.item_id) || "An item"} </span> : null}
                {ISSUE_LINE[i.code] || i.detail || i.code}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      </aside>
      ) : null}
      </div>

      {pasting ? (
        <PasteSheet
          addMany={addMany}
          importPhoto={addMany && !!props.importPhoto && !!actions.photoToLines && !!actions.websiteToLines}
          existing={items}
          homeServices={homeServices}
          defaultKind={defaultKind}
          actions={actions}
          onClose={() => setPasting(false)}
          onSaved={() => {
            setPasting(false);
            router.refresh();
          }}
        />
      ) : null}
      {editing ? (
        <ItemSheet
          key={editing.draft.id || "new"}
          draft={editing.draft}
          fixing={editing.fixing}
          left={counts.needPrice}
          retail={!homeServices}
          statesEnabled={statesEnabled}
          categories={categories}
          actions={actions}
          onClose={() => setEditing(null)}
          onSkip={() => openFix(editing.draft.id)}
          onSaved={(id) => {
            router.refresh();
            if (editing.fixing) openFix(id, true);
            else setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

const NOTHING_LINE: Partial<Record<PriceChoice, string>> = {
  quote: "Callers hear that you give a custom quote, and you get their details to call back.",
  site_visit: "Callers hear that you price it after a site visit, and you get their details to book one.",
  free: "Callers hear that it is free.",
};

function ItemSheet({
  draft,
  fixing,
  left,
  retail,
  statesEnabled,
  categories,
  actions,
  onClose,
  onSkip,
  onSaved,
}: {
  draft: KbDraft;
  fixing: boolean;
  left: number;
  retail: boolean;
  statesEnabled: boolean;
  categories: KbCategory[];
  actions: CatalogueActions;
  onClose: () => void;
  onSkip: () => void;
  onSaved: (id: string | undefined) => void;
}) {
  const [d, setD] = useState<KbDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // More opens by itself only when the item is paused or not offered, so that state is never hidden.
  const [moreOpen, setMoreOpen] = useState(d.status !== "active");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (patch: Partial<KbDraft>) => setD((x) => ({ ...x, ...patch }));
  const isNew = !d.id;
  const dirty = draftDirty(d, draft);
  const statuses = statusChoices(statesEnabled, draft.status);

  const save = (next: KbDraft = d) => {
    const errs = sheetErrors(next);
    if (errs.length) return setError(errs.join(" "));
    setError(null);
    start(async () => {
      const r = await actions.saveItem(next);
      if (!r.ok) setError(r.error);
      else {
        notify(savedLine(next, r));
        onSaved(next.id);
      }
    });
  };

  // Picking a price type never saves by itself (30 Oct): Save is the one way to save.
  const choose = (mode: PriceChoice) => setD(withChoice(d, mode));

  const remove = () =>
    start(async () => {
      if (!d.id) return onClose();
      const r = await actions.hideItem(d.id);
      if (!r.ok) setError(r.error);
      else {
        const removed = { ...d, row_version: undefined };
        notify(`Removed ${d.name_en}.`, {
          action: {
            label: "Undo",
            run: () => {
              void actions.saveItem(removed).then((u) => notify(u.ok ? `${removed.name_en} is back.` : u.error, u.ok ? undefined : { tone: "error" }));
            },
          },
        });
        onSaved(undefined);
      }
    });

  const needsAmount = d.price_mode === "none" || d.price_mode === "fixed" || d.price_mode === "from" || d.price_mode === "per_unit";
  const title = fixing ? "Add a price" : isNew ? (d.kind === "product" ? "Add a product" : "Add a service") : "Edit item";

  return (
    <Sheet
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={title}
      description={fixing ? `${left} without a price` : undefined}
      height="compact"
      footer={
        confirmRemove ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)} className="me-auto">
              Keep
            </Button>
            <Button variant="dangerSolid" onClick={remove} pending={pending}>
              Remove
            </Button>
          </>
        ) : (
          <>
            {fixing ? (
              <Button variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            ) : !isNew ? (
              // Remove sits at the start of the footer, away from Save.
              <Button variant="danger" onClick={() => setConfirmRemove(true)} className="me-auto" data-remove-start="">
                Remove
              </Button>
            ) : null}
            {!dirty && !pending ? (
              <span className="text-meta text-ink-2" data-no-changes="">
                No changes yet
              </span>
            ) : null}
            <Button variant="primary" onClick={() => save()} pending={pending} disabled={!dirty} data-save-item="">
              Save
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4" data-item-sheet="" data-price-mode={d.price_mode}>
        {error ? <p className="rounded-xl bg-attention-tonal p-3 text-body text-attention" role="alert">{error}</p> : null}
        {confirmRemove ? (
          <p className="rounded-xl bg-surface-2 p-3 text-body text-ink" data-remove-confirm="">
            {statuses.some((s) => s.value === "paused")
              ? `Remove ${d.name_en || "this item"}? Callers stop hearing it. To stop for a while, keep it and set Status to Paused under More.`
              : `Remove ${d.name_en || "this item"}? Callers stop hearing it.`}
          </p>
        ) : null}
        {isNew && retail ? (
          <SegmentedControl
            label="Type"
            value={d.kind === "product" ? "product" : "service"}
            onChange={(v) => set({ kind: v === "product" ? "product" : "service", in_stock: v === "product" ? true : null })}
            items={[
              { value: "product", label: "Product" },
              { value: "service", label: "Service" },
            ]}
          />
        ) : null}
        <Field id="item-name" label="Name">
          {(p) => <Input {...p} value={d.name_en} maxLength={120} onChange={(e) => set({ name_en: e.target.value })} />}
        </Field>

        <fieldset className="space-y-2" data-price-section="">
          <legend className="mb-1.5 text-meta font-medium text-ink">Price</legend>
          <div id="item-price-choices" role="radiogroup" aria-label="Price type" className="flex flex-wrap gap-2" data-price-choices="">
            {PRICE_CHOICES.map((c) => {
              const on = d.price_mode === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => choose(c.key)}
                  className={cx(
                    "min-h-11 rounded-xl border px-3 text-meta font-medium",
                    deskShiftClass,
                    on ? "border-accent bg-accent-tonal text-accent" : "border-hairline bg-surface text-ink hover:border-ink-3",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          {d.price_mode === "range" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field id="item-min" label="Lowest (KSh)">
                {(p) => <Input {...p} inputMode="decimal" value={d.price_min} onChange={(e) => set({ price_min: e.target.value })} />}
              </Field>
              <Field id="item-max" label="Highest (KSh)">
                {(p) => <Input {...p} inputMode="decimal" value={d.price_max} onChange={(e) => set({ price_max: e.target.value })} />}
              </Field>
            </div>
          ) : needsAmount ? (
            <div className={d.price_mode === "per_unit" ? "grid grid-cols-2 gap-2" : ""}>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body text-ink-2">
                  {d.price_mode === "from" ? "From KSh" : "KSh"}
                </span>
                <Input
                  aria-label="Price in KSh"
                  inputMode="decimal"
                  value={d.price_amount}
                  onChange={(e) => setD((x) => withAmount(x, e.target.value))}
                  className={d.price_mode === "from" ? "pl-20" : "pl-12"}
                  data-amount=""
                />
              </div>
              {d.price_mode === "per_unit" ? (
                <div className="relative">
                  <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body text-ink-2">per</span>
                  <Input aria-label="Per" placeholder="sqm, hour, seat" value={d.unit} onChange={(e) => set({ unit: e.target.value })} className="pl-11" />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-body text-ink" data-price-says="">
              {NOTHING_LINE[d.price_mode as PriceChoice]}
            </p>
          )}
          {d.price_mode === "none" ? <p className="text-meta font-medium text-attention">Needs a price</p> : null}

        </fieldset>

        <div className="border-t border-hairline pt-2">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="item-more"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between text-body font-medium text-ink"
            data-more=""
          >
            <span>
              More
              {d.status !== "active" ? <span className="ml-2 text-meta text-ink-2">{d.status === "paused" ? "Paused" : "Not offered"}</span> : null}
            </span>
            <ChevronDownIcon aria-hidden="true" className={cx("size-5 text-ink-2", moreOpen && "rotate-180")} />
          </button>
          {moreOpen ? (
            <div id="item-more" className="space-y-4 pt-2" data-more-open="">
              {statuses.length ? (
              <div className="space-y-2" data-item-status="">
                <p className="text-meta font-medium text-ink">Status</p>
                <SegmentedControl
                  label="Status"
                  value={d.status}
                  onChange={(v) => set({ status: v === "paused" ? "paused" : v === "not_offered" ? "not_offered" : "active" })}
                  items={statuses}
                />
                {d.status === "paused" ? (
                  <Field id="item-note" label="Note for callers" hint="Optional. For example: back next week.">
                    {(p) => <Input {...p} value={d.status_note} maxLength={120} onChange={(e) => set({ status_note: e.target.value })} />}
                  </Field>
                ) : d.status === "not_offered" ? (
                  <p className="text-meta text-ink-2">Callers who ask hear that you don&apos;t offer it.</p>
                ) : null}
              </div>
              ) : null}
              {d.kind !== "product" && d.status !== "not_offered" ? (
                <Field id="item-excludes" label="Not included" hint="Optional. For example: outside windows.">
                  {(p) => <Input {...p} value={d.excludes_en} maxLength={500} onChange={(e) => set({ excludes_en: e.target.value })} />}
                </Field>
              ) : null}
              {d.kind === "product" ? (
                <>
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <span className="text-body text-ink">In stock</span>
                    <Switch label="In stock" checked={d.in_stock !== false} onCheckedChange={(v) => set({ in_stock: v ? true : false })} />
                  </div>
                  <div className="flex min-h-11 items-center justify-between gap-3" id="holdable">
                    <span className="text-body text-ink">Callers can ask you to hold it</span>
                    <Switch label="Callers can ask you to hold it" checked={d.holdable} onCheckedChange={(v) => set({ holdable: v })} />
                  </div>
                </>
              ) : null}
              <Field id="item-group" label="Group">
                {(p) => (
                  <>
                    <Input {...p} list="item-group-list" value={d.category} onChange={(e) => set({ category: e.target.value })} />
                    <datalist id="item-group-list">
                      {categories.map((c) => (
                        <option key={c.id} value={c.name_en} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              {d.price_mode !== "per_unit" ? (
                <Field id="item-unit" label="Per" hint={d.kind === "product" ? "Empty means each." : "Empty means per job."}>
                  {(p) => <Input {...p} value={d.unit} onChange={(e) => set({ unit: e.target.value })} />}
                </Field>
              ) : null}
              <Field id="item-alias" label="Other names callers use" hint="Separate with commas.">
                {(p) => <Input {...p} value={d.aliases} onChange={(e) => set({ aliases: e.target.value })} />}
              </Field>
              <Field id="item-desc" label="Short note">
                {(p) => <Input {...p} value={d.description_en} maxLength={300} onChange={(e) => set({ description_en: e.target.value })} />}
              </Field>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-body text-ink">Popular pick</span>
                <Switch label="Popular pick" checked={d.popular} onCheckedChange={(v) => set({ popular: v })} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

type ManySource = "paste" | "file" | "photo" | "website";
const MANY_SOURCES: ManySource[] = ["paste", "file", "photo", "website"];

/** Shrink a phone photo to 1600px JPEG in the browser so it fits the server action body and reads fast. */
async function shrinkPhoto(file: File): Promise<{ mimeType: string; base64: string } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.6, 0.45]) {
      const base64 = canvas.toDataURL("image/jpeg", q).split(",")[1] || "";
      if (base64 && base64.length <= PHOTO_MAX_BASE64) return { mimeType: "image/jpeg", base64 };
    }
    return null;
  } catch {
    return null;
  }
}

/** Paste a list: preview first, then one batch of up to 500. Replaces the Import tab for the catalogue. */
function PasteSheet({
  addMany,
  importPhoto,
  existing,
  homeServices,
  defaultKind,
  actions,
  onClose,
  onSaved,
}: {
  addMany: boolean;
  importPhoto: boolean;
  existing: KbItem[];
  homeServices: boolean;
  defaultKind: KbKind;
  actions: CatalogueActions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<ManySource>("paste");
  const [siteUrl, setSiteUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [kind, setKind] = useState<KbKind>(homeServices ? "service" : defaultKind);
  const [group, setGroup] = useState("");
  const [rows, setRows] = useState<KbPasteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Replace my list: off by default; one tap shows the confirm with the count and names that go.
  const [replacing, setReplacing] = useState(false);
  const summary = rows ? pasteSummary(rows) : null;
  const removed = rows ? replaceRemovals(rows, existing, kind) : [];
  const clashes = rows ? replaceKindClashes(rows, existing, kind) : [];
  const confirm = replaceConfirmLine(removed, kind);
  const preview = (body: string = text) =>
    start(async () => {
      setError(null);
      setReplacing(false);
      const r = await actions.previewPaste(body);
      if (!r.ok) setError(r.error);
      else setRows(r.rows);
    });
  // A file is read here as plain text (no formulas run), turned into lines, then the same preview as a paste.
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > IMPORT_FILE_MAX_BYTES) return setError("That file is over 1 MB. Save a smaller part and try again.");
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) return setError("Use a CSV, TSV or text file. From Excel: Save As, CSV.");
    const lines = delimitedToPasteText(await file.text());
    if (!lines.trim()) return setError("We could not find any items in that file.");
    setFileName(file.name);
    setText(lines);
    preview(lines);
  };
  // Photo or website: the server reads it into lines; the owner checks the same preview before anything is saved.
  const fromLines = (r: { ok: true; text: string } | { ok: false; error: string }) => {
    if (!r.ok) return setError(r.error);
    setText(r.text);
    preview(r.text);
  };
  const readPhoto = (file: File | undefined) =>
    start(async () => {
      if (!file || !actions.photoToLines) return;
      setError(null);
      if (!/^image\//.test(file.type)) return setError("Use a photo (JPG, PNG or WebP).");
      const shrunk = await shrinkPhoto(file);
      if (!shrunk) return setError("We could not open that photo. Try another one.");
      setFileName(file.name);
      fromLines(await actions.photoToLines(shrunk.mimeType, shrunk.base64));
    });
  const readSite = () =>
    start(async () => {
      if (!actions.websiteToLines || !siteUrl.trim()) return;
      setError(null);
      fromLines(await actions.websiteToLines(siteUrl));
    });
  const add = (mode: "append" | "replace") =>
    start(async () => {
      if (!summary) return;
      const r = await actions.importPaste(summary.ready, kind, group, mode);
      if (!r.ok) setError(r.error);
      else {
        const when = r.restamped === false ? "Calls will use it after the next check." : "On calls within a minute.";
        notify(
          mode === "replace"
            ? `Your list is now these ${summary.ready.length}${removed.length ? `. Removed ${removed.length}` : ""}. ${when}`
            : `${[summary.adds ? `Added ${summary.adds}` : "", summary.updates ? `updated ${summary.updates}` : ""].filter(Boolean).join(", ") || "Saved"}. ${when}`.replace(/^updated/, "Updated"),
        );
        onSaved();
      }
    });
  return (
    <Sheet
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={replacing ? "Replace my list" : addMany ? "Add many" : "Paste a list"}
      size="lg"
      description={summary ? pasteSummaryLine(summary) : undefined}
      footer={
        rows && summary ? (
          replacing ? (
            <>
              <Button variant="ghost" onClick={() => setReplacing(false)}>
                Keep my list
              </Button>
              <Button variant="dangerSolid" onClick={() => add("replace")} pending={pending} disabled={!summary.ready.length || clashes.length > 0} data-replace-confirm-button="">
                {removed.length ? `Replace and remove ${removed.length}` : "Replace my list"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setRows(null)}>
                Back
              </Button>
              <Button variant="primary" onClick={() => add("append")} pending={pending} disabled={!summary.ready.length}>
                {`Add ${summary.ready.length}`}
              </Button>
            </>
          )
        ) : (
          source === "file" || source === "photo" ? null : source === "website" ? (
            <Button variant="primary" onClick={readSite} pending={pending} disabled={!siteUrl.trim()} data-add-many-site-read="">
              Read the page
            </Button>
          ) : (
            <Button variant="primary" onClick={() => preview()} pending={pending} disabled={!text.trim()}>
              Preview
            </Button>
          )
        )
      }
    >
      <div className="space-y-3" data-paste-sheet="" data-paste-step={rows ? "preview" : "text"}>
        {error ? <p className="rounded-xl bg-attention-tonal p-3 text-body text-attention" role="alert">{error}</p> : null}
        {!rows ? (
          <>
            {!homeServices ? (
              <SegmentedControl
                label="These are"
                value={kind === "product" ? "product" : "service"}
                onChange={(v) => setKind(v === "product" ? "product" : "service")}
                items={[
                  { value: "product", label: "Products" },
                  { value: "service", label: "Services" },
                ]}
              />
            ) : null}
            {addMany ? (
              <SegmentedControl
                label="From"
                value={source}
                onChange={(v) => setSource(MANY_SOURCES.includes(v as ManySource) ? (v as ManySource) : "paste")}
                items={[
                  { value: "paste", label: "Paste" },
                  { value: "file", label: "File" },
                  ...(importPhoto
                    ? [
                        { value: "photo", label: "Photo" },
                        { value: "website", label: "Website" },
                      ]
                    : []),
                ]}
              />
            ) : null}
            {source === "photo" ? (
              <Field id="add-many-photo" label="Photo of your price list" hint="A menu, rate card or price board. We read it, you check every line before anything is saved.">
                {(p) => (
                  <input
                    {...p}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    onChange={(e) => readPhoto(e.target.files?.[0])}
                    className="block min-h-11 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-body text-ink file:me-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:text-meta file:font-semibold"
                    data-add-many-photo=""
                  />
                )}
              </Field>
            ) : source === "website" ? (
              <Field id="add-many-site" label="Your website page with prices" hint="For example: yourshop.co.ke/prices. We keep the lines that have a price, you check them next.">
                {(p) => <Input {...p} type="url" inputMode="url" value={siteUrl} maxLength={500} placeholder="https://" onChange={(e) => setSiteUrl(e.target.value)} data-add-many-site="" />}
              </Field>
            ) : source === "file" ? (
              <Field id="add-many-file" label="CSV or text file" hint="One item per row, name and price. Excel: Save As, CSV. Up to 1 MB and 500 rows.">
                {(p) => (
                  <input
                    {...p}
                    type="file"
                    accept={IMPORT_FILE_ACCEPT}
                    onChange={(e) => void readFile(e.target.files?.[0])}
                    className="block min-h-11 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-body text-ink file:me-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:text-meta file:font-semibold"
                    data-add-many-file=""
                  />
                )}
              </Field>
            ) : (
              <Field id="paste-text" label="One item per line" hint="Price at the end is optional. For example: Deep clean, 6,000 to 12,000. Up to 500 lines.">
                {(p) => <Textarea {...p} rows={10} value={text} onChange={(e) => setText(e.target.value)} />}
              </Field>
            )}
            {pending && source === "photo" ? <p className="text-meta text-ink-2" role="status">Reading the photo…</p> : null}
            {fileName && (source === "file" || source === "photo") ? <p className="text-meta text-ink-2">{fileName}</p> : null}
            <Field id="paste-group" label="Group" hint="Optional. New items join this group.">
              {(p) => <Input {...p} value={group} maxLength={120} onChange={(e) => setGroup(e.target.value)} />}
            </Field>
          </>
        ) : (
          <>
          {replacing ? (
            <div className="space-y-1 rounded-xl bg-attention-tonal p-3" role="alert" data-replace-confirm="" data-remove-count={removed.length}>
              <p className="text-body font-semibold text-attention">{confirm.title}</p>
              {confirm.names ? <p className="text-body text-ink">{confirm.names}</p> : null}
              <p className="text-meta text-ink">
                {`Your ${kind === "product" ? "products" : "services"} become the ${summary?.ready.length ?? 0} below. Removed items include paused and not offered ones, and callers stop hearing them.`}
              </p>
              {clashes.length ? (
                <p className="text-meta font-semibold text-attention">
                  {`${clashes.map((c) => c.name_en).slice(0, 3).join(", ")} ${clashes.length === 1 ? "is" : "are"} already a ${kind === "product" ? "service" : "product"}. Remove ${clashes.length === 1 ? "that line" : "those lines"} or use Add instead.`}
                </p>
              ) : null}
            </div>
          ) : existing.some((e) => e.kind === kind && e.status !== "hidden") ? (
            <button type="button" onClick={() => setReplacing(true)} className="min-h-11 text-meta font-semibold text-accent" data-replace-start="">
              Replace my list instead
            </button>
          ) : null}
          <ul className="divide-y divide-hairline rounded-xl border border-hairline" data-paste-preview="">
            {rows.map((r) => (
              <li key={r.line} className="flex min-h-12 items-center gap-3 px-3 py-2" data-paste-row={r.error ? "skip" : r.match_id ? "update" : "new"}>
                <span className={cx("min-w-0 flex-1 truncate text-body", r.error ? "text-ink-2" : "text-ink")}>{r.name_en || r.raw}</span>
                <span className={cx("shrink-0 text-right text-meta", r.error || r.price_mode === "none" ? "font-semibold text-attention" : "text-ink-2")}>{pasteRowLine(r)}</span>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
