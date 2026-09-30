import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Frontend 2.0 token guard (docs/frontend/FRONTEND_2_0_CHARTER.md §4.1).
 * Warns now; flips to error in Phase 8 once every screen is on the kit.
 */
const tokenGuard = {
  files: ["src/**/*.tsx"],
  ignores: ["src/app/page.tsx", "src/components/landing/**"],
  rules: {
    "no-restricted-syntax": [
      "warn",
      {
        selector:
          "JSXAttribute[name.name='className'] > Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
        message: "Hex literal in className. Use a token role (bg-accent, text-ink-2, border-hairline).",
      },
      {
        selector:
          "JSXAttribute[name.name='className'] > JSXExpressionContainer TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
        message: "Hex literal in className. Use a token role (bg-accent, text-ink-2, border-hairline).",
      },
      {
        selector: "Literal[value=/\\btext-\\[\\d+px\\]/]",
        message: "Arbitrary px type size. Use text-caption, text-meta, text-body, text-title, text-page, text-display.",
      },
      {
        selector: "TemplateElement[value.raw=/\\btext-\\[\\d+px\\]/]",
        message: "Arbitrary px type size. Use text-caption, text-meta, text-body, text-title, text-page, text-display.",
      },
      {
        selector: "Literal[value=/\\brounded-3xl\\b/]",
        message: "rounded-3xl is retired. Sheets and cards use rounded-2xl (16px).",
      },
      {
        selector: "TemplateElement[value.raw=/\\brounded-3xl\\b/]",
        message: "rounded-3xl is retired. Sheets and cards use rounded-2xl (16px).",
      },
    ],
  },
};

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "playwright-report/**", "test-results/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  tokenGuard,
];

export default eslintConfig;
