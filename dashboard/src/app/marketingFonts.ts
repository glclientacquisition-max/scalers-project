import { DM_Sans, Sora } from "next/font/google";

/* Marketing pages only (home, pricing, vertical pages). The Desk stays on the system stack. */
const display = Sora({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const marketingFontClass = `${display.variable} ${body.variable}`;
