import * as React from "react";
import { Body, Container, Head, Html, Img, Preview } from "@react-email/components";
import type { Block, EmailSpec, Rich } from "./spec.ts";
import { buttonHtml } from "./button.ts";
import { headCss } from "./styles.ts";
import { fontStack, layout, light, toneColors, type Tone } from "./tokens.ts";

type FooterProps = { support: string; unsubscribeUrl?: string; alertsUrl?: string; assets: string };

const t = {
  ink: { color: light.ink },
  ink2: { color: light.ink2 },
  ink3: { color: light.ink3 },
};

const P_STYLE: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 16,
  lineHeight: "24px",
  fontFamily: fontStack,
};

function RichText({ r }: { r: Rich }) {
  const parts = Array.isArray(r) ? r : [r];
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <React.Fragment key={i}>{p}</React.Fragment>
        ) : "strong" in p ? (
          <strong key={i} style={{ fontWeight: 600 }}>
            {p.strong}
          </strong>
        ) : (
          <a key={i} href={p.href} className="tx-link" style={{ color: light.accent, textDecoration: "underline" }}>
            {p.link}
          </a>
        ),
      )}
    </>
  );
}

/** Table helper: email-safe presentational table. */
function T(props: React.TableHTMLAttributes<HTMLTableElement> & { children: React.ReactNode }) {
  const { children, style, ...rest } = props;
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ borderCollapse: "collapse", ...style }} {...rest}>
      <tbody>{children}</tbody>
    </table>
  );
}

function Pill({ tone, text }: { tone: Tone; text: string }) {
  const c = toneColors(tone);
  return (
    <T width="auto" style={{ width: "auto", margin: "0 0 14px" }}>
      <tr>
        <td className={`bg-${c.cls}`} bgcolor={c.bg} style={{ backgroundColor: c.bg, borderRadius: 999, padding: "4px 12px" }}>
          <span className={`tx-${c.cls}`} style={{ color: c.fg, fontFamily: fontStack, fontSize: 13, lineHeight: "18px", fontWeight: 600 }}>
            {text}
          </span>
        </td>
      </tr>
    </T>
  );
}

function Meter({ b }: { b: Extract<Block, { t: "meter" }> }) {
  const raw = b.total > 0 ? (b.used / b.total) * 100 : 0;
  const pct = Math.max(0, Math.min(100, Math.round(raw)));
  const over = raw >= 100;
  const fill = over ? light.attention : light.accent;
  const fillCls = over ? "fill-att" : "fill-info";
  const cell: React.CSSProperties = { fontSize: 0, lineHeight: "10px", height: 10 };
  return (
    <div style={{ margin: "4px 0 20px" }}>
      <T>
        <tr>
          <td className="tx-ink" style={{ ...t.ink, fontFamily: fontStack, fontSize: 15, lineHeight: "22px", fontWeight: 600, paddingBottom: 8 }}>
            {b.label}
          </td>
          <td align="right" className="tx-ink2" style={{ ...t.ink2, fontFamily: fontStack, fontSize: 15, lineHeight: "22px", paddingBottom: 8, whiteSpace: "nowrap" }}>
            <strong className="tx-ink" style={{ ...t.ink, fontWeight: 600 }}>{b.used}</strong> of {b.total} {b.unit}
          </td>
        </tr>
      </T>
      <T className="track" bgcolor={light.surface2} style={{ backgroundColor: light.surface2, borderRadius: 999 }}>
        <tr>
          {pct > 0 && (
            <td className={fillCls} width={`${pct}%`} bgcolor={fill} style={{ ...cell, backgroundColor: fill, borderRadius: pct >= 100 ? 999 : "999px 0 0 999px" }}>
              &nbsp;
            </td>
          )}
          {pct < 100 && (
            <td className="track" width={`${100 - pct}%`} bgcolor={light.surface2} style={{ ...cell, backgroundColor: light.surface2, borderRadius: pct === 0 ? 999 : "0 999px 999px 0" }}>
              &nbsp;
            </td>
          )}
        </tr>
      </T>
      {b.detail && (
        <p className="tx-ink2" style={{ ...P_STYLE, ...t.ink2, fontSize: 14, lineHeight: "20px", margin: "8px 0 0" }}>
          {b.detail}
        </p>
      )}
    </div>
  );
}

