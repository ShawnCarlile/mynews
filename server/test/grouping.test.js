import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractEntities, groupArticles, isTitleCase, sharedEntityCount } from "../src/grouping.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/grouping-cases.json", import.meta.url)));
const now = Date.now();
const articles = fixture.articles.map((a) => ({ ...a, publishedAt: new Date(now - a.hoursAgo * 3600_000) }));

function group(list) {
  let n = 0;
  const { assignments } = groupArticles({ assigned: [], unassigned: list, newStoryId: () => `s${n++}` });
  return assignments;
}

test("fixture: five same-event groups each end up in one story", () => {
  const assignments = group(articles);
  for (const ids of fixture.expected_groups) {
    const stories = new Set(ids.map((id) => assignments.get(id)));
    assert.equal(stories.size, 1, `expected ${ids.join(",")} in one story`);
  }
  // and the groups are distinct from each other
  const groupStories = fixture.expected_groups.map((ids) => assignments.get(ids[0]));
  assert.equal(new Set(groupStories).size, fixture.expected_groups.length);
});

test("fixture: related topics that are different events stay separate", () => {
  const assignments = group(articles);
  for (const { ids, reason } of fixture.expected_separate) {
    assert.notEqual(assignments.get(ids[0]), assignments.get(ids[1]), reason);
  }
});

test("new coverage joins an existing story instead of creating a duplicate", () => {
  const first = articles.filter((a) => a.id === "g1a" || a.id === "g1b");
  const assignments = group(first);
  const storyId = assignments.get("g1a");
  const assigned = first.map((a) => ({ ...a, storyId: assignments.get(a.id) }));
  const late = articles.find((a) => a.id === "g1c");
  const result = groupArticles({ assigned, unassigned: [late], newStoryId: () => "should-not-be-used" });
  assert.equal(result.assignments.get("g1c"), storyId);
  assert.equal(result.newStories.size, 0);
});

test("a single shared name is not enough to merge", () => {
  const a = extractEntities("Governor Maria Lopez signs state budget");
  const b = extractEntities("Governor Maria Lopez hospitalized after crash");
  assert.equal(sharedEntityCount(a, b), 1);
});

test("entity extraction ignores sentence-initial words and title case", () => {
  assert.deepEqual(extractEntities("Satellite photos show a boat near Kim Jong Un's residence"), ["kim jong un"]);
  assert.ok(isTitleCase("Extended Interview: Actor Sacha Baron Cohen Talks New Film"));
  assert.ok(!isTitleCase("Alberta heads to polls to decide whether to hold vote"));
});
