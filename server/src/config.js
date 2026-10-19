// Central configuration. Secrets come only from environment variables.

export const RETENTION_HOURS = 168; // rolling seven-day window, by publication time
export const FUTURE_TOLERANCE_MINUTES = 60; // publication dates further ahead than this are treated as invalid
export const FEED_TIMEOUT_MS = 15000;
// Wikipedia asks API clients to identify themselves with a contact address.
export const USER_AGENT = `MyNews-CS403/1.0 (student news-reader project${process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ""})`;

// At least three distinct publishers. Each feed is official and public.
export const PUBLISHERS = [
  { id: "fox", name: "Fox News", feedUrl: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { id: "npr", name: "NPR", feedUrl: "https://feeds.npr.org/1001/rss.xml" },
  { id: "bbc", name: "BBC News", feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "guardian", name: "The Guardian", feedUrl: "https://www.theguardian.com/world/rss" },
  { id: "aljazeera", name: "Al Jazeera", feedUrl: "https://www.aljazeera.com/xml/rss/all.xml" },
  { id: "cbs", name: "CBS News", feedUrl: "https://www.cbsnews.com/latest/rss/main" }
];

export const env = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL || "",
  // Local-only fallback: embedded Postgres (PGlite) stored on disk. Not used when DATABASE_URL is set.
  pgliteDir: process.env.PGLITE_DIR || "./.data/pglite",
  adminToken: process.env.ADMIN_TOKEN || "",
  internalScheduler: process.env.ENABLE_INTERNAL_SCHEDULER === "true",
  maxSummariesPerRun: Number(process.env.MAX_SUMMARIES_PER_RUN || 40),
  feedOverrides: process.env.FEED_URL_OVERRIDES || "" // JSON {publisherId: url}; used to simulate a broken feed
};

export function publishers() {
  let overrides = {};
  if (env.feedOverrides) {
    try {
      overrides = JSON.parse(env.feedOverrides);
    } catch {
      console.warn("FEED_URL_OVERRIDES is not valid JSON; ignoring");
    }
  }
  return PUBLISHERS.map((p) => ({ ...p, feedUrl: overrides[p.id] || p.feedUrl }));
}
