# Supabase Auth email templates

Branded versions of the six Supabase Auth emails, in the same layout as the rest of `@scalers/email`.
Generated from `src/supabase-auth.ts` by `npm run export:auth`. **Don't edit the HTML by hand**: change the
source, re-export, commit. `test/supabase-auth.test.ts` fails if the files drift from the source.

**Applied on prod** (`fjxcdccgyhnvnnlnovcl`): all six on 18 Oct 12:03 EAT, reset password link updated 13:02 EAT. Not on staging (free tier with the built-in mailer refuses template edits). Changes need Alvin's GO.

| Supabase template (Dashboard name) | File | Subject | Management API keys |
| --- | --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirm your email for Scalers | `mailer_subjects_confirmation`, `mailer_templates_confirmation_content` |
| Invite user | `invite.html` | You're invited to join Scalers | `mailer_subjects_invite`, `mailer_templates_invite_content` |
| Magic Link | `magic-link.html` | Your Scalers sign in link | `mailer_subjects_magic_link`, `mailer_templates_magic_link_content` |
| Reset Password | `reset-password.html` | Reset your Scalers password | `mailer_subjects_recovery`, `mailer_templates_recovery_content` |
| Change Email Address | `change-email.html` | Confirm your new email for Scalers | `mailer_subjects_email_change`, `mailer_templates_email_change_content` |
| Reauthentication | `reauthentication.html` | Your Scalers confirmation code | `mailer_subjects_reauthentication`, `mailer_templates_reauthentication_content` |

`subjects.json` has the same mapping in machine form. Each `.txt` is the plain-text reading of the email (for review;
Supabase sends HTML only).

## Variables used

`{{ .ConfirmationURL }}` (button and copyable fallback link), `{{ .Email }}`, `{{ .NewEmail }}` (change email only),
`{{ .Token }}` (reauthentication code). Reset password uses `{{ .SiteURL }}/auth/callback?next=/reset-password&token_hash={{ .TokenHash }}&type=recovery`
instead of `{{ .ConfirmationURL }}`, so the link works on any device (Desk verifies the token hash). Nothing else.

## Why these differ from the other templates

Supabase renders templates with Go `html/template`, which **strips HTML comments**. The VML button and the MSO
conditionals used elsewhere in this package live in comments, so here the button is a table cell with `bgcolor`
plus a padded link. Outlook desktop still shows a solid 48px button. There is no `List-Unsubscribe` and no
unsubscribe link: these are essential account emails. The footer points to the support inbox instead of
"reply to this email" because the sender is a no-reply address.

## Checks

```bash
npm test                 # includes test/supabase-auth.test.ts
npm run check:auth-go    # parses and executes every file with Go html/template (needs Go)
npm run export:auth -- --copy /workspace/scalers/email-previews   # re-export + previews
```

## Copy assumptions to confirm before applying

- Links and codes say they expire in **1 hour**. That matches Supabase's default email OTP expiry (3600 s). Check
  Auth > Providers > Email > "Email OTP Expiration" is 3600 on the project first, or change the copy.
- Footer support address is the `support@scalers.co.ke` placeholder used across the package.
