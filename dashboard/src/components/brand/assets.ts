/** Canonical Scalers brand asset paths (`public/brand/`). */
export const brandAssets = {
  /** Full mark + wordmark, transparent (auth / marketing). */
  logoFull: "/brand/logo-full.png",
  logoFullWhiteBg: "/brand/logo-full-white-bg.png",
  /**
   * Transparent ribbon icon — preferred on headers and colored chrome
   * so the mark overlays cleanly without a white plate.
   */
  iconTransparent: "/brand/icon.png",
  iconWhiteBg: "/brand/icon-white-bg.png",
  iconFallback: "/brand/icon.svg",
  favicon: "/brand/favicon.png",
} as const;

export type BrandAssetKey = keyof typeof brandAssets;
