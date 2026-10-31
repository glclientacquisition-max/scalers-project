// TODO(Scalers Prompt owns copy)
// Placeholder lines only. Replace this file when the real request-access copy is ready.

export const REQUEST_ACCESS_COPY = {
  en: {
    title: "TODO request access",
    name: "TODO name",
    contact: "TODO phone or email",
    consent: "TODO consent",
    submit: "TODO submit",
    thanks: "TODO thanks",
    needName: "TODO name required",
    needContact: "TODO contact required",
    badContact: "TODO contact invalid",
    needConsent: "TODO consent required",
  },
  sw: {
    title: "TODO ombi",
    name: "TODO jina",
    contact: "TODO simu au barua",
    consent: "TODO idhini",
    submit: "TODO tuma",
    thanks: "TODO asante",
    needName: "TODO jina linahitajika",
    needContact: "TODO mawasiliano yanahitajika",
    badContact: "TODO mawasiliano si sahihi",
    needConsent: "TODO idhini inahitajika",
  },
} as const;

export type RequestAccessLang = keyof typeof REQUEST_ACCESS_COPY;
