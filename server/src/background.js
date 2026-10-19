// Background resources: Wikipedia articles about the story's central named entities.
//
// Method:
//   1. Candidate terms = named entities shared by 2+ articles in the story (or, for single-source
//      stories, entities in the headline), ranked by how many articles mention them. Multi-word
//      names rank above single words.
//   2. For each candidate (max 4 tried), call Wikipedia search and take the top hit.
//   3. Accept the hit only if its title closely matches the term (every word of the term appears in
//      the page title or the page title appears in the term) and the page is not a disambiguation page.
//   4. Keep at most 2 resources. If none pass, the story gets none and the app shows
//      "No background resource available" rather than a loosely related link.
import { USER_AGENT } from "./config.js";
import { articleEntities, entitiesMatch, extractEntities } from "./grouping.js";
import { sha256 } from "./ingest/normalize.js";

const MAX_TRIES = 4;
const MAX_RESOURCES = 2;
// Too generic to be useful context for a specific event.
const TOO_GENERIC = new Set(["us", "u.s", "uk", "un", "eu", "america", "american", "europe", "world", "government", "congress", "white house", "trump", "president"]);

export function candidateTerms(story, articles) {
  const counts = new Map();
  for (const article of articles) {
    const seen = new Set();
    for (const entity of articleEntities(article)) {
      const key = [...counts.keys()].find((k) => entitiesMatch(k, entity)) || entity;
      if (seen.has(key)) continue;
      seen.add(key);
      // Prefer the longer spelling as the canonical form.
      const prev = counts.get(key) || 0;
      if (entity.length > key.length) {
        counts.delete(key);
        counts.set(entity, prev + 1);
      } else {
        counts.set(key, prev + 1);
      }
    }
  }

  const headlineEntities = extractEntities(story.headline);
  const minMentions = articles.length >= 2 ? 2 : 1;
  return [...counts.entries()]
    .filter(([term, n]) => n >= minMentions || headlineEntities.some((h) => entitiesMatch(h, term)))
    .filter(([term]) => !TOO_GENERIC.has(term) && term.length >= 3)
    .sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length)
    .map(([term]) => term)
    .slice(0, MAX_TRIES);
}

export function titleMatchesTerm(pageTitle, term) {
  const title = pageTitle.toLowerCase().replace(/\s*\(.*\)\s*/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const t = term.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || !t) return false;
  const titleWords = title.split(" ");
  const termWords = t.split(" ");
  return termWords.every((w) => titleWords.includes(w)) || (titleWords.length >= 2 && titleWords.every((w) => termWords.includes(w)));
}

const REQUEST_GAP_MS = 400; // stay well under Wikipedia's anonymous rate limits

export class RateLimitedError extends Error {}

async function wikiJson(url, fetchImpl) {
  await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (response.status === 429) throw new RateLimitedError("Wikipedia rate limit");
  if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
  return response.json();
}

// One request per term: top search hit plus its description, canonical URL, and disambiguation flag.
export async function lookupTerm(term, fetchImpl = fetch) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
    "&generator=search&gsrlimit=1&prop=info|description|pageprops&inprop=url&ppprop=disambiguation" +
    `&gsrsearch=${encodeURIComponent(term)}`;
  const data = await wikiJson(url, fetchImpl);
  const page = data?.query?.pages?.[0];
  if (!page || page.missing) return null;
  return {
    title: page.title,
    url: page.canonicalurl || page.fullurl,
    description: page.description || null,
    disambiguation: Boolean(page.pageprops && "disambiguation" in page.pageprops)
  };
}

export async function findBackground(story, articles, { fetchImpl = fetch } = {}) {
  const resources = [];
  for (const term of candidateTerms(story, articles)) {
    if (resources.length >= MAX_RESOURCES) break;
    const page = await lookupTerm(term, fetchImpl);
    if (!page || page.disambiguation || !page.url || !titleMatchesTerm(page.title, term)) continue;
    if (resources.some((r) => r.url === page.url)) continue;
    resources.push({
      id: sha256(page.url).slice(0, 32),
      url: page.url,
      title: `Wikipedia: ${page.title}`,
      description: page.description,
      provider: "wikipedia",
      matchedTerm: term
    });
  }
  return resources;
}
