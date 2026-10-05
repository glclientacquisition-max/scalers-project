export function settingsLeaveHref(
  raw: string | null | undefined,
  current: string
): string | null;

export function settingsLeaveTarget(input: {
  dirty: boolean;
  href: string | null;
  modified: boolean;
}): string | null;
