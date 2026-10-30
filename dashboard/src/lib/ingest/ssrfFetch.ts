/**
 * SSRF-hardened public URL fetch for knowledge ingest.
 * Blocks private/link-local/metadata IPs before and after DNS + redirects.
 */

import dns from "node:dns/promises";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { promisify } from "node:util";
import https from "node:https";
import type { LookupFunction } from "node:net";

const dnsLookupAsync = promisify(dnsLookup);

const MAX_BYTES = 1_500_000; // ~1.5MB
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!base || !Number.isFinite(bits)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const blocked = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "127.0.0.0/8",
    "169.254.0.0/16", // link-local + cloud metadata
    "172.16.0.0/12",
    "192.168.0.0/16",
    "100.64.0.0/10",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ];
  return blocked.some((c) => ipv4InCidr(ip, c));
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (/^fe[89ab]/.test(normalized)) return true; // link-local fe80::/10
  if (normalized.startsWith("fec") || normalized.startsWith("fed") || normalized.startsWith("fee") || normalized.startsWith("fef")) return true; // site-local
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("2001:db8:") || normalized.startsWith("64:ff9b:") || normalized.startsWith("2002:")) return true; // docs, NAT64, 6to4
  // IPv4-mapped in hex (::ffff:7f00:1)
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) + parseInt(hex[2], 16);
    if (isBlockedIpv4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."))) return true;
  }
  // IPv4-mapped
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] && isBlockedIpv4(mapped[1])) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

async function assertHostSafe(hostname: string): Promise<void> {
  const host = hostname.trim().toLowerCase();
  if (!host) throw new Error("URL is missing a host.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("That link points to a local address, which we cannot open.");
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error("That link points to a private network address.");
    }
    return;
  }

  let records: { address: string; family: number }[];
  try {
    // Prefer dual-stack answers
    const result = await dnsLookupAsync(host, { all: true, verbatim: true });
    records = Array.isArray(result)
      ? (result as { address: string; family: number }[])
      : [{ address: String((result as { address: string }).address), family: 4 }];
  } catch {
    // Fallback
    try {
      const v4 = await dns.resolve4(host);
      records = v4.map((address) => ({ address, family: 4 }));
    } catch {
      throw new Error("We could not resolve that website. Check the link and try again.");
    }
  }

  if (!records.length) {
    throw new Error("We could not resolve that website. Check the link and try again.");
  }
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new Error("That link resolves to a private network address.");
    }
  }
}

function normalizePublicUrl(raw: string): URL {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Add a website link first.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That does not look like a valid link. Use https://…");
  }
  // https only (30 Oct): a plain http link is read as its https address.
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") {
    throw new Error("Only https links are allowed.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Links with a port number are not allowed.");
  }
  if (url.username || url.password) {
    throw new Error("Links with usernames or passwords are not allowed.");
  }
  return url;
}

export type SafeFetchResult = {
  finalUrl: string;
  contentType: string;
  text: string;
};

/** Pinned lookup: the socket connects to the address checked here, so DNS cannot change between check and connect. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (Array.isArray(addresses) ? addresses : []) as { address: string; family: number }[];
    if (!list.length || list.some((a) => isBlockedIp(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    const want = typeof options === "object" && options && "family" in options ? options.family : 0;
    const pick = list.find((a) => !want || a.family === want) || list[0];
    if (typeof options === "object" && options && "all" in options && options.all) {
      return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pick]);
    }
    callback(null, pick.address, pick.family);
  });
};

const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

/** Exported for tests: is a content type one we read as a page? (no JSON, XML, images or downloads). */
export function isReadableContentType(contentType: string): boolean {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  return !ct || ALLOWED_TYPES.includes(ct);
}

type Hop = { status: number; location: string | null; contentType: string; body: Buffer | null };

/** One GET over a pinned socket. The deadline covers the body too; the body stops at maxBytes. */
function getOnce(url: URL, maxBytes: number, timeoutMs: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: safeLookup,
        headers: {
          "User-Agent": "ScalersKnowledgeIngest/1.0 (+https://scalers.ke)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const contentType = String(res.headers["content-type"] || "").toLowerCase();
        if ([301, 302, 303, 307, 308].includes(status) || status < 200 || status >= 300 || !isReadableContentType(contentType)) {
          res.resume();
          clearTimeout(timer);
          return resolve({ status, location: (res.headers.location as string) || null, contentType, body: null });
        }
        const declared = Number(res.headers["content-length"] || 0);
        if (declared > maxBytes) {
          req.destroy();
          clearTimeout(timer);
          return reject(new Error("TOO_LARGE"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            clearTimeout(timer);
            reject(new Error("TOO_LARGE"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status, location: null, contentType, body: Buffer.concat(chunks) });
        });
        res.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("TIMEOUT"));
    }, timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** robots.txt: does the "*" (or our) group disallow this path? Any failure reads as allowed. */
export function robotsDisallows(robots: string, path: string): boolean {
  let applies = false;
  let inGroup = false;
  const rules: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!inGroup) applies = false;
      inGroup = true;
      if (val === "*" || /scalers/i.test(val)) applies = true;
      continue;
    }
    inGroup = false;
    if (applies && key === "disallow" && val) rules.push(val);
  }
  return rules.some((r) => path.startsWith(r.replace(/\*$/, "")));
}

/**
 * Fetch a public https URL as text. Every hop: host and DNS checked, the socket pinned to the checked address,
 * port 443 only, 8 s for headers and body together, body capped at 1.5 MB while streaming, HTML or plain text only,
 * robots.txt respected for the first page.
 */
export async function fetchPublicUrlSafe(rawUrl: string): Promise<SafeFetchResult> {
  let url = normalizePublicUrl(rawUrl);
  await assertHostSafe(url.hostname);

  try {
    const robots = await getOnce(new URL("/robots.txt", url), 64_000, 3_000);
    if (robots.status === 200 && robots.body && robotsDisallows(robots.body.toString("utf8"), url.pathname || "/")) {
      throw new Error("ROBOTS");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "ROBOTS") {
      throw new Error("That website asks not to be read by tools. Paste the text instead.");
    }
    /* no robots.txt: allowed */
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res: Hop;
    try {
      res = await getOnce(url, MAX_BYTES, TIMEOUT_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "TOO_LARGE") throw new Error("That page is too large to scan. Paste the important section instead.");
      if (msg === "TIMEOUT") throw new Error("That website took too long to respond. Try pasting the text instead.");
      if (msg === "blocked address") throw new Error("That link resolves to a private network address.");
      throw new Error("We could not open that website right now.");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (!res.location) throw new Error("The website redirected us nowhere.");
      if (hop === MAX_REDIRECTS) {
        throw new Error("Too many redirects from that website.");
      }
      const next = normalizePublicUrl(new URL(res.location, url).toString());
      await assertHostSafe(next.hostname);
      url = next;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`That website returned an error (${res.status}). Try pasting the text instead.`);
    }
    if (!res.body) {
      throw new Error("That link is not a normal web page. Paste the menu or FAQ text instead.");
    }
    return {
      finalUrl: url.toString(),
      contentType: res.contentType,
      text: res.body.toString("utf8"),
    };
  }

  throw new Error("Too many redirects from that website.");
}
