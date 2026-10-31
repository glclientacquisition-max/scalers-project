export type DemoLang = "en" | "sw";

export const NOTICE_V = "2026-10-31";

export const DEMO_BUSINESSES = [
  { key: "home", en: "Home services", sw: "Huduma za nyumbani" },
  { key: "shop", en: "Shop", sw: "Duka" },
  { key: "other", en: "Other business", sw: "Biashara nyingine" },
] as const;

export type DemoBusinessKey = (typeof DEMO_BUSINESSES)[number]["key"];

type Copy = {
  title: string;
  lead: string;
  choose: string;
  language: string;
  english: string;
  kiswahili: string;
  continue: string;
  before: string;
  notice: string;
  data: string;
  privacy: string;
  start: string;
  back: string;
  paused: string;
  busy: string;
  limit: string;
  denied: string;
  deniedAgain: string;
  connecting: string;
  live: string;
  timeLeft: string;
  end: string;
  ended: string;
  signup: string;
  error: string;
  retry: string;
  unsupported: string;
};

export const COPY: Record<DemoLang, Copy> = {
  en: {
    title: "Talk to the assistant",
    lead: "A short sample of the voice assistant. It is not a phone line.",
    choose: "Choose a business",
    language: "Language",
    english: "English",
    kiswahili: "Kiswahili",
    continue: "Continue",
    before: "Before you start",
    notice:
      "Your voice is used only to answer this demo. It is sent to speech providers to hear you and reply. We do not keep the audio or the words. End stops it.",
    data: "Uses about 0.5 MB a minute.",
    privacy: "Privacy",
    start: "Start demo",
    back: "Back",
    paused: "Demo paused.",
    busy: "All demo lines are busy, try again in a minute.",
    limit: "You've used today's demos.",
    denied: "The microphone is blocked. Allow it for this site, then try again.",
    deniedAgain: "Try again",
    connecting: "Connecting",
    live: "Live",
    timeLeft: "Time left",
    end: "End",
    ended: "Thanks. The demo has ended.",
    signup: "Sign up",
    error: "The demo did not start. Try again.",
    retry: "Try again",
    unsupported: "Your browser can't run the live demo.",
  },
  sw: {
    title: "Zungumza na msaidizi",
    lead: "Sampuli fupi ya msaidizi wa sauti. Si laini ya simu.",
    choose: "Chagua biashara",
    language: "Lugha",
    english: "English",
    kiswahili: "Kiswahili",
    continue: "Endelea",
    before: "Kabla ya kuanza",
    notice:
      "Sauti yako inatumika kujibu onyesho hili tu. Inatumwa kwa watoa huduma wa sauti ili kusikia na kujibu. Hatutunzi sauti wala maneno. Maliza inasimamisha.",
    data: "Inatumia takriban MB 0.5 kwa dakika.",
    privacy: "Faragha",
    start: "Anza onyesho",
    back: "Rudi",
    paused: "Onyesho limesimamishwa.",
    busy: "Mistari yote ya onyesho inatumika, jaribu tena baada ya dakika moja.",
    limit: "Umetumia onyesho za leo.",
    denied: "Maikrofoni imezuiwa. Iruhusu kwa tovuti hii, kisha ujaribu tena.",
    deniedAgain: "Jaribu tena",
    connecting: "Inaunganisha",
    live: "Moja kwa moja",
    timeLeft: "Muda uliobaki",
    end: "Maliza",
    ended: "Asante. Onyesho limeisha.",
    signup: "Jisajili",
    error: "Onyesho halijaanza. Jaribu tena.",
    retry: "Jaribu tena",
    unsupported: "Kivinjari chako hakiwezi kufanya onyesho la moja kwa moja.",
  },
};

export function businessLabel(key: DemoBusinessKey, lang: DemoLang): string {
  const row = DEMO_BUSINESSES.find((item) => item.key === key);
  return row ? row[lang] : key;
}
