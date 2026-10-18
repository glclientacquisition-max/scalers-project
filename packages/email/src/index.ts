import * as React from "react";
import { render } from "@react-email/render";
import { catalog, followUps, type EmailKind, type EmailProps } from "./catalog.ts";
import { DEFAULT_URLS, deskRoutes, SENDERS, type Urls } from "./config.ts";
import { EmailLayout } from "./Layout.tsx";
import { specToText } from "./text.ts";
import type { Audience } from "./spec.ts";

export { catalog, followUps, SENDERS, DEFAULT_URLS, deskRoutes };
export type { EmailKind, EmailProps, Urls };

export type RenderOptions = {
  urls?: Partial<Urls>;
  /** One-click unsubscribe URL. Used only on non-essential mail. */
  unsubscribeUrl?: string;
};

export type RenderedEmail = {
  kind: EmailKind;
  audience: Audience;
  essential: boolean;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  from: string;
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe on non-essential owner mail. */
  headers: Record<string, string>;
};

/** Outlook needs the VML/Office namespaces on <html> and a 96dpi hint for the VML button. */
function outlookFixups(html: string): string {
  return html
    .replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs} xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`)
    .replace(
      /<head>/i,
      `<head><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->`,
    );
}

/**
 * Render one system email. Pure: no network, no send. The shared notification
 * module calls this, then hands { from, replyTo, subject, html, text, headers }
 * to its transport.
 */
export async function renderEmail<K extends EmailKind>(kind: K, props: EmailProps<K>, opts: RenderOptions = {}): Promise<RenderedEmail> {
  const urls: Urls = { ...DEFAULT_URLS, ...opts.urls };
  const entry = catalog[kind];
  const spec = (entry.render as (p: EmailProps<K>, c: { urls: Urls }) => ReturnType<typeof entry.render>)(props, { urls });
  const unsubscribeUrl = !spec.essential ? opts.unsubscribeUrl : undefined;
  const footer = { support: urls.support, unsubscribeUrl, alertsUrl: unsubscribeUrl ? `${urls.desk}${deskRoutes.alerts}` : undefined, assets: urls.assets };
  const html = outlookFixups(await render(React.createElement(EmailLayout, { spec, footer })));
  const text = specToText(spec, footer);
  const sender = SENDERS[spec.audience];
  const headers: Record<string, string> = {};
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    kind,
    audience: spec.audience,
    essential: spec.essential,
    subject: spec.subject,
    preheader: spec.preheader,
    html,
    text,
    from: sender.from,
    replyTo: sender.replyTo,
    headers,
  };
}
