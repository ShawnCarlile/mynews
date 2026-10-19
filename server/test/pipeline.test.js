// End-to-end checks of the collection pipeline and API against an in-memory Postgres (PGlite).
// External services (feeds, Wikipedia, Claude) are replaced with controlled fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";
import { runCollection } from "../src/pipeline.js";
import { createApp } from "../src/api.js";
import { contentHash, normalizeUrl } from "../src/ingest/normalize.js";
import { SummaryError } from "../src/ai/summarize.js";

const PUBLISHERS = [
  { id: "fox", name: "Fox News", feedUrl: "https://example.com/fox.xml" },
  { id: "npr", name: "NPR", feedUrl: "https://example.com/npr.xml" },
  { id: "bbc", name: "BBC News", feedUrl: "https://example.com/bbc.xml" }
];
const HOUR = 3600_000;
const T0 = new Date("2026-10-19T12:00:00Z");

function item(publisherId, slug, title, excerpt, publishedAt) {
  const url = `https://${publisherId}.example.com/news/${slug}?utm_source=rss`;
  return { publisherId, url, urlNormalized: normalizeUrl(url), guid: slug, title, excerpt, publishedAt, contentHash: contentHash(title, excerpt) };
}

// Three publishers cover one older event (BBC is 166h old at T0, so it expires first), plus an unrelated story.
function feedsAt(t0) {
  return {
    fox: [item("fox", "fire", "Wildfire forces evacuation of Pine Valley as Cedar Ridge Fire spreads", "Residents of Pine Valley, Colorado, fled the Cedar Ridge Fire on Tuesday as winds spread flames.", new Date(t0 - 150 * HOUR))],
    npr: [item("npr", "fire", "Cedar Ridge Fire: Pine Valley residents flee as blaze grows", "The Cedar Ridge Fire near Pine Valley, Colorado, grew overnight and residents fled.", new Date(t0 - 155 * HOUR))],
    bbc: [
      item("bbc", "fire", "Pine Valley evacuated as Cedar Ridge Fire threatens Colorado town", "Officials in Colorado evacuated Pine Valley as the Cedar Ridge Fire spread toward the town.", new Date(t0 - 166 * HOUR)),
      item("bbc", "rates", "Federal Reserve holds interest rates steady", "The Federal Reserve kept interest rates unchanged on Wednesday.", new Date(t0 - 5 * HOUR))
    ]
  };
}

function fakeFetch(feeds, { failing = [] } = {}) {
  return async (publisher) => {
    if (failing.includes(publisher.id)) throw new Error("HTTP 503");
    return { articles: feeds[publisher.id] || [], skipped: 0 };
  };
}

function fakeSummarizer() {
  const calls = [];
  const impl = async (articles) => {
    calls.push(articles.map((a) => a.id));
    return {
      overview: `Overview of ${articles.length} articles.`,
      agreement: "Sources report the same event.",
      disagreement: "No meaningful disagreement in the available excerpts.",
      uncertainty: "Cause unknown.",
      overview_refs: articles.map((a) => a.id),
      perspectives_status: "insufficient_evidence",
      perspectives: [],
      input_scope: "feed_excerpts",
      model: "test-model",
      prompt_version: "test"
    };
  };
  return { impl, calls };
}

// Resources are released in t.after so a failed assertion cannot leave the process hanging.
async function setup(t) {
  const db = await createDb({ memory: true, databaseUrl: "" });
  t.after(() => db.close());
  return db;
}

async function collect(db, at, { feeds = feedsAt(T0.getTime()), failing = [], summarizer } = {}) {
  return runCollection(db, {
    trigger: "schedule",
    now: () => at,
    publishers: PUBLISHERS,
    fetchFeedImpl: fakeFetch(feeds, { failing }),
    findBackgroundImpl: async () => [],
    generateSummaryImpl: summarizer.impl
  });
}

async function api(t, db, at) {
  const app = createApp(db, { now: () => at });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = {
    get: async (path) => {
      const res = await fetch(base + path);
      return { status: res.status, body: await res.json() };
    },
    post: async (path, headers = {}) => {
      const res = await fetch(base + path, { method: "POST", headers });
      return { status: res.status, body: await res.json() };
    },
    close: async () => {}
  };
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return client;
}

