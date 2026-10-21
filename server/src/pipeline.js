// The hourly collection run: fetch -> upsert -> expire -> group -> background -> summarize.
// Every external call is isolated so one failing feed, Wikipedia lookup, or AI request
// cannot abort the run or erase results that are still valid.
import { randomUUID } from "node:crypto";
import { env, publishers as configuredPublishers } from "./config.js";
import { fetchFeed } from "./ingest/rss.js";
import { articleId, retentionCutoff, sha256 } from "./ingest/normalize.js";
import { cleanup } from "./retention.js";
import { chooseHeadline, groupArticles } from "./grouping.js";
import { findBackground, RateLimitedError } from "./background.js";
import { generateSummary, SummaryError } from "./ai/summarize.js";
import { PROMPT_VERSION } from "./ai/prompts.js";

const STALE_RUN_MINUTES = 30;
const AI_CONCURRENCY = 1; // one request at a time to stay inside the Gemini free-tier rate limit

export async function runCollection(db, options = {}) {
  const {
    trigger = "cli",
    now = () => new Date(),
    publishers = configuredPublishers(),
    fetchFeedImpl = fetchFeed,
    findBackgroundImpl = findBackground,
    generateSummaryImpl = generateSummary,
    skipFetch = false
  } = options;

  const running = await db.query(
    "SELECT id FROM collection_runs WHERE outcome = 'running' AND started_at > $1",
    [new Date(now().getTime() - STALE_RUN_MINUTES * 60_000)]
  );
  if (running.rows.length) {
    return { skipped: true, reason: `run ${running.rows[0].id} is already in progress` };
  }

  const runId = (await db.query("INSERT INTO collection_runs (trigger, started_at) VALUES ($1, $2) RETURNING id", [trigger, now()])).rows[0].id;
  const stats = {
    feedResults: [],
    articlesFetched: 0, articlesNew: 0, articlesUpdated: 0, articlesUnchanged: 0, articlesSkipped: 0,
    articlesExpired: 0, storiesCreated: 0, storiesRemoved: 0,
    summariesGenerated: 0, summariesFailed: 0, backgroundLinks: 0
  };

  try {
    for (const p of publishers) {
      await db.query(
        `INSERT INTO publishers (id, name, feed_url, is_fixture) VALUES ($1, $2, $3, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, feed_url = EXCLUDED.feed_url`,
        [p.id, p.name, p.feedUrl]
      );
    }

    if (!skipFetch) await collectFeeds(db, publishers, fetchFeedImpl, now(), stats);

    const cleaned = await cleanup(db, now());
    stats.articlesExpired = cleaned.articlesExpired;
    stats.storiesRemoved = cleaned.storiesRemoved;

    stats.storiesCreated = await assignStories(db, now());
    stats.backgroundLinks = await updateBackground(db, findBackgroundImpl, now());
    await updateSummaries(db, generateSummaryImpl, now(), stats);

    const feedFailures = stats.feedResults.filter((f) => !f.ok).length;
    const outcome =
      stats.feedResults.length > 0 && feedFailures === stats.feedResults.length
        ? "failed"
        : feedFailures > 0 || stats.summariesFailed > 0
          ? "partial"
          : "success";
    await finishRun(db, runId, outcome, stats, null, now());
    return { runId, outcome, ...stats };
  } catch (error) {
    console.error("collection run failed", error);
    await finishRun(db, runId, "failed", stats, error.message, now());
    return { runId, outcome: "failed", error: error.message, ...stats };
  }
}

async function finishRun(db, runId, outcome, s, error, finishedAt) {
  await db.query(
    `UPDATE collection_runs SET finished_at = $2, outcome = $3, feed_results = $4,
       articles_fetched = $5, articles_new = $6, articles_updated = $7, articles_unchanged = $8, articles_skipped = $9,
       articles_expired = $10, stories_created = $11, stories_removed = $12,
       summaries_generated = $13, summaries_failed = $14, background_links = $15, error = $16
     WHERE id = $1`,
    [runId, finishedAt, outcome, JSON.stringify(s.feedResults), s.articlesFetched, s.articlesNew, s.articlesUpdated,
      s.articlesUnchanged, s.articlesSkipped, s.articlesExpired, s.storiesCreated, s.storiesRemoved,
      s.summariesGenerated, s.summariesFailed, s.backgroundLinks, error]
  );
}

async function collectFeeds(db, publishers, fetchFeedImpl, now, stats) {
  const cutoff = retentionCutoff(now);
  const results = await Promise.allSettled(publishers.map((p) => fetchFeedImpl(p, { now })));

  for (const [i, result] of results.entries()) {
    const publisher = publishers[i];
    if (result.status === "rejected") {
      stats.feedResults.push({ publisher: publisher.id, ok: false, error: String(result.reason?.message || result.reason) });
      continue;
    }

    const { articles, skipped } = result.value;
    let inWindow = 0;
    stats.articlesSkipped += skipped;
    for (const article of articles) {
      if (article.publishedAt < cutoff) {
        stats.articlesSkipped += 1;
        continue;
      }
      inWindow += 1;
      stats.articlesFetched += 1;
      stats[`articles${capitalize(await upsertArticle(db, article, now))}`] += 1;
    }
    stats.feedResults.push({ publisher: publisher.id, ok: true, items: articles.length, inWindow, skipped });
  }
}

