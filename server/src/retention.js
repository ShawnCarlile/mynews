import { retentionCutoff } from "./ingest/normalize.js";

// Removes everything that depends on articles older than the 168-hour window.
// Order matters: invalidate summaries before deleting articles so we know which ones depended on them.
export async function cleanup(db, now = new Date()) {
  const cutoff = retentionCutoff(now);

  const expired = (await db.query("SELECT id FROM articles WHERE published_at < $1", [cutoff])).rows.map((r) => r.id);

  let summariesInvalidated = 0;
  if (expired.length) {
    // A summary that used any removed article must not be served. Clear its content (so expired
    // material is not retained in the summary either); the pipeline rebuilds it from retained articles.
    const result = await db.query(
      `UPDATE summaries
         SET overview = NULL, agreement = NULL, disagreement = NULL, uncertainty = NULL,
             overview_refs = '[]', perspectives = '[]', perspectives_status = NULL,
             input_hash = NULL, invalidated_reason = 'supporting article expired'
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(article_ids) AS used(id) WHERE used.id = ANY($1::text[])
       )`,
      [expired]
    );
    summariesInvalidated = result.affectedRows ?? result.rowCount ?? 0;
    await db.query("DELETE FROM articles WHERE id = ANY($1::text[])", [expired]);
  }

  // Stories with no remaining articles go away; summaries and background links cascade.
  const removedStories = await db.query(
    "DELETE FROM stories s WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id) RETURNING id"
  );

  // Background resources are kept only while linked to an active story.
  await db.query("DELETE FROM background_resources r WHERE NOT EXISTS (SELECT 1 FROM story_background sb WHERE sb.resource_id = r.id)");

  return { articlesExpired: expired.length, storiesRemoved: removedStories.rows.length, summariesInvalidated };
}
