/** Canonical Scalers brand asset paths (`public/brand/`). */
export const brandAssets = {
  logoFull: "/brand/logo-full.png",
  logoFullWhiteBg: "/brand/logo-full-white-bg.png",
  /** Square icon for chrome (white bg reads clean at 32px). */
  icon: "/brand/icon-white-bg.png",
  iconTransparent: "/brand/icon.png",
  iconFallback: "/brand/icon.svg",
  iconWhiteBg: "/brand/icon-white-bg.png",
  favicon: "/brand/favicon.png",
} as const;

export type BrandAssetKey = keyof typeof brandAssets;
