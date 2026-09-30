import type { Config } from "tailwindcss";

/**
 * Token colour with alpha support. `bg-ink/40` and `ring-brand/40` need a channel to mix into;
 * CSS variables holding hex values do not have one, so opacity modifiers were silently dropped.
 * `color-mix` gives every role a working `/NN` modifier in both themes.
 */
const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

/**
 * Scalers Frontend 2.0 theme. Canon: docs/frontend/FRONTEND_2_0_CHARTER.md §4.
 * Every value reads a CSS variable from globals.css so light and dark share one config.
 * Legacy names (line, ink-soft, accent-fill, warn, surface-muted) alias the new roles
 * and are removed when their last caller is rebuilt.
 */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    borderRadius: {
      none: "0",
      sm: "6px",
      DEFAULT: "6px",
      md: "6px",
      lg: "10px",
      xl: "10px",
      "2xl": "16px",
      "3xl": "16px",
      panel: "16px",
      full: "9999px",
    },
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        canvas: token("canvas"),
        surface: {
          DEFAULT: token("surface"),
          2: token("surface-2"),
          muted: token("surface-2"),
          canvas: token("canvas"),
        },
        hairline: token("hairline"),
        line: token("hairline"),
        ink: {
          DEFAULT: token("ink"),
          2: token("ink-2"),
          3: token("ink-3"),
          soft: token("ink-2"),
          inverse: "#FFFFFF",
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          active: token("accent-active"),
          tonal: token("accent-tonal"),
          on: token("accent-on"),
          deep: token("accent"),
          "deep-hover": token("accent-hover"),
          soft: token("accent-tonal"),
          fill: token("accent"),
          "fill-hover": token("accent-hover"),
          "fill-active": token("accent-active"),
          "on-fill": token("accent-on"),
        },
        brand: {
          DEFAULT: token("brand"),
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
        },
        attention: {
          DEFAULT: token("attention"),
          tonal: token("attention-tonal"),
        },
        warn: {
          DEFAULT: token("attention"),
          soft: token("attention-tonal"),
        },
        ok: {
          DEFAULT: token("ok"),
          tonal: token("ok-tonal"),
          soft: token("ok-tonal"),
        },
        lead: token("lead"),
        whatsapp: {
          DEFAULT: token("whatsapp"),
          deep: token("whatsapp-deep"),
        },
        bubble: {
          caller: token("bubble-caller"),
          "caller-ink": token("bubble-caller-ink"),
        },
        sms: token("sms"),
        email: token("accent"),
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display, var(--font-sans))"],
      },
      fontSize: {
        caption: ["0.6875rem", { lineHeight: "0.875rem" }],
        meta: ["0.8125rem", { lineHeight: "1.125rem" }],
        body: ["0.9375rem", { lineHeight: "1.375rem" }],
        title: ["1.0625rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        page: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em", fontWeight: "700" }],
        display: ["1.75rem", { lineHeight: "2rem", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      boxShadow: {
        sheet: "var(--shadow-sheet)",
        menu: "var(--shadow-menu)",
        focus: "0 0 0 3px color-mix(in srgb, var(--brand) 28%, transparent)",
        lift: "var(--shadow-menu)",
      },
      zIndex: {
        sticky: "10",
        tabbar: "20",
        sheet: "30",
        menu: "40",
        toast: "50",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      transitionDuration: {
        fast: "150ms",
        sheet: "240ms",
      },
      spacing: {
        13: "3.25rem",
        18: "4.5rem",
      },
      maxWidth: {
        desk: "72rem",
      },
      minHeight: {
        tap: "2.75rem",
      },
      minWidth: {
        tap: "2.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
