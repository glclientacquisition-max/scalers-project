import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · Scalers", robots: { index: false } };

/**
 * Shown by public/sw.js when a page load fails with no network.
 * Self-contained: one small stylesheet, no app chrome, no signed-in data. Short lines so Kiswahili fits.
 */
export default function OfflinePage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/offline/offline.css" />
      <main className="offline-shell">
        <div className="mark" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 64 64">
            <path d="M12 14c0-3.3 2.7-6 6-6h28c2.2 0 4 1.8 4 4v6c0 2.2-1.8 4-4 4H28l-8 8H18c-3.3 0-6-2.7-6-6V14z" fill="#fff" />
            <path d="M28 22l8 8-16 16-8-8 16-16z" fill="#fff" fillOpacity=".72" />
            <path d="M52 50c0 3.3-2.7 6-6 6H18c-2.2 0-4-1.8-4-4v-6c0-2.2 1.8-4 4-4h18l8-8h2c3.3 0 6 2.7 6 6v10z" fill="#fff" />
          </svg>
        </div>
        <h1>You&apos;re offline</h1>
        <p>Your assistant is still answering calls.</p>
        <p>New calls will show here when you&apos;re back online.</p>
        <p className="sw" lang="sw">Hakuna mtandao. Simu bado zinajibiwa.</p>
        {/* Plain link: works with no JS, since only this HTML and its CSS are cached. */}
        <a className="retry" href="/home">
          Try again
        </a>
      </main>
    </>
  );
}
