"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SETTINGS_HOURS_HREF } from "@/lib/businessSettingsNav";
import { DESK_MD_MEDIA } from "@/lib/deskMdBoot";

/**
 * Safety net for tablet and desktop. The server redirect (desk-md cookie) and the boot
 * script normally open Hours before paint. If the bare list still reaches md+ (cookie
 * missing, or the window grew past md on the list), open Hours instead of an empty pane.
 */
export function SettingsWideOpen({ href = SETTINGS_HOURS_HREF }: { href?: string }) {
  const router = useRouter();
  useEffect(() => {
    const media = window.matchMedia(DESK_MD_MEDIA);
    const go = () => {
      if (media.matches) router.replace(href, { scroll: false });
    };
    go();
    media.addEventListener("change", go);
    return () => media.removeEventListener("change", go);
  }, [router, href]);
  return null;
}
