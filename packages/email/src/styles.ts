import { dark, layout, light } from "./tokens.ts";

/**
 * Head CSS. Light values are inlined on every element; this sheet only adds
 * mobile tweaks and dark-mode overrides (Apple Mail, iOS Mail, Outlook.com via
 * [data-ogsc], new Outlook). Gmail ignores prefers-color-scheme and applies its
 * own inversion, which these colours survive.
 */
export const headCss = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
a { color:${light.accent}; }
.btn:hover { background-color:#004aad !important; }
@media only screen and (max-width: 620px) {
  .wrap { padding-left:12px !important; padding-right:12px !important; }
  .card { padding:${layout.cardPaddingMobile}px !important; }
  .h1 { font-size:22px !important; line-height:28px !important; }
  .btn { display:block !important; padding-left:16px !important; padding-right:16px !important; }
  .stat-v { font-size:22px !important; line-height:28px !important; }
  .stat-c { padding:12px 10px !important; }
  .hide-sm { display:none !important; }
  .btn-t { width:100% !important; }
  .code { font-size:28px !important; letter-spacing:6px !important; }
}
@media (prefers-color-scheme: dark) {
  .bg-canvas { background-color:${dark.canvas} !important; }
  .bg-surface { background-color:${dark.surface} !important; }
  .bg-surface2 { background-color:${dark.surface2} !important; }
  .bd { border-color:${dark.hairline} !important; }
  .tx-ink { color:${dark.ink} !important; }
  .tx-ink2 { color:${dark.ink2} !important; }
  .tx-ink3 { color:${dark.ink3} !important; }
  .tx-link { color:${dark.accent} !important; }
  .btn { background-color:${dark.accent} !important; color:${dark.accentOn} !important; }
  .btn-c { background-color:${dark.accent} !important; }
  .bg-info { background-color:${dark.accentTonal} !important; }
  .bg-ok { background-color:${dark.okTonal} !important; }
  .bg-att { background-color:${dark.attentionTonal} !important; }
  .bg-neu { background-color:${dark.surface2} !important; }
  .tx-info { color:${dark.accent} !important; }
  .tx-ok { color:${dark.ok} !important; }
  .tx-att { color:${dark.attention} !important; }
  .tx-neu { color:${dark.ink2} !important; }
  .fill-info { background-color:${dark.accent} !important; }
  .fill-att { background-color:${dark.attention} !important; }
  .track { background-color:${dark.surface2} !important; }
}
[data-ogsc] .tx-ink { color:${dark.ink} !important; }
[data-ogsc] .tx-ink2 { color:${dark.ink2} !important; }
[data-ogsc] .tx-ink3 { color:${dark.ink3} !important; }
[data-ogsc] .tx-link { color:${dark.accent} !important; }
[data-ogsb] .bg-canvas { background-color:${dark.canvas} !important; }
[data-ogsb] .bg-surface { background-color:${dark.surface} !important; }
`;
