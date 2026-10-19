-- My News schema. All timestamps are timestamptz and written in UTC.

CREATE TABLE IF NOT EXISTS publishers (
  id          text PRIMARY KEY,           -- short code, e.g. 'bbc'
  name        text NOT NULL,              -- display label, e.g. 'BBC News'
  feed_url    text NOT NULL,
  is_fixture  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS stories (
  id                    text PRIMARY KEY,           -- stable, never reused
  headline              text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(), -- last membership/headline change
  background_checked_at timestamptz,
  is_fixture            boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS articles (
  id              text PRIMARY KEY,                 -- sha256(publisher | normalized url)
  publisher_id    text NOT NULL REFERENCES publishers(id),
  url             text NOT NULL,                    -- original link as published
  url_normalized  text NOT NULL,
  guid            text,
  title           text NOT NULL,
  excerpt         text NOT NULL DEFAULT '',         -- feed description/summary only, never full text
  published_at    timestamptz NOT NULL,             -- from the feed; articles without a valid date are not stored
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  content_hash    text NOT NULL,                    -- sha256(title | excerpt); changes trigger summary rebuild
  story_id        text REFERENCES stories(id) ON DELETE SET NULL,
  is_fixture      boolean NOT NULL DEFAULT false,
  UNIQUE (publisher_id, url_normalized)
);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at);
CREATE INDEX IF NOT EXISTS articles_story_idx ON articles (story_id);

CREATE TABLE IF NOT EXISTS background_resources (
  id           text PRIMARY KEY,         -- sha256(url)
  url          text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text,
  provider     text NOT NULL,            -- 'wikipedia'
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_background (
  story_id      text NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  resource_id   text NOT NULL REFERENCES background_resources(id) ON DELETE CASCADE,
  matched_term  text NOT NULL,
  PRIMARY KEY (story_id, resource_id)
);

-- One current summary per story. Content columns are NULL until a generation succeeds,
-- and are cleared when any supporting article is removed.
CREATE TABLE IF NOT EXISTS summaries (
  story_id            text PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  version             integer NOT NULL DEFAULT 0,   -- increments on every successful generation
  input_hash          text,                          -- hash of the article set the content was built from
  article_ids         jsonb NOT NULL DEFAULT '[]',   -- articles that were sent to the model
  overview            text,
  agreement           text,
  disagreement        text,
  uncertainty         text,
  overview_refs       jsonb NOT NULL DEFAULT '[]',   -- article ids supporting the overview
  perspectives_status text,                          -- 'supported' | 'insufficient_evidence'
  perspectives        jsonb NOT NULL DEFAULT '[]',   -- [{label, summary, evidence_limits, article_ids}]
  input_scope         text,                          -- 'feed_excerpts'
  model               text,
  prompt_version      text,
  generated_at        timestamptz,
  last_attempt_at     timestamptz,
  last_error          text,
  invalidated_reason  text
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id                   serial PRIMARY KEY,
  trigger              text NOT NULL,          -- 'schedule' | 'admin' | 'cli'
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  outcome              text NOT NULL DEFAULT 'running', -- running | success | partial | failed
  feed_results         jsonb NOT NULL DEFAULT '[]',
  articles_fetched     integer NOT NULL DEFAULT 0,
  articles_new         integer NOT NULL DEFAULT 0,
  articles_updated     integer NOT NULL DEFAULT 0,
  articles_unchanged   integer NOT NULL DEFAULT 0,
  articles_skipped     integer NOT NULL DEFAULT 0,  -- missing/invalid/out-of-window dates
  articles_expired     integer NOT NULL DEFAULT 0,
  stories_created      integer NOT NULL DEFAULT 0,
  stories_removed      integer NOT NULL DEFAULT 0,
  summaries_generated  integer NOT NULL DEFAULT 0,
  summaries_failed     integer NOT NULL DEFAULT 0,
  background_links     integer NOT NULL DEFAULT 0,
  error                text
);
CREATE INDEX IF NOT EXISTS collection_runs_started_idx ON collection_runs (started_at DESC);
