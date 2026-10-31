"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import {
  demoAdapterFromEnv,
  type DemoConnection,
  type DemoSessionAdapter,
} from "./adapter";
import { NOTICE_V, businessLabel, COPY, DEMO_BUSINESSES, type DemoBusinessKey, type DemoLang } from "./copy";
import { demoDeviceId } from "./device";
import { DEMO_MAX_SEC, formatCountdown, stateForTokenFailure, type DemoState } from "./machine";
import { captureMic, createMicMeter, stopStream, type DemoMeter } from "./meter";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

function TurnstileBox({ onToken }: { onToken: (token: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY || !host.current) return;
    let widgetId = "";
    let cancelled = false;
    const render = () => {
      const turnstile = (window as unknown as {
        turnstile?: {
          render: (el: HTMLElement, opts: Record<string, unknown>) => string;
          remove: (id: string) => void;
        };
      }).turnstile;
      if (cancelled || !turnstile || !host.current) return;
      widgetId = turnstile.render(host.current, {
        sitekey: SITE_KEY,
        theme: "light",
        callback: (token: string) => onTokenRef.current(token),
      });
    };
    const ready = (window as unknown as { turnstile?: unknown }).turnstile;
    if (ready) render();
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => render();
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      const turnstile = (window as unknown as { turnstile?: { remove: (id: string) => void } }).turnstile;
      if (widgetId && turnstile) turnstile.remove(widgetId);
    };
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={host} className="min-h-11" />;
}

function Meter({ level }: { level: number }) {
  const bars = [0, 1, 2, 3, 4];
  return (
    <div className="flex h-11 items-end gap-1" aria-hidden="true">
      {bars.map((index) => {
        const scale = Math.min(1, Math.max(0.2, level * (1 - index * 0.1) + 0.2));
        return (
          <span
            key={index}
            className="demo-meter-bar h-7 w-1.5 origin-bottom rounded-full bg-brand"
            style={{ transform: `scaleY(${scale})` }}
          />
        );
      })}
    </div>
  );
}