// Duplicate prevention: the (publisher, normalized URL) pair is unique, and the primary key is derived from it.
// Re-fetching the same article updates the existing row instead of inserting a copy.
export async function upsertArticle(db, a, now = new Date()) {
  const id = articleId(a.publisherId, a.urlNormalized);
  const existing = (await db.query("SELECT content_hash FROM articles WHERE id = $1", [id])).rows[0];

  if (!existing) {
    await db.query(
      `INSERT INTO articles (id, publisher_id, url, url_normalized, guid, title, excerpt, published_at, first_seen_at, last_seen_at, content_hash, is_fixture)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [id, a.publisherId, a.url, a.urlNormalized, a.guid, a.title, a.excerpt, a.publishedAt, now, a.contentHash, Boolean(a.isFixture)]
    );
    return "new";
  }
  if (existing.content_hash !== a.contentHash) {
    await db.query(
      "UPDATE articles SET title = $2, excerpt = $3, url = $4, published_at = $5, content_hash = $6, last_seen_at = $7 WHERE id = $1",
      [id, a.title, a.excerpt, a.url, a.publishedAt, a.contentHash, now]
    );
    return "updated";
  }
  await db.query("UPDATE articles SET last_seen_at = $2 WHERE id = $1", [id, now]);
  return "unchanged";
}

async function assignStories(db, now) {
  const rows = (
    await db.query(
      `SELECT a.id, a.story_id, a.title, a.excerpt, a.published_at, a.publisher_id, a.is_fixture
         FROM articles a WHERE a.published_at >= $1`,
      [retentionCutoff(now)]
    )
  ).rows;

  const toArticle = (r) => ({ id: r.id, storyId: r.story_id, title: r.title, excerpt: r.excerpt, publishedAt: r.published_at, publisherId: r.publisher_id, isFixture: r.is_fixture });
  // Fixture (demo) articles are grouped only with each other, never mixed into live stories.
  let created = 0;
  for (const fixtureFlag of [false, true]) {
    const subset = rows.filter((r) => r.is_fixture === fixtureFlag).map(toArticle);
    const { assignments, newStories } = groupArticles({
      assigned: subset.filter((a) => a.storyId),
      unassigned: subset.filter((a) => !a.storyId),
      newStoryId: () => `st_${randomUUID().replace(/-/g, "").slice(0, 16)}`
    });

    for (const storyId of newStories) {
      const first = subset.find((a) => assignments.get(a.id) === storyId);
      await db.query("INSERT INTO stories (id, headline, created_at, updated_at, is_fixture) VALUES ($1, $2, $3, $3, $4)", [storyId, first.title, now, fixtureFlag]);
      created += 1;
    }
    for (const [articleIdValue, storyId] of assignments) {
      await db.query("UPDATE articles SET story_id = $2 WHERE id = $1", [articleIdValue, storyId]);
      await db.query("UPDATE stories SET updated_at = $2 WHERE id = $1", [storyId, now]);
    }
  }

  // Keep each headline representative of the articles that remain (members change as coverage joins or expires).
  const members = (await db.query("SELECT a.story_id, a.title, a.excerpt, a.published_at FROM articles a WHERE a.story_id IS NOT NULL AND a.published_at >= $1", [retentionCutoff(now)])).rows;
  const byStory = new Map();
  for (const m of members) {
    if (!byStory.has(m.story_id)) byStory.set(m.story_id, []);
    byStory.get(m.story_id).push({ title: m.title, excerpt: m.excerpt, publishedAt: m.published_at });
  }
  const headlines = new Map((await db.query("SELECT id, headline FROM stories")).rows.map((r) => [r.id, r.headline]));
  for (const [storyId, list] of byStory) {
    const headline = chooseHeadline(list);
    if (headline && headline !== headlines.get(storyId)) {
      await db.query("UPDATE stories SET headline = $2, updated_at = $3 WHERE id = $1", [storyId, headline, now]);
    }
  }
  return created;
}

async function activeStoryArticles(db, now) {
  const rows = (
    await db.query(
      `SELECT a.id, a.story_id, a.title, a.excerpt, a.published_at, a.content_hash, p.name AS publisher_name, p.id AS publisher_id
         FROM articles a JOIN publishers p ON p.id = a.publisher_id
        WHERE a.story_id IS NOT NULL AND a.published_at >= $1
        ORDER BY a.published_at ASC`,
      [retentionCutoff(now)]
    )
  ).rows;
  const byStory = new Map();
  for (const r of rows) {
    if (!byStory.has(r.story_id)) byStory.set(r.story_id, []);
    byStory.get(r.story_id).push({ id: r.id, title: r.title, excerpt: r.excerpt, publishedAt: r.published_at, contentHash: r.content_hash, publisherName: r.publisher_name, publisherId: r.publisher_id });
  }
  return byStory;
}

async function updateBackground(db, findBackgroundImpl, now) {
  const due = (
    await db.query(
      `SELECT id, headline, updated_at FROM stories
        WHERE background_checked_at IS NULL OR updated_at > background_checked_at
        ORDER BY updated_at DESC LIMIT 200`
    )
  ).rows;
  if (!due.length) return 0;
  const byStory = await activeStoryArticles(db, now);
  // Stories with more coverage first, so a rate limit or slow run still covers the important ones.
  due.sort((a, b) => (byStory.get(b.id)?.length || 0) - (byStory.get(a.id)?.length || 0));
  let linked = 0;

  for (const story of due.slice(0, 40)) {
    const articles = byStory.get(story.id);
    if (!articles) continue;
    try {
      const resources = await findBackgroundImpl({ id: story.id, headline: story.headline }, articles);
      await db.query("DELETE FROM story_background WHERE story_id = $1", [story.id]);
      for (const r of resources) {
        await db.query(
          `INSERT INTO background_resources (id, url, title, description, provider, fetched_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, fetched_at = EXCLUDED.fetched_at`,
          [r.id, r.url, r.title, r.description, r.provider, now]
        );
        await db.query("INSERT INTO story_background (story_id, resource_id, matched_term) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [story.id, r.id, r.matchedTerm]);
        linked += 1;
      }
      await db.query("UPDATE stories SET background_checked_at = $2 WHERE id = $1", [story.id, now]);
    } catch (error) {
      // Leave existing links in place and retry next run.
      console.warn(`background lookup failed for ${story.id}: ${error.message}`);
      if (error instanceof RateLimitedError) break;
    }
  }
  await db.query("DELETE FROM background_resources r WHERE NOT EXISTS (SELECT 1 FROM story_background sb WHERE sb.resource_id = r.id)");
  return linked;
}

// The summary is keyed to the exact set of article versions it was generated from.
export function summaryInputHash(articles) {
  const parts = articles.map((a) => `${a.id}:${a.contentHash}`).sort();
  return sha256(`${PROMPT_VERSION}|${parts.join(",")}`).slice(0, 32);
}

async function updateSummaries(db, generateSummaryImpl, now, stats) {
  const byStory = await activeStoryArticles(db, now);
  const existing = new Map((await db.query("SELECT story_id, input_hash FROM summaries")).rows.map((r) => [r.story_id, r.input_hash]));

  const due = [];
  for (const [storyId, articles] of byStory) {
    const hash = summaryInputHash(articles);
    if (existing.get(storyId) !== hash) {
      due.push({ storyId, articles, hash, publishers: new Set(articles.map((a) => a.publisherId)).size, latest: articles[articles.length - 1].publishedAt });
    }
  }
  // Multi-publisher and newest stories first, so the cap spends AI calls where they matter most.
  due.sort((a, b) => b.publishers - a.publishers || new Date(b.latest) - new Date(a.latest));

  let configError = null;
  const generateOne = async (item) => {
    await db.query("INSERT INTO summaries (story_id) VALUES ($1) ON CONFLICT (story_id) DO NOTHING", [item.storyId]);
    try {
      if (configError) throw configError;
      const s = await generateSummaryImpl(item.articles);
      await db.query(
        `UPDATE summaries SET version = version + 1, input_hash = $2, article_ids = $3, overview = $4, agreement = $5,
           disagreement = $6, uncertainty = $7, overview_refs = $8, perspectives_status = $9, perspectives = $10,
           input_scope = $11, model = $12, prompt_version = $13, generated_at = $14, last_attempt_at = $14,
           last_error = NULL, invalidated_reason = NULL
         WHERE story_id = $1`,
        [item.storyId, item.hash, JSON.stringify(item.articles.map((a) => a.id)), s.overview, s.agreement, s.disagreement,
          s.uncertainty, JSON.stringify(s.overview_refs), s.perspectives_status, JSON.stringify(s.perspectives),
          s.input_scope, s.model, s.prompt_version, now]
      );
      stats.summariesGenerated += 1;
    } catch (error) {
      // Keep whatever valid content exists; record an honest error status.
      // A missing/rejected key or a rate limit will fail every remaining call too, so stop for this run.
      if (error instanceof SummaryError && /not configured|rejected the request \(40[13]\)|rate limit/.test(error.message)) configError = error;
      await db.query("UPDATE summaries SET last_attempt_at = $2, last_error = $3 WHERE story_id = $1", [item.storyId, now, String(error.message).slice(0, 500)]);
      stats.summariesFailed += 1;
    }
  };

  const queue = due.slice(0, env.maxSummariesPerRun);
  const workers = Array.from({ length: Math.min(AI_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      await generateOne(queue.shift());
      if (queue.length && !configError) {
        await new Promise((resolve) => setTimeout(resolve, env.aiRequestGapMs));
      }
    }
  });
  await Promise.all(workers);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
