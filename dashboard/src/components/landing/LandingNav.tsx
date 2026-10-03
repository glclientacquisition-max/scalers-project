import Image from "next/image";
import Link from "next/link";
import { brandAssets } from "@/components/brand/assets";
import { LandingCta } from "@/components/landing/LandingCta";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md px-3 text-base text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-sticky border-b border-hairline bg-canvas/90 backdrop-blur-md">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-menu focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:bg-surface focus:px-3 focus:text-base focus:text-ink focus:ring-2 focus:ring-brand"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-desk flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
        <Link
          href="/"
          className="mr-auto inline-flex min-h-11 items-center gap-2 rounded-md pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <Image
            src={brandAssets.iconTransparent}
            alt=""
            width={32}
            height={32}
            priority
            className="h-8 w-8 object-contain"
          />
          <span className="font-display text-lg font-semibold tracking-tight text-ink">Scalers</span>
        </Link>
        <nav aria-label="Page" className="order-last flex w-full md:order-none md:w-auto">
          <a href="#how" className={linkClass}>
            How it works
          </a>
          <a href="#app" className={linkClass}>
            The app
          </a>
        </nav>
        <LandingCta />
      </div>
    </header>
  );
}
