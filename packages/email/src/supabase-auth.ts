import * as React from "react";
import { render } from "@react-email/render";
import { DEFAULT_URLS } from "./config.ts";
import { EmailLayout } from "./Layout.tsx";
import { tableButtonHtml } from "./button.ts";
import type { Block, EmailSpec } from "./spec.ts";
import { specToText } from "./text.ts";

/**
 * Supabase Auth email templates (Dashboard > Authentication > Email Templates).
 *
 * These are exported once as static HTML with Supabase Go-template variables
 * left in place ({{ .ConfirmationURL }}, {{ .Token }}, {{ .Email }}, ...).
 * Supabase renders them with Go html/template, which strips HTML comments, so
 * these use the comment-free table button instead of the VML one.
 */
export type AuthKind = "confirmation" | "invite" | "magic_link" | "recovery" | "email_change" | "reauthentication";

/** Supabase template variables, written exactly as Supabase expects them. */
export const V = {
  url: "{{ .ConfirmationURL }}",
  token: "{{ .Token }}",
  email: "{{ .Email }}",
  newEmail: "{{ .NewEmail }}",
  site: "{{ .SiteURL }}",
} as const;

/** Dashboard field names and Management API keys for each template. */
export const AUTH_TEMPLATES: Record<AuthKind, { file: string; dashboard: string; apiSubject: string; apiContent: string }> = {
  confirmation: { file: "confirm-signup", dashboard: "Confirm signup", apiSubject: "mailer_subjects_confirmation", apiContent: "mailer_templates_confirmation_content" },
  invite: { file: "invite", dashboard: "Invite user", apiSubject: "mailer_subjects_invite", apiContent: "mailer_templates_invite_content" },
  magic_link: { file: "magic-link", dashboard: "Magic Link", apiSubject: "mailer_subjects_magic_link", apiContent: "mailer_templates_magic_link_content" },
  recovery: { file: "reset-password", dashboard: "Reset Password", apiSubject: "mailer_subjects_recovery", apiContent: "mailer_templates_recovery_content" },
  email_change: { file: "change-email", dashboard: "Change Email Address", apiSubject: "mailer_subjects_email_change", apiContent: "mailer_templates_email_change_content" },
  reauthentication: { file: "reauthentication", dashboard: "Reauthentication", apiSubject: "mailer_subjects_reauthentication", apiContent: "mailer_templates_reauthentication_content" },
};

export const SECURITY_LINE = "If you didn't ask for this, you can ignore this email.";
const REASON = "This is an account email from Scalers. We only send it when someone asks for it.";
const fallback = (): Block => ({ t: "rawlink", label: "If the button doesn't work, copy this link into your browser:", href: V.url });

function spec(s: Omit<EmailSpec, "audience" | "essential" | "reason">): EmailSpec {
  return { audience: "owner", essential: true, reason: REASON, ...s };
}

