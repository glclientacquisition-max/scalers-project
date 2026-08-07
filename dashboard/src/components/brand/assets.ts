/** Canonical Scalers brand asset paths (`public/brand/`). */
export const brandAssets = {
  /** Cropped full mark for light auth surfaces. */
  logoFull: "/brand/logo-full-mark.png",
  logoFullWhiteBg: "/brand/logo-full-white-bg.png",
  /**
   * Square transparent ribbon mark for chrome overlays.
   * Derived from the official icon (tight crop, no white plate).
   */
  iconTransparent: "/brand/icon-mark.png",
  /** Original uploads kept for reference / OG / favicon. */
  iconSource: "/brand/icon.png",
  iconWhiteBg: "/brand/icon-white-bg.png",
  iconFallback: "/brand/icon.svg",
  favicon: "/brand/favicon.png",
} as const;

export type BrandAssetKey = keyof typeof brandAssets;
