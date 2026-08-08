/**
 * SSRF-hardened public URL fetch for knowledge ingest.
 * Blocks private/link-local/metadata IPs before and after DNS + redirects.
 */

import dns from "node:dns/promises";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { promisify } from "node:util";

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
  if (normalized.startsWith("fe80:")) return true; // link-local
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
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links are allowed.");
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

/**
 * Fetch a public URL as text, with SSRF checks on each hop.
 */
export async function fetchPublicUrlSafe(rawUrl: string): Promise<SafeFetchResult> {
  let url = normalizePublicUrl(rawUrl);
  await assertHostSafe(url.hostname);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: {
          "User-Agent": "ScalersKnowledgeIngest/1.0 (+https://scalers.ke)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("That website took too long to respond. Try pasting the text instead.");
      }
      throw new Error("We could not open that website right now.");
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("The website redirected us nowhere.");
      if (hop === MAX_REDIRECTS) {
        throw new Error("Too many redirects from that website.");
      }
      const next = new URL(loc, url);
      await assertHostSafe(next.hostname);
      url = next;
      continue;
    }

    if (!res.ok) {
      throw new Error(`That website returned an error (${res.status}). Try pasting the text instead.`);
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/") &&
      !contentType.includes("html") &&
      !contentType.includes("json") &&
      !contentType.includes("xml")
    ) {
      throw new Error(
        "That link is not a normal web page. Paste the menu or FAQ text instead."
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error("That page is too large to scan. Paste the important section instead.");
    }

    const text = buf.toString("utf8");
    return {
      finalUrl: url.toString(),
      contentType,
      text,
    };
  }

  throw new Error("Too many redirects from that website.");
}
