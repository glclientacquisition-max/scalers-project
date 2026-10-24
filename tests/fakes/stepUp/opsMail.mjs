import { H } from "./state.mjs";
export async function sendOpsMail(msg) { H.mail.push(msg); return { sent: false, skipped: "ops_mail_unconfigured" }; }
