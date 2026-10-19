import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL_CONFIG, PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

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

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new SummaryError("AI service not configured (ANTHROPIC_API_KEY missing on server)");
  }
  client ??= new Anthropic();
  return client;
}

export class SummaryError extends Error {}

// articles: [{id, publisherName, title, excerpt, publishedAt}]
// Returns a summary record ready to store. Throws SummaryError on any failure;
// the caller records the error and never substitutes fallback text.
export async function generateSummary(articles, { anthropic } = {}) {
  const refToId = new Map();
  const input = articles.map((a, i) => {
    const ref = `A${i + 1}`;
    refToId.set(ref, a.id);
    return { ...a, ref };
  });

  let response;
  try {
    response = await (anthropic ?? getClient()).messages.parse({
      model: MODEL_CONFIG.model,
      max_tokens: MODEL_CONFIG.max_tokens,
      output_config: { effort: MODEL_CONFIG.effort, format: zodOutputFormat(BriefingSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }]
    });
  } catch (error) {
    if (error instanceof SummaryError) throw error;
    if (error instanceof Anthropic.AuthenticationError) throw new SummaryError("AI service rejected the server's API key");
    if (error instanceof Anthropic.RateLimitError) throw new SummaryError("AI service rate limit reached");
    if (error instanceof Anthropic.APIError) throw new SummaryError(`AI service error ${error.status ?? ""}: ${error.message}`.trim());
    throw new SummaryError(`AI request failed: ${error.message}`);
  }

  if (response.stop_reason === "refusal") throw new SummaryError("AI model declined to summarize this story");
  if (response.stop_reason === "max_tokens") throw new SummaryError("AI output was cut off");
  const out = response.parsed_output;
  if (!out) throw new SummaryError("AI output did not match the expected format");

  // Traceability: keep only references to articles that were actually provided.
  const mapRefs = (refs) => [...new Set(refs.map((r) => refToId.get(r.trim())).filter(Boolean))];
  let perspectives = out.perspectives
    .map((p) => ({ label: p.label, summary: p.summary, evidence_limits: p.evidence_limits, article_ids: mapRefs(p.supporting_article_refs) }))
    .filter((p) => p.article_ids.length > 0);
  let perspectivesStatus = out.perspectives_status;
  if (perspectivesStatus === "supported" && perspectives.length < 2) {
    perspectivesStatus = "insufficient_evidence";
  }
  if (perspectivesStatus === "insufficient_evidence") perspectives = [];

  const overviewRefs = mapRefs(out.overview_refs);
  return {
    overview: out.overview,
    agreement: out.agreement,
    disagreement: out.disagreement,
    uncertainty: out.uncertainty,
    overview_refs: overviewRefs.length ? overviewRefs : articles.map((a) => a.id),
    perspectives_status: perspectivesStatus,
    perspectives,
    input_scope: "feed_excerpts",
    model: response.model || MODEL_CONFIG.model,
    prompt_version: PROMPT_VERSION
  };
}
