// Story grouping: decides whether a newly collected article reports the same event as an existing story.
//
// Method (deterministic, no AI):
//   1. Each article becomes a TF-IDF vector over its title (weighted x2) and feed excerpt.
//   2. Named entities are extracted as runs of capitalized words ("Benjamin Netanyahu", "Gaza", "NATO").
//      Two entities match when one's words contain the other's ("Trump" ~ "Donald Trump").
//   3. An article joins a story when, against at least one member article published within 72 hours:
//        cosine >= STRONG_COSINE and >= 1 shared entity, or
//        cosine >= WEAK_COSINE   and >= 2 shared entities.
//      A single shared keyword or person is never enough by itself.
//   4. Otherwise it starts a new (possibly single-source) story. Existing assignments are never
//      reshuffled, so story IDs stay stable while new coverage joins.

export const STRONG_COSINE = 0.36;
export const WEAK_COSINE = 0.25;
export const MIN_SHARED_ENTITIES_WEAK = 2;
export const MAX_GAP_HOURS = 72;

const STOP = new Set(`a about above after again against ago all also am amid among an and any are around as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just last latest live more most my new news no nor not now of off on once only or other our out over own said same say says she should so some such than that the their them then there these they this those through to too under until up update updates very video was watch we were what when where which while who whom why will with would year years you your week weeks day days today yesterday tomorrow monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december first one two three four five according told report reports reported people get gets got make made back like could after per via mr mrs ms dr`.split(/\s+/));

// Words that are capitalized for reasons other than naming the event (sentence starts, outlets, titles).
const NON_ENTITY = new Set(`a an the this that these those in on at for from to of by with as after before amid during over under why how what when where who which it its he she they we i you his her their our is are was were be will can could would should may might must not no yes but and or if so new live watch breaking exclusive opinion analysis update updates video photos report fox news npr bbc cbs guardian al jazeera president prime minister former senator governor rep sen mr mrs ms dr secretary chief officials official police state states says said monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december`.split(/\s+/));

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

