import { XMLParser } from "fast-xml-parser";
import { FEED_TIMEOUT_MS, USER_AGENT } from "../config.js";
import { contentHash, normalizeUrl, parsePublished, stripHtml } from "./normalize.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  removeNSPrefix: true,
  processEntities: false
});

export async function fetchFeed(publisher, { now = new Date(), fetchImpl = fetch } = {}) {
  const response = await fetchImpl(publisher.feedUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFeed(await response.text(), publisher, now);
}

// Returns { articles, skipped } where skipped counts items without a usable title, link, or date.
export function parseFeed(xmlText, publisher, now = new Date()) {
  let doc;
  try {
    doc = parser.parse(xmlText);
  } catch (error) {
    throw new Error(`XML parse failed: ${error.message}`);
  }

  const items = asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.RDF?.item);
  if (!doc?.rss && !doc?.feed && !doc?.RDF) throw new Error("Not an RSS or Atom document");

  const articles = [];
  let skipped = 0;

  for (const item of items) {
    const title = stripHtml(text(item.title));
    const link = linkOf(item);
    const normalized = link ? normalizeUrl(link) : null;
    const published = parsePublished(text(item.pubDate) || text(item.published) || text(item.updated) || text(item.date), now);

    if (!title || !normalized || !published) {
      skipped += 1;
      continue;
    }

    const excerpt = truncate(stripHtml(text(item.description) || text(item.summary) || text(item.encoded) || text(item.content)), 1200);
    articles.push({
      publisherId: publisher.id,
      url: link.trim(),
      urlNormalized: normalized,
      guid: text(item.guid) || text(item.id) || null,
      title,
      excerpt,
      publishedAt: published,
      contentHash: contentHash(title, excerpt)
    });
  }

  return { articles, skipped };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text(value["#text"] ?? "");
  return "";
}

function linkOf(item) {
  const link = item.link;
  if (typeof link === "string") return link;
  for (const entry of asArray(link)) {
    if (typeof entry === "string") return entry;
    if (entry?.["@href"] && (!entry["@rel"] || entry["@rel"] === "alternate")) return entry["@href"];
  }
  const guid = item.guid;
  if (guid && typeof guid === "object" && guid["@isPermaLink"] !== "false" && /^https?:/.test(text(guid))) return text(guid);
  if (typeof guid === "string" && /^https?:/.test(guid)) return guid;
  return "";
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}