function Stats({ items }: { items: { value: string; label: string }[] }) {
  const w = `${Math.floor(100 / items.length)}%`;
  return (
    <T style={{ margin: "4px 0 20px" }}>
      <tr>
        {items.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <td width="8" style={{ width: 8, fontSize: 0 }}>&nbsp;</td>}
            <td width={w} valign="top" className="bg-surface2 stat-c" bgcolor={light.surface2} style={{ backgroundColor: light.surface2, borderRadius: 10, padding: "14px 16px" }}>
              <div className="tx-ink stat-v" style={{ ...t.ink, fontFamily: fontStack, fontSize: 26, lineHeight: "32px", fontWeight: 700, letterSpacing: "-0.01em" }}>
                {s.value}
              </div>
              <div className="tx-ink2" style={{ ...t.ink2, fontFamily: fontStack, fontSize: 13, lineHeight: "18px", marginTop: 2 }}>
                {s.label}
              </div>
            </td>
          </React.Fragment>
        ))}
      </tr>
    </T>
  );
}

function DataTable({ b }: { b: Extract<Block, { t: "table" }> }) {
  return (
    <div style={{ margin: "4px 0 20px" }}>
      {b.caption && (
        <p className="tx-ink" style={{ ...P_STYLE, ...t.ink, fontSize: 15, fontWeight: 600, margin: "0 0 4px" }}>
          {b.caption}
        </p>
      )}
      <T>
        {b.rows.map((r, i) => {
          const c = r.tone ? toneColors(r.tone) : null;
          return (
            <tr key={i}>
              <td className="tx-ink2 bd" style={{ ...t.ink2, fontFamily: fontStack, fontSize: 15, lineHeight: "22px", padding: "10px 12px 10px 0", borderBottom: `1px solid ${light.hairline}` }}>
                {r.label}
              </td>
              <td align="right" className={`${c ? `tx-${c.cls}` : "tx-ink"} bd`} style={{ color: c ? c.fg : light.ink, fontFamily: fontStack, fontSize: 15, lineHeight: "22px", fontWeight: 600, padding: "10px 0", borderBottom: `1px solid ${light.hairline}`, fontVariantNumeric: "tabular-nums" }}>
                {r.value}
              </td>
            </tr>
          );
        })}
      </T>
    </div>
  );
}

function Steps({ b }: { b: Extract<Block, { t: "steps" }> }) {
  return (
    <div style={{ margin: "4px 0 20px" }}>
      {b.title && (
        <p className="tx-ink" style={{ ...P_STYLE, ...t.ink, fontSize: 15, fontWeight: 600, margin: "0 0 8px" }}>
          {b.title}
        </p>
      )}
      <T>
        {b.items.map((s, i) => (
          <tr key={i}>
            <td width="36" valign="top" style={{ width: 36, padding: "2px 0 10px" }}>
              <div className="bg-info tx-info" style={{ backgroundColor: light.accentTonal, color: light.accent, width: 24, height: 24, lineHeight: "24px", borderRadius: 12, textAlign: "center", fontFamily: fontStack, fontSize: 13, fontWeight: 700 }}>
                {i + 1}
              </div>
            </td>
            <td valign="top" className="tx-ink" style={{ ...t.ink, fontFamily: fontStack, fontSize: 15, lineHeight: "24px", padding: "2px 0 10px" }}>
              <RichText r={s} />
            </td>
          </tr>
        ))}
      </T>
    </div>
  );
}

