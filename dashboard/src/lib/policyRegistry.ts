/**
 * Policies screen registry. ONE place defines, per trade ("niche"), which policy topics
 * an owner sees, the 1-3 word options, and the line callers hear in English and Kiswahili.
 *
 * Adding a niche = adding an entry to NICHES (and, if it needs a new topic, an entry to
 * TOPICS). No new screen, no schema change: answers are stored at
 * business_policies.rules.<topic> and the spoken line at business_policies.policy_lines.<topic>.
 * The contract Brain reads is in docs/reference/platform/POLICIES.md.
 */

export type Lang = "en" | "sw";
export type Spoken = { en: string; sw: string };
export type Scalar = string | number | boolean;

/** One chip. `speak` fills the {field} slot in the answer's line. */
export type FollowOption = { value: Scalar; label: string; speak: Spoken };
export type FollowUp = {
  field: string;
  label: string;
  hint?: string;
  multi?: boolean;
  options: FollowOption[];
  /** Picked when the owner first chooses the answer. */
  initial: Scalar | Scalar[];
};
export type Answer = {
  id: string;
  label: string;
  /** Fixed fields stored with this answer, e.g. { allowed: false }. */
  set: Record<string, Scalar>;
  follow?: FollowUp[];
  /** Line template. {field} is replaced by the picked chip's speak text. */
  line: Spoken;
  /** Shown under the radios when this answer hides follow-ups. */
  offNote?: string;
};
export type TopicDef = {
  /** Key under business_policies.rules. */
  id: string;
  /** Row label on the list. */
  title: string;
  /** Header on the topic screen. */
  screenTitle: string;
  question: string;
  answers: Answer[];
  /** Legacy text key the older call paths read. Topics sharing a key are joined in list order. */
  textKey?: "returns" | "delivery" | "cancellation" | "warranty";
  /** Small print under "Callers hear". */
  hearNote?: string;
};
export type Section = { id: string; label: string; topics: string[] };
export type NicheDef = {
  id: string;
  label: string;
  /** tenants.vertical values that pick this niche. */
  verticals?: string[];
  /** Words in the business name or category that pick this niche. */
  keywords?: string[];
  sections: Section[];
  /** One short line under the page intro. */
  intro?: string;
  /** Per-niche wording, e.g. "item" vs "booking". Keyed "<topic>.<answer>". */
  lines?: Record<string, Spoken>;
};

export const CUSTOM = "custom";
export const NOT_SET = "not_set";
export const OWN_WORDS_MAX = 160;
export const NOT_SET_LINE: Spoken = { en: "The team will confirm.", sw: "Timu itathibitisha." };

const hrs = (h: number, label: string): FollowOption =>
  h === 0
    ? { value: 0, label, speak: { en: "any time before", sw: "wakati wowote kabla" } }
    : { value: h, label, speak: { en: `${h} hours before`, sw: `saa ${h} kabla` } };