const count = async (db, table) => (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;

test("repeated ingestion of identical feeds does not duplicate articles or stories", async (t) => {
  const db = await setup(t);
  const summarizer = fakeSummarizer();
  const first = await collect(db, T0, { summarizer });
  const articles = await count(db, "articles");
  const stories = await count(db, "stories");

  const second = await collect(db, new Date(T0.getTime() + HOUR), { summarizer });
  assert.equal(first.articlesNew, 4);
  assert.equal(second.articlesNew, 0);
  assert.equal(second.articlesUnchanged, 4);
  assert.equal(await count(db, "articles"), articles);
  assert.equal(await count(db, "stories"), stories);
  assert.equal(stories, 2, "three fire articles group into one story; the rates article is separate");
});

test("same event from different publishers appears once with one button per publisher", async (t) => {
  const db = await setup(t);
  await collect(db, T0, { summarizer: fakeSummarizer() });
  const client = await api(t, db, T0);
  const list = await client.get("/stories");
  const fire = list.body.stories.find((s) => s.headline.includes("Cedar Ridge") || s.headline.includes("Pine Valley"));
  assert.equal(fire.publisher_count, 3);
  const detail = await client.get(`/stories/${fire.id}`);
  assert.deepEqual(detail.body.publishers.map((p) => p.name), ["BBC News", "Fox News", "NPR"]);
  assert.ok(detail.body.articles.every((a) => a.url.startsWith("https://")));
});

test("seven-day boundary: expired articles leave the API between runs and are deleted at cleanup", async (t) => {
  const db = await setup(t);
  const summarizer = fakeSummarizer();
  await collect(db, T0, { summarizer });

  // 3 hours later the BBC fire article is 169h old. No run has happened yet.
  const later = new Date(T0.getTime() + 3 * HOUR);
  let client = await api(t, db, later);
  const list = await client.get("/stories");
  const fire = list.body.stories.find((s) => s.publisher_count >= 2);
  assert.equal(fire.publisher_count, 2, "BBC no longer counted");
  const detail = await client.get(`/stories/${fire.id}`);
  assert.deepEqual(detail.body.publishers.map((p) => p.id).sort(), ["fox", "npr"]);
  assert.equal(detail.body.summary.status, "outdated", "summary that used the expired article is not served");
  assert.equal(detail.body.summary.overview, undefined);

  // The next hourly run deletes it and rebuilds the summary from retained articles only.
  const run = await collect(db, later, { summarizer, feeds: { fox: feedsAt(T0.getTime()).fox, npr: feedsAt(T0.getTime()).npr, bbc: [] } });
  assert.equal(run.articlesExpired, 1);
  const bbcRows = (await db.query("SELECT id FROM articles WHERE publisher_id = 'bbc' AND url_normalized LIKE '%fire%'")).rows;
  assert.equal(bbcRows.length, 0, "expired article deleted from storage");

  client = await api(t, db, later);
  const rebuilt = await client.get(`/stories/${fire.id}`);
  assert.equal(rebuilt.body.summary.status, "current");
  assert.equal(rebuilt.body.summary.input_article_ids.length, 2);
  assert.ok(rebuilt.body.summary.version >= 2);

  // Stories whose only article expired are removed with their summaries.
  const muchLater = new Date(T0.getTime() + 200 * HOUR);
  const final = await collect(db, muchLater, { summarizer, feeds: {} });
  assert.equal(final.storiesRemoved, 2);
  assert.equal(await count(db, "stories"), 0);
  assert.equal(await count(db, "summaries"), 0);
});

test("shared AI output: repeated reads and unchanged runs reuse the stored summary", async (t) => {
  const db = await setup(t);
  const summarizer = fakeSummarizer();
  await collect(db, T0, { summarizer });
  const callsAfterFirstRun = summarizer.calls.length;
  assert.equal(callsAfterFirstRun, 2, "one generation per story");

  const clientA = await api(t, db, T0);
  const clientB = await api(t, db, T0);
  const id = (await clientA.get("/stories")).body.stories[0].id;
  const reads = await Promise.all([clientA.get(`/stories/${id}`), clientB.get(`/stories/${id}`), clientA.get(`/stories/${id}`)]);
  const versions = new Set(reads.map((r) => `${r.body.summary.version}|${r.body.summary.generated_at}`));
  assert.equal(versions.size, 1, "all clients see the same stored version");

  await collect(db, new Date(T0.getTime() + HOUR), { summarizer });
  assert.equal(summarizer.calls.length, callsAfterFirstRun, "no new generation when inputs are unchanged");
});

test("provider failure: a failing feed or AI call keeps valid stored stories usable", async (t) => {
  const db = await setup(t);
  await collect(db, T0, { summarizer: fakeSummarizer() });

  const failingAi = { impl: async () => { throw new SummaryError("AI service error 529: overloaded"); } };
  const changed = feedsAt(T0.getTime());
  changed.fox[0] = item("fox", "fire", changed.fox[0].title, "Updated: residents of Pine Valley fled the Cedar Ridge Fire.", changed.fox[0].publishedAt);
  const run = await collect(db, new Date(T0.getTime() + HOUR), { feeds: changed, failing: ["npr"], summarizer: failingAi });
  assert.equal(run.outcome, "partial");
  assert.equal(run.feedResults.find((f) => f.publisher === "npr").ok, false);
  assert.equal(run.summariesFailed, 1);

  const client = await api(t, db, new Date(T0.getTime() + HOUR));
  const list = await client.get("/stories");
  assert.equal(list.body.stories.length, 2, "stories from earlier runs remain");
  assert.equal(list.body.collection.last_run.outcome, "partial");
  assert.ok(list.body.collection.last_successful_at);
  const fire = list.body.stories.find((s) => s.publisher_count === 3);
  const detail = await client.get(`/stories/${fire.id}`);
  assert.ok(detail.body.summary.overview, "previous summary built from still-valid articles is kept");
  assert.equal(detail.body.summary.last_error, "AI service error 529: overloaded");
});

test("AI never configured: summary status is an honest failure, not fallback text", async (t) => {
  const db = await setup(t);
  const noAi = { impl: async () => { throw new SummaryError("AI service not configured (ANTHROPIC_API_KEY missing on server)"); } };
  await collect(db, T0, { summarizer: noAi });
  const client = await api(t, db, T0);
  const id = (await client.get("/stories")).body.stories[0].id;
  const detail = await client.get(`/stories/${id}`);
  assert.equal(detail.body.summary.status, "failed");
  assert.equal(detail.body.summary.overview, undefined);
  assert.match(detail.body.summary.message, /unavailable/);
});

test("admin collection trigger is protected", async (t) => {
  const db = await setup(t);
  const client = await api(t, db, T0);
  const res = await client.post("/admin/collect");
  assert.equal(res.status, 401);
  const wrong = await client.post("/admin/collect", { Authorization: "Bearer nope" });
  assert.equal(wrong.status, 401);
  const missing = await client.get("/stories/does-not-exist");
  assert.equal(missing.status, 404);
});
