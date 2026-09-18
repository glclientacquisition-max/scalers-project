"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#F4F7FB",
          color: "#0A192F",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: 24,
        }}
      >
        <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
          Could not load Scalers.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            minHeight: 44,
            padding: "0 16px",
            background: "#005CCC",
            color: "#fff",
            border: 0,
            borderRadius: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
