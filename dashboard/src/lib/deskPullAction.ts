"use server";

import { revalidatePath } from "next/cache";

const ROOTS = ["/home", "/calls", "/contacts", "/wallet", "/settings", "/requests", "/appointments", "/admin"];

/** Bust the current desk or admin route. Does not charge, pay, or change a record. */
export async function revalidateDeskPull(pathname: string): Promise<{ ok: boolean }> {
  const path = String(pathname || "").split("?")[0].split("#")[0];
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) return { ok: false };
  const allowed = ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
  if (!allowed) return { ok: false };
  revalidatePath(path);
  return { ok: true };
}
