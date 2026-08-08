import type { Config } from "tailwindcss";

/**
 * Scalers brand system — primary blue sampled from the ribbon “S” mark.
 * Surfaces stay cool and light for mobile triage; accent does the work.
 */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          50: "#EAF6FF",
          100: "#D5EDFF",
          200: "#A8DAFF",
          300: "#6BC2FF",
          400: "#2AA8FF",
          500: "#0096FF",
          600: "#007AE6",
          700: "#005CCC",
          800: "#0047AB",
          900: "#0A192F",
          DEFAULT: "#0096FF",
        },
        surface: {
          DEFAULT: "var(--card)",
          muted: "var(--bg-deep)",
          canvas: "var(--bg)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          inverse: "#FFFFFF",
        },
        line: "var(--line)",
        accent: {
          DEFAULT: "var(--accent)",
          deep: "var(--accent-deep)",
          soft: "var(--accent-soft)",
        },
        warn: {
          DEFAULT: "var(--warn)",
          soft: "var(--warn-soft)",
        },
        ok: {
          DEFAULT: "var(--ok)",
          soft: "var(--ok-soft)",
        },
        lead: "var(--lead)",
        whatsapp: "var(--whatsapp)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      boxShadow: {
        focus: "0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent)",
        lift: "0 10px 30px -18px rgba(10, 25, 47, 0.28)",
      },
      borderRadius: {
        panel: "0.875rem",
      },
      maxWidth: {
        desk: "72rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
