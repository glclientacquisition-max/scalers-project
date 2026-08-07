/** Canonical Scalers brand asset paths (files live in `public/brand/`). */
export const brandAssets = {
  logoFull: "/brand/logo-full.png",
  logoFullWhiteBg: "/brand/logo-full-white-bg.png",
  /** Prefer PNG when present; SVG ships as interim until logo pack is dropped in. */
  icon: "/brand/icon.png",
  iconFallback: "/brand/icon.svg",
  iconWhiteBg: "/brand/icon-white-bg.png",
  favicon: "/brand/favicon.png",
} as const;

export type BrandAssetKey = keyof typeof brandAssets;