const cleanWord = (w) => w.replace(/^['\-.]+|['\-.]+$/g, "").replace(/'s$/i, "");
const isCapitalized = (w) => /^[A-Z][a-zA-Z0-9'\-&.]*$/.test(w);
const isAcronym = (w) => /^[A-Z]{2,6}$/.test(w);

export function extractEntities(text) {
  const normalized = String(text).replace(/[‘’]/g, "'");
  // Sentence and quotation starts are capitalized for grammatical reasons, so a lone capitalized
  // word there ("Deeply appalled", "Satellite photos show") is only a name if it is also seen mid-sentence.
  const segments = normalized
    .split(/(?<=[.!?:;])\s+|[“”"|]|\s[–—-]\s|(?:^|\s)'|'(?:\s|$)/)
    .map((seg) => (seg || "").split(/[^A-Za-z0-9'\-.&]+/).map(cleanWord).filter(Boolean));

  const midSentence = new Set();
  const capitalizedCount = new Map();
  const lowercase = new Set();
  for (const words of segments) {
    words.forEach((w, i) => {
      const key = w.toLowerCase();
      if (isCapitalized(w)) {
        capitalizedCount.set(key, (capitalizedCount.get(key) || 0) + 1);
        if (i > 0) midSentence.add(key);
      } else {
        lowercase.add(key);
      }
    });
  }
  // A sentence-initial word counts as a name if it is also capitalized mid-sentence,
  // or is capitalized repeatedly and never written in lowercase ("Saginaw ... Saginaw council").
  const looksLikeName = (w) => {
    const key = w.toLowerCase();
    return isAcronym(w) || midSentence.has(key) || ((capitalizedCount.get(key) || 0) >= 2 && !lowercase.has(key));
  };

  const entities = new Set();
  for (const words of segments) {
    let run = [];
    let runStart = 0;
    const flush = () => {
      if (run.length === 1 && runStart === 0 && !looksLikeName(run[0])) run = [];
      // Trim leading/trailing words that are not names.
      while (run.length && NON_ENTITY.has(run[0].toLowerCase())) run.shift();
      while (run.length && NON_ENTITY.has(run[run.length - 1].toLowerCase())) run.pop();
      if (run.length) {
        const phrase = run.join(" ").toLowerCase();
        if (phrase.length >= 2 && !/^\d+$/.test(phrase)) entities.add(phrase);
      }
      run = [];
    };
    words.forEach((word, i) => {
      const isConnector = run.length > 0 && /^(of|de|al|bin|van|von|la|del)$/i.test(word);
      if (isCapitalized(word) || isConnector) {
        if (!run.length) runStart = i;
        run.push(word);
      } else {
        flush();
      }
    });
    flush();
  }
  return collapseNested([...entities].filter((e) => e.split(" ").every((w) => w.length > 1 || /[a-z]/.test(w))));
}

// "netanyahu" inside "benjamin netanyahu" is the same entity; keep only the longer phrase
// so one person or place is never counted twice.
function collapseNested(list) {
  return list.filter((e) => !list.some((other) => other !== e && other.length > e.length && entitiesMatch(e, other)));
}

// US outlets often write headlines in Title Case, where capitalization says nothing about names.
export function isTitleCase(title) {
  const words = String(title).split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
  return words.length >= 3 && words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.8;
}

export function articleEntities(article) {
  const excerpt = article.excerpt || "";
  return extractEntities(isTitleCase(article.title) && excerpt ? excerpt : `${article.title}. ${excerpt}`);
}

export function entitiesMatch(a, b) {
  if (a === b) return true;
  const wa = a.split(" ");
  const wb = b.split(" ");
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  // Require the shorter entity to be a meaningful name (not e.g. "us" inside "us army" only by accident)
  if (short.join(" ").length < 3) return false;
  return short.every((w) => long.includes(w));
}

export function sharedEntityCount(entsA, entsB) {
  let count = 0;
  for (const a of entsA) {
    if (entsB.some((b) => entitiesMatch(a, b))) count += 1;
  }
  return count;
}

export function articleFeatures(article) {
  return {
    tokens: [...tokenize(article.title), ...tokenize(article.title), ...tokenize(article.excerpt || "")],
    entities: articleEntities(article)
  };
}

export class Corpus {
  constructor(featureList) {
    this.docCount = featureList.length;
    this.df = new Map();
    for (const f of featureList) {
      for (const t of new Set(f.tokens)) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
  }

  idf(term) {
    return Math.log((1 + this.docCount) / (1 + (this.df.get(term) || 0))) + 1;
  }

  vector(tokens) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let norm = 0;
    for (const [t, n] of tf) {
      const w = (1 + Math.log(n)) * this.idf(t);
      vec.set(t, w);
      norm += w * w;
    }
    return { vec, norm: Math.sqrt(norm) };
  }
}

export function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  const [small, large] = a.vec.size <= b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
  let dot = 0;
  for (const [t, w] of small) {
    const other = large.get(t);
    if (other) dot += w * other;
  }
  return dot / (a.norm * b.norm);
}

export function compare(prepA, prepB) {
  const gapHours = Math.abs(new Date(prepA.publishedAt) - new Date(prepB.publishedAt)) / 3600_000;
  const score = cosine(prepA.vector, prepB.vector);
  const shared = sharedEntityCount(prepA.entities, prepB.entities);
  const sameEvent =
    gapHours <= MAX_GAP_HOURS &&
    ((score >= STRONG_COSINE && shared >= 1) || (score >= WEAK_COSINE && shared >= MIN_SHARED_ENTITIES_WEAK));
  return { score, shared, gapHours, sameEvent };
}

function prepare(article, corpus) {
  const f = articleFeatures(article);
  return { ...article, entities: f.entities, vector: corpus.vector(f.tokens) };
}

// Assign unassigned articles to stories.
//   assigned:   [{id, storyId, title, excerpt, publishedAt, publisherId}] already in stories
//   unassigned: [{id, title, excerpt, publishedAt, publisherId}]
//   newStoryId: () => string
// Returns { assignments: Map(articleId -> storyId), newStories: Set(storyId), touchedStories: Set(storyId) }
export function groupArticles({ assigned, unassigned, newStoryId }) {
  const all = [...assigned, ...unassigned];
  const corpus = new Corpus(all.map(articleFeatures));
  const members = new Map(); // storyId -> prepared articles

  for (const article of assigned) {
    if (!members.has(article.storyId)) members.set(article.storyId, []);
    members.get(article.storyId).push(prepare(article, corpus));
  }

  const assignments = new Map();
  const newStories = new Set();
  const touchedStories = new Set();
  const ordered = [...unassigned].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

  for (const article of ordered) {
    const prep = prepare(article, corpus);
    let best = null;

    for (const [storyId, list] of members) {
      for (const member of list) {
        const result = compare(prep, member);
        if (result.sameEvent && (!best || rank(result) > rank(best.result))) {
          best = { storyId, result };
        }
      }
    }

    const storyId = best ? best.storyId : newStoryId();
    if (!best) {
      newStories.add(storyId);
      members.set(storyId, []);
    }
    members.get(storyId).push(prep);
    assignments.set(article.id, storyId);
    touchedStories.add(storyId);
  }

  return { assignments, newStories, touchedStories };
}

function rank(result) {
  return result.score + 0.05 * result.shared;
}

// Most representative title: the member with the highest average similarity to the others.
export function chooseHeadline(articles) {
  if (articles.length === 0) return "";
  if (articles.length <= 2) {
    return [...articles].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))[0].title;
  }
  const corpus = new Corpus(articles.map(articleFeatures));
  const preps = articles.map((a) => prepare(a, corpus));
  let best = preps[0];
  let bestScore = -1;
  for (const p of preps) {
    const avg = preps.reduce((sum, q) => (q === p ? sum : sum + cosine(p.vector, q.vector)), 0) / (preps.length - 1);
    if (avg > bestScore) {
      bestScore = avg;
      best = p;
    }
  }
  return best.title;
}