export const TOPICS: Record<string, TopicDef> = {
  cancellation: {
    id: "cancellation",
    title: "Cancel",
    screenTitle: "Cancel a booking",
    question: "Cancel allowed?",
    textKey: "cancellation",
    hearNote: "Moving a booking is set on its own.",
    answers: [
      {
        id: "yes",
        label: "Yes",
        set: { allowed: true },
        follow: [
          { field: "notice_hours", label: "Notice", initial: 24, options: [hrs(0, "Any time"), hrs(6, "6 hrs"), hrs(24, "24 hrs"), hrs(48, "48 hrs")] },
          {
            field: "fee",
            label: "Late cancel",
            initial: "none",
            options: [
              { value: "none", label: "Free", speak: { en: "There is no charge.", sw: "Hakuna malipo." } },
              { value: "deposit_kept", label: "Deposit", speak: { en: "After that, we keep the deposit.", sw: "Baada ya hapo, amana haitarudishwa." } },
              { value: "flat", label: "Fee", speak: { en: "After that, there is a fee.", sw: "Baada ya hapo, kuna ada." } },
            ],
          },
        ],
        line: { en: "You can cancel up to {notice_hours}. {fee}", sw: "Unaweza kughairi hadi {notice_hours}. {fee}" },
      },
      { id: "no", label: "No", set: { allowed: false }, line: { en: "We don't accept cancellations.", sw: "Hatukubali kughairi." }, offNote: "Notice and fee are off." },
    ],
  },
  booking_changes: {
    id: "booking_changes",
    title: "Move",
    screenTitle: "Move a booking",
    question: "Moving allowed?",
    textKey: "cancellation",
    answers: [
      {
        id: "yes",
        label: "Yes",
        set: { allowed: true },
        follow: [{ field: "notice_hours", label: "Notice", initial: 24, options: [hrs(0, "Any time"), hrs(6, "6 hrs"), hrs(24, "24 hrs"), hrs(48, "48 hrs")] }],
        line: { en: "You can move a booking up to {notice_hours}.", sw: "Unaweza kubadilisha siku hadi {notice_hours}." },
      },
      { id: "no", label: "No", set: { allowed: false }, line: { en: "We don't move bookings.", sw: "Hatubadilishi siku za kazi." }, offNote: "Notice is off." },
    ],
  },
  no_show: {
    id: "no_show",
    title: "Late",
    screenTitle: "Customer late",
    question: "Customer late?",
    textKey: "cancellation",
    answers: [
      {
        id: "wait",
        label: "Wait",
        set: { charge: "none" },
        follow: [{ field: "wait_minutes", label: "Wait for", initial: 15, options: [10, 15, 30].map((m) => ({ value: m, label: `${m} min`, speak: { en: `${m} minutes`, sw: `dakika ${m}` } })) }],
        line: { en: "We wait {wait_minutes}, then call you.", sw: "Tunasubiri {wait_minutes}, kisha tunakupigia." },
      },
      {
        id: "callout",
        label: "Call-out fee",
        set: { charge: "callout" },
        follow: [{ field: "wait_minutes", label: "Wait for", initial: 15, options: [10, 15, 30].map((m) => ({ value: m, label: `${m} min`, speak: { en: `${m} minutes`, sw: `dakika ${m}` } })) }],
        line: { en: "We wait {wait_minutes}. After that, a call-out fee applies.", sw: "Tunasubiri {wait_minutes}. Baada ya hapo, kuna ada ya safari." },
      },
    ],
  },
  warranty: {
    id: "warranty",
    title: "Guarantee",
    screenTitle: "Guarantee",
    question: "Do you give a guarantee?",
    textKey: "warranty",
    answers: [
      {
        id: "yes",
        label: "Yes",
        set: { none: false },
        follow: [{ field: "months", label: "How long", initial: 3, options: [1, 3, 6, 12].map((m) => ({ value: m, label: m === 12 ? "1 year" : `${m} mo`, speak: { en: m === 12 ? "1 year" : `${m} month${m === 1 ? "" : "s"}`, sw: m === 12 ? "mwaka 1" : `miezi ${m}` } })) }],
        line: { en: "We give a {months} guarantee on our work.", sw: "Tunatoa dhamana ya {months} kwa kazi yetu." },
      },
      { id: "no", label: "No", set: { none: true }, line: { en: "We don't give a guarantee.", sw: "Hatutoi dhamana." } },
    ],
  },
  returns: {
    id: "returns",
    title: "Returns",
    screenTitle: "Returns",
    question: "Returns?",
    textKey: "returns",
    answers: [
      {
        id: "refund",
        label: "Refund",
        set: { mode: "refund_or_exchange" },
        follow: [
          { field: "days", label: "Days", initial: 7, options: [3, 7, 14].map((d) => ({ value: d, label: String(d), speak: { en: `${d} days`, sw: `siku ${d}` } })) },
          {
            field: "conditions",
            label: "If",
            hint: "Pick any",
            multi: true,
            initial: ["unused", "receipt"],
            options: [
              { value: "unused", label: "Unused", speak: { en: "unused", sw: "haijatumika" } },
              { value: "receipt", label: "Receipt", speak: { en: "with a receipt", sw: "una risiti" } },
              { value: "packaging", label: "Boxed", speak: { en: "in the box", sw: "iko kwenye boksi" } },
            ],
          },
        ],
        line: { en: "We refund or exchange within {days}{conditions: if }.", sw: "Tunarudisha pesa au kubadilisha bidhaa ndani ya {days}{conditions: kama }." },
      },
      {
        id: "exchange",
        label: "Exchange",
        set: { mode: "exchange" },
        follow: [{ field: "days", label: "Days", initial: 7, options: [3, 7, 14].map((d) => ({ value: d, label: String(d), speak: { en: `${d} days`, sw: `siku ${d}` } })) }],
        line: { en: "We exchange items within {days}.", sw: "Tunabadilisha bidhaa ndani ya {days}." },
      },
      { id: "no", label: "No", set: { mode: "none" }, line: { en: "We don't take returns.", sw: "Hatupokei bidhaa zilizorudishwa." } },
    ],
  },
  delivery: {
    id: "delivery",
    title: "Delivery",
    screenTitle: "Delivery",
    question: "Do you deliver?",
    textKey: "delivery",
    hearNote: "Areas and fees are set in Service areas.",
    answers: [
      {
        id: "yes",
        label: "Yes",
        set: { mode: "deliver" },
        follow: [
          {
            field: "speed",
            label: "How fast",
            initial: "same_day",
            options: [
              { value: "same_day", label: "Same day", speak: { en: "the same day", sw: "siku hiyo hiyo" } },
              { value: "next_day", label: "Next day", speak: { en: "the next day", sw: "siku inayofuata" } },
              { value: "two_three_days", label: "2-3 days", speak: { en: "in 2 to 3 days", sw: "ndani ya siku 2 hadi 3" } },
            ],
          },
        ],
        line: { en: "We deliver {speed}.", sw: "Tunaleta {speed}." },
      },
      { id: "pickup", label: "Pickup only", set: { mode: "pickup_only" }, line: { en: "We don't deliver. You collect from us.", sw: "Hatuleti. Unachukua kwetu." } },
    ],
  },
};

