"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { Empty } from "@/components/ui/Empty";
import { notify } from "@/components/ui/DeskNotice";
import {
  CHECK_FIX,
  CHECK_LABEL,
  ISSUE_LINE,
  displayPrice,
  draftErrors,
  draftFromItem,
  type KbCategory,
  type KbDraft,
  type KbItem,
  type KbKind,
  type KbPriceMode,
  type KbReadiness,
  type KbSnapshotRow,
} from "@/lib/kbCore";
import {
  compileKbAction,
  decideSwNameAction,
  hideKbItemAction,
  saveKbItemAction,
  setKbFlagAction,
  type KbActionResult,
} from "@/app/(desk)/settings/knowledge/actions";

type Props = {
  items: KbItem[];
  categories: KbCategory[];
  live: KbSnapshotRow | null;
  latest: KbSnapshotRow | null;
  readiness: KbReadiness;
  liveVersion: number | null;
  readyVersion: number | null;
};

const PRICE_MODES: { key: KbPriceMode; label: string }[] = [
  { key: "fixed", label: "One price" },
  { key: "range", label: "Price range" },
  { key: "from", label: "Starting from" },
  { key: "quote", label: "Custom quote" },
  { key: "free", label: "Free" },
  { key: "none", label: "No price yet" },
];

const card = "rounded-2xl border border-hairline bg-surface p-4";
const kicker = "pb-2 text-meta font-semibold uppercase tracking-wide text-ink-2";

