import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { MODEL_CONFIG, PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

// The shape we ask Gemini to return. The same schema is sent to the model
// and then used to check the answer before we store it.
const PerspectiveSchema = z.object({
  label: z.string(),
  summary: z.string(),
  evidence_limits: z.string(),
  supporting_article_refs: z.array(z.string())
});

const BriefingSchema = z.object({
  overview: z.string(),
  agreement: z.string(),
  disagreement: z.string(),
  uncertainty: z.string(),
  overview_refs: z.array(z.string()),
  perspectives_status: z.enum(["supported", "insufficient_evidence"]),
  perspectives: z.array(PerspectiveSchema)
});

const BRIEFING_JSON_SCHEMA = z.toJSONSchema(BriefingSchema);

export class SummaryError extends Error {}

let client = null;

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new SummaryError("AI service not configured (GEMINI_API_KEY missing on server)");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// articles: [{id, publisherName, title, excerpt, publishedAt}]
// Returns a summary record ready to store. Throws SummaryError on any failure;
// the caller records the error and never substitutes fallback text.
export async function generateSummary(articles, options = {}) {
  // Give each article a short reference (A1, A2, ...) the model can cite.
  const refToId = new Map();
  const input = articles.map((a, i) => {
    const ref = `A${i + 1}`;
    refToId.set(ref, a.id);
    return { ...a, ref };
  });

  let ai = options.ai;
  if (!ai) {
    ai = getClient();
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL_CONFIG.model,
      contents: buildUserPrompt(input),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: MODEL_CONFIG.temperature,
        maxOutputTokens: MODEL_CONFIG.maxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: BRIEFING_JSON_SCHEMA
      }
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        throw new SummaryError("AI service rate limit reached");
      }
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        throw new SummaryError(`AI service rejected the request (${error.status}): ${error.message}`);
      }
      throw new SummaryError(`AI service error ${error.status}: ${error.message}`);
    }
    throw new SummaryError(`AI request failed: ${error.message}`);
  }

  // Blocked prompts or answers come back with no text.
  if (response.promptFeedback && response.promptFeedback.blockReason) {
    throw new SummaryError("AI model declined to summarize this story");
  }
  const finishReason = response.candidates && response.candidates[0] && response.candidates[0].finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new SummaryError("AI output was cut off");
  }
  if (!response.text) {
    throw new SummaryError(`AI model returned no text (${finishReason || "unknown reason"})`);
  }

  // Check the answer has every field we need.
  let parsed;
  try {
    parsed = BriefingSchema.safeParse(JSON.parse(response.text));
  } catch {
    throw new SummaryError("AI output was not valid JSON");
  }
  if (!parsed.success) {
    throw new SummaryError("AI output did not match the expected format");
  }
  const out = parsed.data;

  // Traceability: keep only references to articles that were actually provided.
  const mapRefs = (refs) => {
    const ids = [];
    for (const ref of refs) {
      const id = refToId.get(ref.trim());
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
    return ids;
  };

  // Every perspective must point to at least one real article.
  let perspectives = [];
  for (const p of out.perspectives) {
    const ids = mapRefs(p.supporting_article_refs);
    if (ids.length > 0) {
      perspectives.push({ label: p.label, summary: p.summary, evidence_limits: p.evidence_limits, article_ids: ids });
    }
  }

  // Fewer than two supported viewpoints means there are no distinct perspectives to show.
  let perspectivesStatus = out.perspectives_status;
  if (perspectives.length < 2) {
    perspectivesStatus = "insufficient_evidence";
  }
  if (perspectivesStatus === "insufficient_evidence") {
    perspectives = [];
  }

  let overviewRefs = mapRefs(out.overview_refs);
  if (overviewRefs.length === 0) {
    overviewRefs = articles.map((a) => a.id);
  }

  return {
    overview: out.overview,
    agreement: out.agreement,
    disagreement: out.disagreement,
    uncertainty: out.uncertainty,
    overview_refs: overviewRefs,
    perspectives_status: perspectivesStatus,
    perspectives,
    input_scope: "feed_excerpts",
    model: response.modelVersion || MODEL_CONFIG.model,
    prompt_version: PROMPT_VERSION
  };
}