export const authSpecs: Record<AuthKind, EmailSpec> = {
  confirmation: spec({
    subject: "Confirm your email for Scalers",
    preheader: "One tap to confirm your email and finish setting up.",
    heading: "Confirm your email",
    blocks: [
      { t: "p", text: ["Welcome to Scalers. Tap the button to confirm ", { strong: V.email }, " and finish setting up your account."] },
      { t: "p", muted: true, text: "The link works once and expires in 1 hour." },
      { t: "note", tone: "neutral", text: `${SECURITY_LINE} No account is set up until the email is confirmed.` },
      fallback(),
    ],
    cta: { label: "Confirm my email", href: V.url },
  }),
  invite: spec({
    subject: "You're invited to join Scalers",
    preheader: "Accept the invite to set your password and join your team.",
    heading: "You're invited to Scalers",
    blocks: [
      { t: "p", text: ["You've been invited to join a team on Scalers as ", { strong: V.email }, ". Accept the invite to set your password and see the calls your team handles."] },
      { t: "p", muted: true, text: "The link works once and expires in 1 hour. If it runs out, ask the person who invited you to send a new one." },
      { t: "note", tone: "neutral", text: `${SECURITY_LINE} Nothing changes unless you accept.` },
      fallback(),
    ],
    cta: { label: "Accept invite", href: V.url },
  }),
  magic_link: spec({
    subject: "Your Scalers sign in link",
    preheader: "Tap to sign in. The link works once and expires in 1 hour.",
    heading: "Sign in to Scalers",
    blocks: [
      { t: "p", text: ["Tap the button to sign in as ", { strong: V.email }, ". No password needed."] },
      { t: "p", muted: true, text: "The link works once and expires in 1 hour." },
      { t: "note", tone: "neutral", text: `${SECURITY_LINE} Nobody can sign in without this link.` },
      fallback(),
    ],
    cta: { label: "Sign in to Scalers", href: V.url },
  }),
  recovery: spec({
    subject: "Reset your Scalers password",
    preheader: "Choose a new password. The link expires in 1 hour.",
    heading: "Reset your password",
    pill: { tone: "info", text: "Account security" },
    blocks: [
      { t: "p", text: ["We got a request to reset the password for ", { strong: V.email }, ". Tap the button to choose a new one."] },
      { t: "p", muted: true, text: "The link works once and expires in 1 hour." },
      { t: "note", tone: "neutral", text: `${SECURITY_LINE} Your password stays the same.` },
      fallback(),
    ],
    cta: { label: "Choose a new password", href: V.url },
  }),
  email_change: spec({
    subject: "Confirm your new email for Scalers",
    preheader: "Confirm the change so account emails reach the right inbox.",
    heading: "Confirm your new email",
    pill: { tone: "info", text: "Account security" },
    blocks: [
      { t: "p", text: ["You asked to change the email on your Scalers account from ", { strong: V.email }, " to ", { strong: V.newEmail }, ". Tap the button to confirm."] },
      { t: "p", muted: true, text: "The link works once and expires in 1 hour. Until you confirm, you keep signing in with your current email." },
      { t: "note", tone: "neutral", text: `${SECURITY_LINE} Your email stays the same. If you think someone else knows your password, change it soon.` },
      fallback(),
    ],
    cta: { label: "Confirm new email", href: V.url },
  }),
  reauthentication: spec({
    subject: "Your Scalers confirmation code",
    preheader: "Enter this code in Scalers to confirm it's you.",
    heading: "Confirm it's you",
    pill: { tone: "info", text: "Account security" },
    blocks: [
      { t: "p", text: "Enter this code in Scalers to finish what you started. We ask for it before important account changes." },
      { t: "code", label: "Your code", code: V.token },
      { t: "p", muted: true, text: "The code works once and expires in 1 hour. Never share it, not even with Scalers staff." },
      { t: "note", tone: "neutral", text: `${SECURITY_LINE} Nothing changes without this code.` },
    ],
  }),
};

export type RenderedAuthTemplate = { kind: AuthKind; file: string; subject: string; preheader: string; html: string; text: string };

/** Go html/template drops comments anyway; remove them so what we test is what Supabase sends. */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

export async function renderAuthTemplate(kind: AuthKind, opts: { assets?: string; support?: string } = {}): Promise<RenderedAuthTemplate> {
  const s = authSpecs[kind];
  const footer = { support: opts.support ?? DEFAULT_URLS.support, assets: opts.assets ?? DEFAULT_URLS.assets, noReply: true };
  const html = stripComments(await render(React.createElement(EmailLayout, { spec: s, footer, button: tableButtonHtml })));
  return { kind, file: AUTH_TEMPLATES[kind].file, subject: s.subject, preheader: s.preheader, html, text: specToText(s, footer) };
}

export const AUTH_KINDS = Object.keys(AUTH_TEMPLATES) as AuthKind[];
