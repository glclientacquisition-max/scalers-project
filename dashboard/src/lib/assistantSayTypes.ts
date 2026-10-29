export type AssistantSayRow = {
  id: string;
  title: string;
  isFact: boolean;
  willSay: boolean;
  stampTone: "neutral" | "attention" | "ok" | "live";
  stampLabel: string;
  reason: string;
  fixHref: string;
  /** Two-line list preview: what callers hear when ready, else empty. */
  hearPreview?: string;
};

export type AssistantSayState = {
  intro: string;
  rows: AssistantSayRow[];
  readyCount: number;
  total: number;
};

export type ReadyChecklistItem = {
  id: string;
  label: string;
  href: string;
  complete: boolean;
  /** Plain-language gap when complete is false. */
  reason?: string;
};
