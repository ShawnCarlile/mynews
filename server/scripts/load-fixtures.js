// Loads the clearly labeled fixture dataset (fictional articles from "Fixture Source A/B/C") for
// demonstrating difficult grouping cases. Fixture stories are only shown by the API when INCLUDE_FIXTURES=true,
// are flagged is_fixture in every response, and are never grouped with live news.
// Usage: npm run load-fixtures            (load, then group on the next collection run)
//        npm run load-fixtures -- --remove (delete all fixture data)
import { readFile } from "node:fs/promises";
import { closeDb, openDb } from "../src/db.js";
import { contentHash, normalizeUrl } from "../src/ingest/normalize.js";
import { upsertArticle, runCollection } from "../src/pipeline.js";

const db = await openDb();

if (process.argv.includes("--remove")) {
  await db.query("DELETE FROM articles WHERE is_fixture = true");
  await db.query("DELETE FROM stories WHERE is_fixture = true");
  await db.query("DELETE FROM publishers WHERE is_fixture = true");
  console.log("fixture data removed");
} else {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/grouping-cases.json", import.meta.url), "utf8"));
  for (const p of fixture.publishers) {
    await db.query(
      "INSERT INTO publishers (id, name, feed_url, is_fixture) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO NOTHING",
      [p.id, p.name, p.feedUrl]
    );
  }
  const now = new Date();
  for (const a of fixture.articles) {
    const url = `https://example.com/fixture/${a.id}`;
    await upsertArticle(
      db,
      {
        publisherId: a.publisherId,
        url,
        urlNormalized: normalizeUrl(url),
        guid: a.id,
        title: a.title,
        excerpt: a.excerpt,
        publishedAt: new Date(now.getTime() - a.hoursAgo * 3600_000),
        contentHash: contentHash(a.title, a.excerpt),
        isFixture: true
      },
      now
    );
  }
  console.log(`loaded ${fixture.articles.length} fixture articles; grouping them now (no feed fetch)`);
  const result = await runCollection(db, { trigger: "cli", skipFetch: true });
  console.log(`run ${result.runId}: ${result.outcome}, stories created ${result.storiesCreated}`);
}

await closeDb();