export function VoiceDemo({
  previewState,
  previewLang = "en",
  adapter,
}: {
  previewState?: DemoState;
  previewLang?: DemoLang;
  adapter?: DemoSessionAdapter;
}) {
  const session = adapter ?? demoAdapterFromEnv();
  const [state, setState] = useState<DemoState>(previewState ?? "idle");
  const [lang, setLang] = useState<DemoLang>(previewLang);
  const [business, setBusiness] = useState<DemoBusinessKey | null>(previewState && previewState !== "idle" ? "home" : null);
  const [remaining, setRemaining] = useState(DEMO_MAX_SEC);
  const [level, setLevel] = useState(previewState === "live" ? 0.55 : 0.2);
  const [turnstile, setTurnstile] = useState("");
  const conn = useRef<DemoConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<DemoMeter | null>(null);
  const copy = COPY[lang];

  const release = useCallback(() => {
    conn.current?.stop();
    conn.current = null;
    meter.current?.stop();
    stopStream(stream.current);
    stream.current = null;
  }, []);

  useEffect(() => () => release(), [release]);

  const onToken = useCallback((token: string) => setTurnstile(token), []);

  async function start() {
    if (previewState || !business) return;
    setState("connecting");
    const mic = await captureMic();
    if (mic === "unsupported") {
      setState("unsupported");
      return;
    }
    if (mic === "denied") {
      setState("mic_denied");
      return;
    }
    stream.current = mic;
    meter.current = createMicMeter();
    meter.current.onLevel(setLevel);
    meter.current.start(mic);
    const minted = await session.mint({
      tenant: business,
      lang,
      turnstile: turnstile || (process.env.NEXT_PUBLIC_DEMO_ADAPTER === "mock" ? "mock" : ""),
      device_id: demoDeviceId(),
      consent_ts: new Date().toISOString(),
      notice_v: NOTICE_V,
    });
    if (!minted.ok) {
      release();
      setState(stateForTokenFailure(minted.status, minted.reason));
      return;
    }
    const next = session.open({ token: minted.token, wsUrl: minted.wsUrl, maxSec: minted.maxSec });
    conn.current = next;
    setRemaining(minted.maxSec);
    setState("live");
    next.onTick(setRemaining);
    next.onLevel(setLevel);
    next.onEnd(() => {
      release();
      setState("ended");
    });
  }

  function endLive() {
    if (previewState) return;
    release();
    setState("ended");
  }

  return (
    <section
      aria-labelledby="voice-demo-title"
      data-demo-state={state}
      className="demo-stage mx-auto w-full max-w-[22.5rem] rounded-2xl bg-surface p-4 text-ink sm:max-w-md lg:max-w-lg"
    >
      <h2 id="voice-demo-title" className="font-display text-page tracking-tight">
        {copy.title}
      </h2>
      {state === "idle" ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="font-demo text-body text-ink-2">{copy.lead}</p>
          <div>
            <p className="font-demo text-meta text-ink-2">{copy.choose}</p>
            <div className="mt-2 flex flex-col gap-2">
              {DEMO_BUSINESSES.map((item) => {
                const selected = business === item.key;
                return (
                  <Button
                    key={item.key}
                    type="button"
                    variant="tonal"
                    block
                    aria-pressed={selected}
                    className={selected ? "ring-2 ring-brand" : undefined}
                    onClick={() => setBusiness(item.key)}
                  >
                    {businessLabel(item.key, lang)}
                  </Button>
                );
              })}
            </div>
          </div>
          <Segmented
            label={copy.language}
            className="!mx-0 !px-0 sm:!mx-0 sm:!px-0"
            items={[
              { key: "en", label: copy.english, active: lang === "en" },
              { key: "sw", label: copy.kiswahili, active: lang === "sw" },
            ]}
            onSelect={(key) => setLang(key === "sw" ? "sw" : "en")}
          />
          <Button type="button" variant="primary" block disabled={!business} onClick={() => business && setState("consent")}>
            {copy.continue}
          </Button>
        </div>
      ) : null}

      {state === "consent" ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="font-demo text-meta text-ink-2">{business ? businessLabel(business, lang) : ""}</p>
          <h3 className="font-display text-title">{copy.before}</h3>
          <p className="font-demo text-body">{copy.notice}</p>
          <p className="font-demo text-meta text-ink-2">{copy.data}</p>
          <Link href="/privacy" className="font-demo inline-flex min-h-11 items-center text-body text-ink underline">
            {copy.privacy}
          </Link>
          <TurnstileBox onToken={onToken} />
          <Button type="button" variant="primary" block onClick={() => void start()}>
            {copy.start}
          </Button>
          <Button type="button" variant="ghost" block onClick={() => setState("idle")}>
            {copy.back}
          </Button>
        </div>
      ) : null}

      {state === "mic_denied" ? (
        <div className="mt-4 flex flex-col gap-4" role="status">
          <p className="font-demo text-body">{copy.denied}</p>
          <Button type="button" variant="primary" block onClick={() => void start()}>
            {copy.deniedAgain}
          </Button>
        </div>
      ) : null}

      {state === "connecting" ? (
        <div className="mt-4" role="status">
          <Button type="button" variant="primary" block pending>
            {copy.connecting}
          </Button>
        </div>
      ) : null}

      {state === "live" ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="font-demo text-meta text-ink-2">{copy.live}</p>
          <p className="font-display text-display tabular-nums tracking-tight">
            <span className="sr-only">{copy.timeLeft} </span>
            {formatCountdown(remaining)}
          </p>
          <Meter level={level} />
          <Button type="button" variant="primary" block onClick={endLive}>
            {copy.end}
          </Button>
        </div>
      ) : null}

      {state === "ended" ? (
        <div className="mt-4 flex flex-col gap-4" role="status">
          <p className="font-demo text-body">{copy.ended}</p>
          <ButtonLink href="/signup" variant="primary" block>
            {copy.signup}
          </ButtonLink>
        </div>
      ) : null}

      {state === "disabled" ? (
        <p className="font-demo mt-4 text-body" role="status">
          {copy.paused}
        </p>
      ) : null}

      {state === "busy" ? (
        <div className="mt-4 flex flex-col gap-4" role="status">
          <p className="font-demo text-body">{copy.busy}</p>
          <Button type="button" variant="primary" block onClick={() => void start()}>
            {copy.retry}
          </Button>
        </div>
      ) : null}

      {state === "limit" ? (
        <p className="font-demo mt-4 text-body" role="status">
          {copy.limit}
        </p>
      ) : null}

      {state === "error" ? (
        <div className="mt-4 flex flex-col gap-4" role="status">
          <p className="font-demo text-body">{copy.error}</p>
          <Button type="button" variant="primary" block onClick={() => void start()}>
            {copy.retry}
          </Button>
        </div>
      ) : null}

      {state === "unsupported" ? (
        <p className="font-demo mt-4 text-body" role="status">
          {copy.unsupported}
        </p>
      ) : null}
    </section>
  );
}
