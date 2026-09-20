import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";

/** Muted logout. Posts `/api/logout`. Lives on Profile, not in shell chrome. */
export function SignOutButton() {
  return (
    <form action="/api/logout" method="post">
      <button
        type="submit"
        className={[
          "inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-ink-soft hover:text-warn",
          deskShiftClass,
          focusRingVisible,
        ].join(" ")}
      >
        Sign out
      </button>
    </form>
  );
}