function List({ b }: { b: Extract<Block, { t: "list" }> }) {
  return (
    <T style={{ margin: "0 0 16px" }}>
      {b.items.map((it, i) => {
        const c = toneColors(it.tone ?? "neutral");
        return (
          <tr key={i}>
            <td width="14" valign="top" style={{ width: 14, paddingTop: 9 }}>
              <div className={`fill-${it.tone === "attention" ? "att" : "info"}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: it.tone === "attention" ? light.attention : it.tone === "ok" ? light.ok : light.ink3, fontSize: 0, lineHeight: "6px" }}>
                &nbsp;
              </div>
            </td>
            <td className="tx-ink bd" style={{ ...t.ink, fontFamily: fontStack, fontSize: 14, lineHeight: "20px", padding: "5px 0", borderBottom: `1px solid ${light.hairline}` }}>
              <RichText r={it.text} />
              {it.meta && (
                <span className={`tx-${c.cls === "neu" ? "ink3" : c.cls}`} style={{ color: it.tone && it.tone !== "neutral" ? c.fg : light.ink3, fontSize: 13 }}>
                  {"  "}
                  {it.meta}
                </span>
              )}
              {it.link && (
                <>
                  {"  "}
                  <a href={it.link.href} className="tx-link" style={{ color: light.accent, textDecoration: "underline", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>
                    {it.link.label}
                  </a>
                </>
              )}
            </td>
          </tr>
        );
      })}
    </T>
  );
}

function BlockView({ b, compact }: { b: Block; compact: boolean }) {
  switch (b.t) {
    case "p":
      return (
        <p className={b.muted ? "tx-ink2" : "tx-ink"} style={{ ...P_STYLE, ...(b.muted ? t.ink2 : t.ink), ...(compact ? { fontSize: 14, lineHeight: "21px", margin: "0 0 12px" } : {}) }}>
          <RichText r={b.text} />
        </p>
      );
    case "note": {
      const c = toneColors(b.tone);
      return (
        <T style={{ margin: "4px 0 20px" }}>
          <tr>
            <td className={`bg-${c.cls}`} bgcolor={c.bg} style={{ backgroundColor: c.bg, borderRadius: 10, padding: "12px 16px" }}>
              <p className="tx-ink" style={{ ...P_STYLE, ...t.ink, fontSize: 15, lineHeight: "22px", margin: 0 }}>
                <RichText r={b.text} />
              </p>
            </td>
          </tr>
        </T>
      );
    }
    case "meter":
      return <Meter b={b} />;
    case "stats":
      return <Stats items={b.items} />;
    case "table":
      return <DataTable b={b} />;
    case "steps":
      return <Steps b={b} />;
    case "h2":
      return (
        <p className="tx-ink" style={{ ...P_STYLE, ...t.ink, fontSize: 15, lineHeight: "22px", fontWeight: 700, margin: "18px 0 4px" }}>
          {b.text}
          {b.count != null && (
            <span className="tx-ink3" style={{ ...t.ink3, fontWeight: 400 }}>
              {"  "}
              {b.count}
            </span>
          )}
        </p>
      );
    case "list":
      return <List b={b} />;
  }
}

export function EmailLayout({ spec, footer }: { spec: EmailSpec; footer: FooterProps }) {
  const ops = spec.audience === "ops";
  const pad = ops ? 24 : layout.cardPadding;
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
        <meta name="x-apple-disable-message-reformatting" />
        <title>{spec.subject}</title>
        <style>{headCss}</style>
      </Head>
      <Preview>{spec.preheader}</Preview>
      <Body className="bg-canvas" style={{ backgroundColor: light.canvas, margin: 0, padding: 0, fontFamily: fontStack }}>
        <T className="bg-canvas" bgcolor={light.canvas} style={{ backgroundColor: light.canvas }}>
          <tr>
            <td align="center" className="wrap" style={{ padding: "0 16px" }}>
              <Container style={{ maxWidth: layout.maxWidth, width: "100%" }}>
                {/* Header: mark + text wordmark. Text stays readable with images off. */}
                <T>
                  <tr>
                  <td style={{ padding: ops ? "20px 4px 12px" : "28px 4px 16px" }}>
                  <T width="auto" style={{ width: "auto" }}>
                    <tr>
                      <td valign="middle" style={{ paddingRight: 8 }}>
                        <Img src={`${footer.assets}/brand/icon-mark.png`} width="26" height="26" alt="" style={{ display: "block", width: 26, height: 26 }} />
                      </td>
                      <td valign="middle" className="tx-ink" style={{ ...t.ink, fontFamily: fontStack, fontSize: 19, lineHeight: "26px", fontWeight: 700, letterSpacing: "-0.02em" }}>
                        Scalers
                        {ops && (
                          <span className="tx-ink3" style={{ ...t.ink3, fontWeight: 500, letterSpacing: 0, fontSize: 15 }}>
                            {" "}ops
                          </span>
                        )}
                      </td>
                    </tr>
                  </T>
                  </td>
                  </tr>
                </T>

                <T>
                <tr>
                <td className="bg-surface bd card" bgcolor={light.surface} style={{ backgroundColor: light.surface, border: `1px solid ${light.hairline}`, borderRadius: layout.radius, padding: pad }}>
                  {spec.pill && <Pill tone={spec.pill.tone} text={spec.pill.text} />}
                  <h1 className="tx-ink h1" style={{ ...t.ink, fontFamily: fontStack, margin: "0 0 16px", fontSize: ops ? 19 : 24, lineHeight: ops ? "26px" : "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>
                    {spec.heading}
                  </h1>
                  {spec.blocks.map((b, i) => (
                    <BlockView key={i} b={b} compact={ops} />
                  ))}
                  {spec.cta && (
                    <div style={{ margin: ops ? "8px 0 0" : "12px 0 0" }} dangerouslySetInnerHTML={{ __html: buttonHtml(spec.cta.label, spec.cta.href) }} />
                  )}
                  {spec.secondary && (
                    <p className="tx-ink2" style={{ ...P_STYLE, ...t.ink2, fontSize: 15, margin: "16px 0 0" }}>
                      <a href={spec.secondary.href} className="tx-link" style={{ color: light.accent, textDecoration: "underline", fontWeight: 500 }}>
                        {spec.secondary.label}
                      </a>
                    </p>
                  )}
                </td>
                </tr>
                </T>

                <T>
                <tr>
                <td style={{ padding: "20px 4px 32px" }}>
                  <p className="tx-ink3" style={{ ...P_STYLE, ...t.ink3, fontSize: 13, lineHeight: "19px", margin: "0 0 6px" }}>
                    {spec.reason}
                  </p>
                  {!ops && (
                    <p className="tx-ink3" style={{ ...P_STYLE, ...t.ink3, fontSize: 13, lineHeight: "19px", margin: "0 0 6px" }}>
                      Questions? Reply to this email or write to{" "}
                      <a href={`mailto:${footer.support}`} className="tx-link" style={{ color: light.ink2, textDecoration: "underline" }}>
                        {footer.support}
                      </a>
                      .
                    </p>
                  )}
                  {!spec.essential && footer.unsubscribeUrl && (
                    <p className="tx-ink3" style={{ ...P_STYLE, ...t.ink3, fontSize: 13, lineHeight: "19px", margin: 0 }}>
                      <a href={footer.unsubscribeUrl} className="tx-link" style={{ color: light.ink2, textDecoration: "underline" }}>
                        Unsubscribe
                      </a>
                      {footer.alertsUrl && (
                        <>
                          {" "}or{" "}
                          <a href={footer.alertsUrl} className="tx-link" style={{ color: light.ink2, textDecoration: "underline" }}>
                            choose which emails you get
                          </a>
                        </>
                      )}
                      .
                    </p>
                  )}
                </td>
                </tr>
                </T>
              </Container>
            </td>
          </tr>
        </T>
      </Body>
    </Html>
  );
}