export const NICHES: NicheDef[] = [
  {
    id: "cleaning",
    label: "Cleaning",
    keywords: ["clean", "dusted", "usafi"],
    sections: [
      { id: "bookings", label: "Bookings", topics: ["cancellation", "booking_changes", "no_show"] },
      { id: "money", label: "Money", topics: ["payment", "warranty"] },
    ],
  },
  {
    id: "retail",
    label: "Shop",
    verticals: ["retail", "shop"],
    keywords: ["shop", "store", "duka", "boutique"],
    intro: "Shop topics: returns, delivery.",
    sections: [
      { id: "orders", label: "Orders", topics: ["returns", "delivery"] },
      { id: "money", label: "Money", topics: ["payment", "warranty"] },
    ],
    lines: { "warranty.yes": { en: "We give a {months} guarantee on what we sell.", sw: "Tunatoa dhamana ya {months} kwa bidhaa tunazouza." } },
  },
  {
    id: "generic",
    label: "Business",
    sections: [
      { id: "bookings", label: "Bookings", topics: ["cancellation", "booking_changes"] },
      { id: "money", label: "Money", topics: ["payment", "warranty"] },
    ],
  },
];

/** "payment" is a link row: its own editor and line live in lib/payments. */
export const PAYMENT_TOPIC = "payment";

export function nicheById(id: string, niches: NicheDef[] = NICHES): NicheDef {
  return niches.find((n) => n.id === id) ?? niches.find((n) => n.id === "generic")!;
}

/** Pick the niche: vertical first, then a keyword in the category or business name, else generic. */
export function nicheFor(t: { vertical?: string | null; business_category?: string | null; business_name?: string | null }, niches: NicheDef[] = NICHES): NicheDef {
  const v = String(t.vertical ?? "").toLowerCase();
  const byVertical = niches.find((n) => n.verticals?.includes(v));
  if (byVertical) return byVertical;
  const words = `${t.business_category ?? ""} ${t.business_name ?? ""}`.toLowerCase();
  return niches.find((n) => n.keywords?.some((k) => words.includes(k))) ?? nicheById("generic", niches);
}

export function nicheTopics(niche: NicheDef, topics: Record<string, TopicDef> = TOPICS): TopicDef[] {
  return niche.sections.flatMap((s) => s.topics).filter((id) => id !== PAYMENT_TOPIC).map((id) => topics[id]).filter(Boolean);
}

/** Answers on screen: the topic's own, then Write my own and Not set. */
export function answersFor(topic: TopicDef): Array<{ id: string; label: string }> {
  return [...topic.answers.map((a) => ({ id: a.id, label: a.label })), { id: CUSTOM, label: "Write my own" }, { id: NOT_SET, label: "Not set" }];
}

