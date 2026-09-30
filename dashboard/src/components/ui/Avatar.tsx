import { cx } from "@/lib/cx";

export type AvatarSize = 32 | 40 | 48;

const sizeClass: Record<AvatarSize, string> = {
  32: "h-8 w-8 text-meta",
  40: "h-10 w-10 text-body",
  48: "h-12 w-12 text-title",
};

/* Deterministic tonal pair per name so the same caller keeps the same color. */
const tones = [
  "bg-accent-tonal text-accent",
  "bg-ok-tonal text-ok",
  "bg-attention-tonal text-attention",
  "bg-surface-2 text-ink-2",
];

export function initialsOf(name: string | null | undefined): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function toneFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return tones[h % tones.length];
}

export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  /** Display name. Initials come from it. Empty name renders a neutral silhouette. */
  name?: string | null;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const initials = initialsOf(name);
  const base = cx(
    "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold",
    sizeClass[size],
    className,
  );
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cx(base, "object-cover")} />;
  }
  if (!initials) {
    return (
      <span className={cx(base, "bg-surface-2 text-ink-3")} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[55%] w-[55%]">
          <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className={cx(base, toneFor(name || initials))} aria-hidden="true">
      {initials}
    </span>
  );
}
