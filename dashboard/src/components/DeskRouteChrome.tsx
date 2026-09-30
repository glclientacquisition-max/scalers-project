"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect } from "react";
import { isDeskNestedPath, isDeskTicketChatPath, markHiddenDeskTickets } from "@/lib/deskTicketChat";

/**
 * Live route flags on the desk shell.
 * CSS `:has` cannot tell a visible ticket from one Next kept in a hidden Activity,
 * so the return to a list would leave the tab bar off, lock the list scroll,
 * and let that copy sit on top of the inbox.
 * These attributes follow the pathname the owner is actually on.
 */
export function DeskRouteChrome() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const nested = isDeskNestedPath(pathname, search);
  const ticket = isDeskTicketChatPath(pathname);

  useLayoutEffect(() => {
    const shell = document.querySelector(".desk-theme");
    if (!(shell instanceof HTMLElement)) return;
    shell.setAttribute("data-desk-route-ready", "");
    shell.toggleAttribute("data-desk-nested-route", nested);
    shell.toggleAttribute("data-desk-ticket-chat", ticket);
    const sync = () => markHiddenDeskTickets(shell);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, [nested, ticket]);

  return null;
}
