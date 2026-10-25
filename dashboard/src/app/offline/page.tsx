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
        {/* The real transparent Scalers mark (same PNG as the home-screen icon); precached by sw.js. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mark" src="/icons/icon-192.png" width={40} height={40} alt="" />
        <h1>You&apos;re offline</h1>
        <p>Your assistant is still answering calls. New calls show here when you&apos;re back online.</p>
        <p className="sw" lang="sw">
          Hakuna mtandao. Simu bado zinajibiwa.
        </p>
        {/* Plain link: works with no JS, since only this HTML and its CSS are cached. */}
        <a className="retry" href="/home">
          Try again
        </a>
      </main>
    </>
  );
}
