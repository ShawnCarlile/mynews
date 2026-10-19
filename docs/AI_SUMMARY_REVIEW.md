# Manual review of three AI summaries

**Status: TODO.** This must be completed with real summaries from the deployed server (the development machine had no Anthropic API key, so no real model output exists yet). The review has to be your own reading of the model output against its inputs.

## How to do it

1. After the first deployed runs, pick three multi-publisher stories, including at least one with contrasting perspectives.
2. For each, open `GET /stories/{id}` and save the JSON (the article excerpts are the model's complete input, together with [the prompt](../server/src/ai/prompts.js)).
3. Check every sentence of the overview, agreement, disagreement, uncertainty, and each perspective against the excerpts.
4. If you find an unsupported claim, fix the cause (usually the prompt), bump `PROMPT_VERSION` so all summaries regenerate, and re-check the same story.

## Template (copy three times)

### Story N: *headline*
- Story id / summary version / generated at / model:
- Input articles (publisher, title):
- **Unsupported claims** (statement in the AI text that no excerpt supports):
- **Missing context** (important point in the excerpts the summary leaves out):
- **Perspectives check** (does each viewpoint appear in its cited articles? any viewpoint assigned only from the publisher's identity? if "insufficient evidence", was that right?):
- **Citation check** (do the numbered supporting articles actually support the text?):
- **Correction made** (prompt change / none needed) and result after regeneration:

## Stories with contrasting perspectives (need at least three)

| Story id | Perspectives shown | Supported by excerpts? |
|---|---|---|
| | | |
| | | |
| | | |