export type Rule = Record<string, unknown>;
export type Draft = { answer: string; values: Record<string, Scalar | Scalar[]>; note: string; note_sw: string; checked: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Which answer a stored rule is. Stored `answer` wins; older rows are matched on their fixed fields. */
export function answerOf(topic: TopicDef, rule: Rule | null | undefined): string {
  if (!rule) return NOT_SET;
  if (rule.mode === CUSTOM) return CUSTOM;
  if (typeof rule.answer === "string" && topic.answers.some((a) => a.id === rule.answer)) return rule.answer;
  const hit = topic.answers.find((a) => Object.entries(a.set).every(([k, v]) => same(rule[k] ?? defaultOf(k), v)));
  return hit?.id ?? topic.answers[0].id;
}
// Older rows leave these out: allowed defaults to true, none to false.
const defaultOf = (k: string) => (k === "allowed" ? true : k === "none" ? false : undefined);

export function draftFrom(topic: TopicDef, rule: Rule | null | undefined): Draft {
  const answer = answerOf(topic, rule);
  const values: Draft["values"] = {};
  for (const a of topic.answers) for (const f of a.follow ?? []) if (values[f.field] === undefined) values[f.field] = f.initial;
  for (const k of Object.keys(values)) {
    const v = rule?.[k];
    if (v !== undefined && v !== null) values[k] = v as Scalar | Scalar[];
  }
  return { answer, values, note: String(rule?.note ?? ""), note_sw: String(rule?.note_sw ?? ""), checked: answer === CUSTOM && Boolean(rule?.note) };
}

/** The rule to store, or null for Not set (removes the topic). */
export function ruleFromDraft(topic: TopicDef, d: Draft): Rule | null {
  if (d.answer === NOT_SET) return null;
  if (d.answer === CUSTOM) {
    const out: Rule = { answer: CUSTOM, mode: CUSTOM, note: d.note.trim() };
    if (d.note_sw.trim()) out.note_sw = d.note_sw.trim();
    return out;
  }
  const a = topic.answers.find((x) => x.id === d.answer);
  if (!a) return null;
  const out: Rule = { answer: a.id, ...a.set };
  for (const f of a.follow ?? []) out[f.field] = d.values[f.field] ?? f.initial;
  return out;
}

function fill(template: string, a: Answer, rule: Rule, lang: Lang): string {
  return template
    .replace(/\{(\w+)(?::([^}]*))?\}/g, (_m, field: string, lead?: string) => {
      const f = a.follow?.find((x) => x.field === field);
      if (!f) return "";
      const raw = rule[field];
      const vals = Array.isArray(raw) ? raw : [raw];
      const parts = vals.map((v) => f.options.find((o) => o.value === v)?.speak[lang]).filter(Boolean) as string[];
      if (!parts.length) return "";
      const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}${lang === "sw" ? " na " : ", "}${parts[parts.length - 1]}`;
      return `${lead ?? ""}${joined}`;
    })
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

/** What callers hear for one topic. Not set (null) gives the "team will confirm" line. */
export function spokenLine(topic: TopicDef, rule: Rule | null | undefined, niche?: NicheDef): Spoken {
  if (!rule) return NOT_SET_LINE;
  const answer = answerOf(topic, rule);
  if (answer === CUSTOM) {
    const en = String(rule.note ?? "").trim();
    return { en: en || NOT_SET_LINE.en, sw: String(rule.note_sw ?? "").trim() || NOT_SET_LINE.sw };
  }
  const a = topic.answers.find((x) => x.id === answer)!;
  const line = niche?.lines?.[`${topic.id}.${a.id}`] ?? a.line;
  return { en: fill(line.en, a, rule, "en"), sw: fill(line.sw, a, rule, "sw") };
}

export type Status = "set" | "no" | "custom" | "not_set";
export function topicStatus(topic: TopicDef, rule: Rule | null | undefined): Status {
  const a = answerOf(topic, rule);
  return a === NOT_SET ? "not_set" : a === CUSTOM ? "custom" : a === "no" ? "no" : "set";
}

// ---------------------------------------------------------------------------
// Own words checks (screens 04 and 05)
// ---------------------------------------------------------------------------

const PHONE = /(\+?254|\b0)[\s-]?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|co\.ke|ke|org|net)\b|\bvisit our (page|site|website)\b)/i;
const PRICE = /\b(KSh|Kes|Sh)\.?\s?([\d,]+)/i;

export type OwnWordsCheck = { length: number; over: number; phone: boolean; link: boolean; price: string | null };
export function checkOwnWords(text: string): OwnWordsCheck {
  const t = text.trim();
  const m = t.match(PRICE);
  return { length: t.length, over: Math.max(0, t.length - OWN_WORDS_MAX), phone: PHONE.test(t), link: LINK.test(t), price: m ? `KSh ${m[2]}` : null };
}

/** Errors keyed by field id, in the order the summary lists them. Plain text, never colour alone. */
export function draftErrors(d: Draft): Array<{ field: string; summary: string; inline: string }> {
  if (d.answer !== CUSTOM) return [];
  const out: Array<{ field: string; summary: string; inline: string }> = [];
  const en = checkOwnWords(d.note);
  const sw = checkOwnWords(d.note_sw);
  if (!en.length) out.push({ field: "note", summary: "Write what callers hear", inline: "Write what callers hear." });
  if (en.over) out.push({ field: "note", summary: `Too long (${en.length}/${OWN_WORDS_MAX})`, inline: `Cut ${en.over} letters` });
  if (en.phone || sw.phone) out.push({ field: en.phone ? "note" : "note_sw", summary: "Remove the phone number", inline: "Remove the phone number" });
  if (en.link || sw.link) out.push({ field: en.link ? "note" : "note_sw", summary: "Remove the link", inline: "Remove the link" });
  if (sw.over) out.push({ field: "note_sw", summary: `Kiswahili too long (${sw.length}/${OWN_WORDS_MAX})`, inline: `Cut ${sw.over} letters` });
  if (!d.checked && en.length) out.push({ field: "checked", summary: 'Tick "Checked"', inline: "Tick to save" });
  return out;
}

// ---------------------------------------------------------------------------
// Partial save: one topic in, only that topic's paths change.
// ---------------------------------------------------------------------------

export type TopicPatch = {
  topic: string;
  /** New rules.<topic>, or null to remove it. */
  rule: Rule | null;
  /** New policy_lines.<topic>, or null to remove it. */
  line: Spoken | null;
  /** Legacy text key and its rebuilt value ("" when every topic sharing it is Not set). */
  textKey: string | null;
  text: string | null;
};

/**
 * Build the patch for one topic save. Reads the other topics that share the same legacy
 * text key (Cancel, Move and Late share "cancellation") so that key is rebuilt, not lost.
 */
export function topicPatch(stored: Record<string, unknown>, topicId: string, rule: Rule | null, niche: NicheDef, topics: Record<string, TopicDef> = TOPICS): TopicPatch {
  const topic = topics[topicId];
  if (!topic) throw new Error(`Unknown policy topic: ${topicId}`);
  const rules = { ...((stored.rules as Record<string, Rule> | undefined) ?? {}) };
  if (rule) rules[topicId] = rule;
  else delete rules[topicId];
  const line = rule ? spokenLine(topic, rule, niche) : null;
  let text: string | null = null;
  if (topic.textKey) {
    const order = [...nicheTopics(niche, topics).map((t) => t.id), ...Object.keys(topics)];
    const seen = new Set<string>();
    text = order
      .filter((id) => !seen.has(id) && seen.add(id) && topics[id]?.textKey === topic.textKey && rules[id])
      .map((id) => spokenLine(topics[id], rules[id], niche).en)
      .join(" ")
      .slice(0, 500);
  }
  return { topic: topicId, rule, line, textKey: topic.textKey ?? null, text };
}

/** Apply a patch to the stored business_policies object. Every other key is left as it was. */
export function applyTopicPatch(stored: Record<string, unknown>, p: TopicPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored };
  const rules = { ...((stored.rules as Record<string, unknown> | undefined) ?? {}) };
  if (p.rule) rules[p.topic] = p.rule;
  else delete rules[p.topic];
  next.rules = rules;
  const lines = { ...((stored.policy_lines as Record<string, unknown> | undefined) ?? {}) };
  if (p.line) lines[p.topic] = p.line;
  else delete lines[p.topic];
  next.policy_lines = lines;
  if (p.textKey) {
    next[p.textKey] = p.text ?? "";
    const prov = { ...((stored.provenance as Record<string, unknown> | undefined) ?? {}) };
    prov[p.textKey] = { source: "owner", confirmed: true };
    next.provenance = prov;
  }
  return next;
}
