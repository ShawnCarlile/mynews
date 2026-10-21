// Read-only JSON API for the Flutter client, plus one protected admin trigger.
// Reads never fetch news or call the AI model; they only return stored results.
import { timingSafeEqual } from "node:crypto";
import express from "express";
import { env, RETENTION_HOURS } from "./config.js";
import { retentionCutoff } from "./ingest/normalize.js";
import { MODEL_CONFIG, PROMPT_VERSION } from "./ai/prompts.js";
import { runCollection } from "./pipeline.js";

// "Top stories": newest first, where each additional publisher counts as 6 hours newer,
// so widely covered events stay near the top for a while without burying breaking news.
const TOP_STORIES_ORDERING = "newest first, boosted 6 hours per additional publisher";
const INPUT_SCOPE_NOTE = "Generated from RSS feed excerpts only, not full articles. Open the original coverage for full context.";

export function createApp(db, { now = () => new Date(), collect = runCollection } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Access-Control-Allow-Origin", "*"); // allows an optional Flutter web build
    next();
  });

  const includeFixtures = process.env.INCLUDE_FIXTURES === "true";

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  app.get("/stories", async (req, res, next) => {
    try {
      const cutoff = retentionCutoff(now());
      const rows = (
        await db.query(
          `SELECT s.id, s.headline, s.updated_at, s.is_fixture,
                  MAX(a.published_at) AS latest_article_at,
                  COUNT(*)::int AS article_count,
                  COUNT(DISTINCT a.publisher_id)::int AS publisher_count,
                  jsonb_agg(DISTINCT p.name) AS publisher_names,
                  jsonb_agg(a.id) AS active_ids,
                  sm.article_ids AS summary_article_ids, sm.overview IS NOT NULL AS has_summary,
                  sm.last_error, sm.invalidated_reason
             FROM stories s
             JOIN articles a ON a.story_id = s.id AND a.published_at >= $1
             JOIN publishers p ON p.id = a.publisher_id
             LEFT JOIN summaries sm ON sm.story_id = s.id
            WHERE ($2::boolean OR s.is_fixture = false)
            GROUP BY s.id, sm.story_id
            ORDER BY MAX(a.published_at) + (COUNT(DISTINCT a.publisher_id) - 1) * interval '6 hours' DESC, latest_article_at DESC
            LIMIT 200`,
          [cutoff, includeFixtures]
        )
      ).rows;

      res.json({
        generated_at: now().toISOString(),
        ordering: TOP_STORIES_ORDERING,
        retention_hours: RETENTION_HOURS,
        collection: await collectionInfo(db),
        stories: rows.map((r) => ({
          id: r.id,
          headline: r.headline,
          latest_article_at: iso(r.latest_article_at),
          updated_at: iso(r.updated_at),
          article_count: r.article_count,
          publisher_count: r.publisher_count,
          publishers: [...r.publisher_names].sort(),
          summary_status: summaryStatus(r.has_summary, r.summary_article_ids, r.active_ids, r.last_error, r.invalidated_reason).status,
          is_fixture: r.is_fixture
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/stories/:id", async (req, res, next) => {
    try {
      const cutoff = retentionCutoff(now());
      const story = (await db.query("SELECT id, headline, created_at, updated_at, is_fixture FROM stories WHERE id = $1", [req.params.id])).rows[0];
      const articles = story
        ? (
            await db.query(
              `SELECT a.id, a.title, a.url, a.excerpt, a.published_at, p.id AS publisher_id, p.name AS publisher_name
                 FROM articles a JOIN publishers p ON p.id = a.publisher_id
                WHERE a.story_id = $1 AND a.published_at >= $2
                ORDER BY a.published_at DESC`,
              [story.id, cutoff]
            )
          ).rows
        : [];

      if (!story || articles.length === 0 || (story.is_fixture && !includeFixtures)) {
        return res.status(404).json({ error: "not_found", message: "This story is no longer available. It may have expired from the seven-day window." });
      }

      const background = (
        await db.query(
          `SELECT r.title, r.url, r.description, r.provider, sb.matched_term
             FROM story_background sb JOIN background_resources r ON r.id = sb.resource_id
            WHERE sb.story_id = $1 ORDER BY r.title`,
          [story.id]
        )
      ).rows;
      const summaryRow = (await db.query("SELECT * FROM summaries WHERE story_id = $1", [story.id])).rows[0];

      const publishers = new Map();
      for (const a of articles) {
        if (!publishers.has(a.publisher_id)) publishers.set(a.publisher_id, { id: a.publisher_id, name: a.publisher_name, articles: [] });
        publishers.get(a.publisher_id).articles.push(a.id);
      }

      res.json({
        id: story.id,
        headline: story.headline,
        created_at: iso(story.created_at),
        updated_at: iso(story.updated_at),
        latest_article_at: iso(articles[0].published_at),
        is_fixture: story.is_fixture,
        publisher_count: publishers.size,
        publishers: [...publishers.values()].sort((a, b) => a.name.localeCompare(b.name)),
        articles: articles.map((a) => ({
          id: a.id,
          publisher_id: a.publisher_id,
          publisher_name: a.publisher_name,
          title: a.title,
          url: a.url,
          published_at: iso(a.published_at),
          excerpt: a.excerpt,
          excerpt_note: "Feed excerpt as published by the source"
        })),
        background: background.map((b) => ({ title: b.title, url: b.url, description: b.description, provider: b.provider, matched_term: b.matched_term })),
        summary: formatSummary(summaryRow, articles.map((a) => a.id)),
        collection: await collectionInfo(db)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/status", async (req, res, next) => {
    try {
      const runs = (await db.query("SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 48")).rows;
      const totals = (
        await db.query(
          `SELECT (SELECT COUNT(*)::int FROM articles WHERE published_at >= $1) AS active_articles,
                  (SELECT COUNT(*)::int FROM stories) AS stories,
                  (SELECT COUNT(*)::int FROM summaries WHERE overview IS NOT NULL) AS stored_summaries,
                  (SELECT COALESCE(SUM(version), 0)::int FROM summaries) AS total_generations`,
          [retentionCutoff(now())]
        )
      ).rows[0];
      res.json({
        now: now().toISOString(),
        retention_hours: RETENTION_HOURS,
        schedule: "hourly (external scheduler calls POST /admin/collect; see README)",
        ai: { provider: "Google Gemini", configured: Boolean(process.env.GEMINI_API_KEY), model: MODEL_CONFIG.model, prompt_version: PROMPT_VERSION },
        totals,
        collection: await collectionInfo(db),
        runs: runs.map(formatRun)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/collect", async (req, res, next) => {
    try {
      if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
      const trigger = req.query.trigger === "schedule" ? "schedule" : "admin";
      if (req.query.wait === "1") {
        return res.json(await collect(db, { trigger }));
      }
      collect(db, { trigger }).catch((error) => console.error("background collection failed", error));
      res.status(202).json({ accepted: true, trigger, message: "Collection started; see GET /status for the result." });
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((error, req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "server_error", message: "The server could not complete this request. Please try again." });
  });

  return app;
}

function authorized(req) {
  if (!env.adminToken) return false;
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(env.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function collectionInfo(db) {
  const lastRun = (await db.query("SELECT * FROM collection_runs WHERE outcome <> 'running' ORDER BY started_at DESC LIMIT 1")).rows[0];
  const lastSuccess = (await db.query("SELECT finished_at FROM collection_runs WHERE outcome IN ('success', 'partial') ORDER BY started_at DESC LIMIT 1")).rows[0];
  return {
    last_successful_at: iso(lastSuccess?.finished_at),
    last_run: lastRun ? formatRun(lastRun) : null
  };
}

function formatRun(r) {
  return {
    id: r.id,
    trigger: r.trigger,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    outcome: r.outcome,
    feeds: r.feed_results,
    articles: { fetched: r.articles_fetched, new: r.articles_new, updated: r.articles_updated, unchanged: r.articles_unchanged, skipped: r.articles_skipped, expired: r.articles_expired },
    stories: { created: r.stories_created, removed: r.stories_removed },
    summaries: { generated: r.summaries_generated, failed: r.summaries_failed },
    background_links: r.background_links,
    error: r.error
  };
}

// Decides what the reader may see. A summary that used an article that is no longer active is withheld.
export function summaryStatus(hasContent, summaryArticleIds, activeIds, lastError, invalidatedReason) {
  const used = new Set(summaryArticleIds || []);
  const active = new Set(activeIds || []);
  if (!hasContent) {
    if (lastError) return { status: "failed", message: "AI summary unavailable. The last generation attempt failed; original coverage is still available." };
    if (invalidatedReason) return { status: "outdated", message: "The previous AI summary used coverage that has expired. A new summary will be generated on the next hourly run." };
    return { status: "pending", message: "AI summary not generated yet. It will be created on the next hourly run." };
  }
  const removed = [...used].filter((id) => !active.has(id));
  if (removed.length) {
    return { status: "outdated", withhold: true, message: "The previous AI summary used coverage that has expired. A new summary will be generated on the next hourly run." };
  }
  const added = [...active].filter((id) => !used.has(id));
  if (added.length) {
    const failedNote = lastError ? " The latest regeneration attempt failed." : "";
    return { status: "stale", message: `This AI summary does not yet include ${added.length} newer article${added.length === 1 ? "" : "s"}.${failedNote}` };
  }
  return { status: "current", message: null };
}

function formatSummary(row, activeIds) {
  const verdict = summaryStatus(Boolean(row?.overview), row?.article_ids, activeIds, row?.last_error, row?.invalidated_reason);
  const base = {
    status: verdict.status,
    message: verdict.message,
    label: "AI-generated",
    last_attempt_at: iso(row?.last_attempt_at),
    last_error: row?.last_error ?? null
  };
  if (!row?.overview || verdict.withhold) return base;
  return {
    ...base,
    version: row.version,
    generated_at: iso(row.generated_at),
    model: row.model,
    prompt_version: row.prompt_version,
    input_scope: row.input_scope,
    input_scope_note: INPUT_SCOPE_NOTE,
    input_article_ids: row.article_ids,
    overview: row.overview,
    agreement: row.agreement,
    disagreement: row.disagreement,
    uncertainty: row.uncertainty,
    overview_article_ids: row.overview_refs,
    perspectives_status: row.perspectives_status,
    perspectives_message: row.perspectives_status === "insufficient_evidence" ? "Insufficient evidence for distinct perspectives" : null,
    perspectives: row.perspectives
  };
}

function iso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}