export function KbScreen({ items, categories, live, latest, readiness, liveVersion, readyVersion }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"all" | KbKind>("all");
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [editing, setEditing] = useState<KbDraft | null>(null);
  const [swEdit, setSwEdit] = useState<{ id: string; text: string } | null>(null);

  const run = (fn: () => Promise<KbActionResult>, done?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) notify(r.error, { tone: "error" });
      else {
        if (done) notify(done);
        router.refresh();
      }
    });

  const shown = useMemo(() => (kind === "all" ? items : items.filter((i) => i.kind === kind)), [items, kind]);
  const groups = useMemo(() => {
    const byCat = new Map<string, KbItem[]>();
    for (const it of shown) {
      const k = it.category_id || "_none";
      byCat.set(k, [...(byCat.get(k) || []), it]);
    }
    const name = (id: string) => categories.find((c) => c.id === id)?.name_en || "Other";
    return [...byCat.entries()].map(([id, list]) => ({ id, name: id === "_none" ? "Other" : name(id), list }));
  }, [shown, categories]);
  const waiting = items.filter((i) => i.name_sw_state === "suggested" && i.name_sw_suggested);
  const issues = (latest?.issues || []).filter((i) => i.severity !== "info");
  const failed = latest && latest.status === "failed" && latest.version !== liveVersion;
  const onCalls = readiness?.passed && readyVersion != null && readyVersion === liveVersion;
  const nameOf = (id?: string) => items.find((i) => i.id === id)?.name_en;
  const counts = { all: items.length, service: items.filter((i) => i.kind === "service").length, product: items.filter((i) => i.kind === "product").length };

  return (
    <div className="space-y-4 px-4 py-4 md:px-0" data-kb-v2="">
      <header>
        <h1 className="text-title font-semibold text-ink">Catalogue</h1>
        <p className="mt-1 text-body text-ink-2">What you sell, what it costs, and what callers hear when they ask.</p>
      </header>

      <section className={onCalls ? "rounded-2xl border border-hairline border-l-4 border-l-brand bg-surface p-4" : card} data-kb-ready={onCalls ? "yes" : "no"}>
        <p className="text-body font-semibold text-ink">{onCalls ? "Your Business Assistant answers from this catalogue" : "Not on calls yet"}</p>
        <p className="mt-1 text-meta text-ink-2">
          {onCalls
            ? "Every check passed. Changes you save here reach calls within a minute."
            : "Your calls use the earlier setup until these checks pass."}
        </p>
        {readiness && !onCalls ? (
          <ul className="mt-3 space-y-2">
            {readiness.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-meta">
                <span className={c.ok ? "text-ink-2" : "font-semibold text-attention"}>{c.ok ? "Done" : "To do"}</span>
                <span className="min-w-0 flex-1 text-ink">
                  {CHECK_LABEL[c.id] || c.id}
                  {!c.ok && c.fix ? <span className="block text-ink-2">{c.fix}</span> : null}
                </span>
                {!c.ok && CHECK_FIX[c.id] ? (
                  <Link href={CHECK_FIX[c.id]} className="text-meta font-semibold text-accent">
                    Fix
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3">
          <Button variant="tonal" size="sm" pending={pending} onClick={() => run(compileKbAction, "Checking now. This takes a few seconds.")}>
            Check again
          </Button>
        </div>
      </section>

      {failed ? (
        <section className="rounded-xl bg-attention-tonal p-3 text-body text-attention" role="status">
          Your last change could not be used, so calls still use the earlier catalogue. Fix the items below, then save again.
        </section>
      ) : null}

      {live?.doc?.preview?.length ? (
        <section className={card} data-kb-preview="">
          <div className="flex items-center justify-between gap-2">
            <h2 className={kicker}>What callers hear</h2>
            <Segmented
              label="Language"
              items={[
                { key: "en", label: "English", active: lang === "en" },
                { key: "sw", label: "Swahili", active: lang === "sw" },
              ]}
              onSelect={(k) => setLang(k === "sw" ? "sw" : "en")}
            />
          </div>
          <ul className="mt-2 space-y-3">
            {live.doc.preview.map((p) => (
              <li key={p.asked}>
                <p className="text-meta text-ink-2">Caller: {p.asked}</p>
                <p className="text-body text-ink">{(lang === "sw" ? p.sw : p.en) || "Nothing to say yet."}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {waiting.length ? (
        <section className={card} data-kb-swahili="">
          <h2 className={kicker}>Swahili names to check</h2>
          <p className="text-meta text-ink-2">Callers only hear a Swahili name after you approve it.</p>
          <ul className="mt-2 divide-y divide-hairline">
            {waiting.slice(0, 30).map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 text-body text-ink">
                  {it.name_en}
                  <span className="block text-meta text-ink-2">Suggested: {it.name_sw_suggested}</span>
                </span>
                {swEdit?.id === it.id ? (
                  <>
                    <Input aria-label={`Swahili name for ${it.name_en}`} value={swEdit.text} onChange={(e) => setSwEdit({ id: it.id, text: e.target.value })} className="max-w-56" />
                    <Button size="sm" variant="primary" pending={pending} onClick={() => run(() => decideSwNameAction(it.id, "edit", swEdit.text), "Saved")}>
                      Save
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="primary" pending={pending} onClick={() => run(() => decideSwNameAction(it.id, "approve"), "Approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSwEdit({ id: it.id, text: it.name_sw_suggested || "" })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" pending={pending} onClick={() => run(() => decideSwNameAction(it.id, "reject"))}>
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
          <h2 className={kicker}>Worth fixing</h2>
          <ul className="space-y-1 text-meta">
            {issues.slice(0, 10).map((i, n) => (
              <li key={`${i.code}-${i.item_id || n}`} className="text-ink">
                {i.item_id ? <span className="font-semibold">{nameOf(i.item_id) || "An item"} </span> : null}
                {ISSUE_LINE[i.code] || i.detail || i.code}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section data-kb-items="">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <Segmented
            label="Show"
            items={[
              { key: "all", label: "All", count: counts.all, active: kind === "all" },
              { key: "service", label: "Services", count: counts.service, active: kind === "service" },
              { key: "product", label: "Products", count: counts.product, active: kind === "product" },
            ]}
            onSelect={(k) => setKind(k === "service" || k === "product" ? k : "all")}
          />
          <Button variant="primary" size="sm" onClick={() => setEditing(draftFromItem(null, categories, kind === "product" ? "product" : "service"))}>
            Add item
          </Button>
        </div>
        {!items.length ? (
          <Empty title="Nothing here yet" line="Add what you sell so callers can hear prices." />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.id} className="overflow-hidden rounded-xl border border-hairline">
                <p className="bg-surface-2 px-4 py-2 text-meta font-semibold text-ink-2">
                  {g.name} <span className="font-normal">({g.list.length})</span>
                </p>
                <ul className="divide-y divide-hairline">
                  {g.list.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 px-4 py-2">
                      <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setEditing(draftFromItem(it, categories))}>
                        <span className="block truncate text-body font-semibold text-ink">{it.name_en}</span>
                        <span className="block text-meta text-ink-2">
                          {displayPrice(it) || "No price"}
                          {it.unit ? ` per ${it.unit}` : ""}
                          {it.popular ? " · Popular" : ""}
                          {it.in_stock === false ? " · Out of stock" : ""}
                        </span>
                      </button>
                      <Switch
                        label={`${it.name_en} is popular`}
                        checked={it.popular}
                        disabled={pending}
                        onCheckedChange={(v) => run(() => setKbFlagAction(it.id, { popular: v }))}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-meta text-ink-2">The switch marks a popular pick. Callers hear popular picks first.</p>
          </div>
        )}
      </section>

      {editing ? <ItemSheet draft={editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} /> : null}
    </div>
  );
}

function ItemSheet({ draft, categories, onClose, onSaved }: { draft: KbDraft; categories: KbCategory[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<KbDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<KbDraft>) => setD((x) => ({ ...x, ...patch }));
  const save = () => {
    const errs = draftErrors(d);
    if (errs.length) return setError(errs.join(" "));
    start(async () => {
      const r = await saveKbItemAction(d);
      if (!r.ok) setError(r.error);
      else {
        notify("Saved. Calls use it within a minute.");
        onSaved();
      }
    });
  };
  const remove = () =>
    start(async () => {
      if (!d.id) return onClose();
      const r = await hideKbItemAction(d.id);
      if (!r.ok) setError(r.error);
      else onSaved();
    });
  return (
    <Sheet
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={d.id ? "Edit item" : "Add item"}
      footer={
        <>
          {d.id ? (
            <Button variant="danger" onClick={remove} pending={pending}>
              Remove
            </Button>
          ) : null}
          <Button variant="primary" onClick={save} pending={pending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <p className="rounded-xl bg-attention-tonal p-3 text-body text-attention">{error}</p> : null}
        <Field id="kb-name" label="Name">
          {(p) => <Input {...p} value={d.name_en} maxLength={120} onChange={(e) => set({ name_en: e.target.value })} />}
        </Field>
        <Field id="kb-kind" label="Type">
          {(p) => (
            <Select {...p} value={d.kind} onChange={(e) => set({ kind: e.target.value as KbKind })}>
              <option value="service">Service</option>
              <option value="product">Product</option>
              <option value="package">Package</option>
            </Select>
          )}
        </Field>
        <Field id="kb-cat" label="Group" hint="Callers hear groups first, like Tomatoes or Home cleaning.">
          {(p) => (
            <>
              <Input {...p} list="kb-cat-list" value={d.category} onChange={(e) => set({ category: e.target.value })} />
              <datalist id="kb-cat-list">
                {categories.map((c) => (
                  <option key={c.id} value={c.name_en} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field id="kb-mode" label="Price">
          {(p) => (
            <Select {...p} value={d.price_mode} onChange={(e) => set({ price_mode: e.target.value as KbPriceMode })}>
              {PRICE_MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {d.price_mode === "range" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field id="kb-min" label="Lowest (KSh)">
              {(p) => <Input {...p} inputMode="decimal" value={d.price_min} onChange={(e) => set({ price_min: e.target.value })} />}
            </Field>
            <Field id="kb-max" label="Highest (KSh)">
              {(p) => <Input {...p} inputMode="decimal" value={d.price_max} onChange={(e) => set({ price_max: e.target.value })} />}
            </Field>
          </div>
        ) : ["fixed", "per_unit", "from"].includes(d.price_mode) ? (
          <Field id="kb-amount" label="Amount (KSh)">
            {(p) => <Input {...p} inputMode="decimal" value={d.price_amount} onChange={(e) => set({ price_amount: e.target.value })} />}
          </Field>
        ) : null}
        <Field id="kb-unit" label="Per" hint="Leave empty for a whole job. For example: seedling, kg, tray, hour.">
          {(p) => <Input {...p} value={d.unit} onChange={(e) => set({ unit: e.target.value })} />}
        </Field>
        <Field id="kb-alias" label="Other names callers use" hint="Separate with commas.">
          {(p) => <Input {...p} value={d.aliases} onChange={(e) => set({ aliases: e.target.value })} />}
        </Field>
        <Field id="kb-desc" label="Short note">
          {(p) => <Input {...p} value={d.description_en} maxLength={300} onChange={(e) => set({ description_en: e.target.value })} />}
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-body text-ink">Popular pick</span>
          <Switch label="Popular pick" checked={d.popular} onCheckedChange={(v) => set({ popular: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-body text-ink">In stock</span>
          <Switch label="In stock" checked={d.in_stock !== false} onCheckedChange={(v) => set({ in_stock: v ? null : false })} />
        </div>
      </div>
    </Sheet>
  );
}
