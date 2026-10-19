import { createHash } from "node:crypto";
import { FUTURE_TOLERANCE_MINUTES, RETENTION_HOURS } from "../config.js";

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const TRACKING_PARAMS = /^(utm_|at_|cmpid|ocid|fbclid|gclid|taid|intcmp|CMP)/i;

// Normalized URL = the dedupe key. Lowercase host, https, no fragment,
// no tracking query params, no trailing slash.
export function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

export function articleId(publisherId, normalizedUrl) {
  return sha256(`${publisherId}|${normalizedUrl}`).slice(0, 32);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };

export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<(script|style|figure|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

// Returns a Date, or null when the publication date is missing, unparseable,
// or implausibly far in the future. Such articles are skipped (never stored),
// because retention depends on a trustworthy publication time.
export function parsePublished(text, now = new Date()) {
  if (!text) return null;
  const date = new Date(String(text).trim());
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > now.getTime() + FUTURE_TOLERANCE_MINUTES * 60_000) return null;
  return date;
}

export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - RETENTION_HOURS * 3600_000);
}

export function contentHash(title, excerpt) {
  return sha256(`${title}\n${excerpt}`).slice(0, 32);
}
