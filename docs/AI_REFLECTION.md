# AI development reflection (draft)

> **Draft to personalize.** This page has to be your own account, about one page. The facts below are an accurate log of what the AI assistant did and what went wrong during development, as a starting point. Replace the bracketed parts, and rewrite in your own words what you personally checked.

## Tools used
- **Claude Code** (Anthropic, model Claude Opus 5.5) in the Claude desktop app. It generated the server, the Flutter client, the tests, and the documentation, and ran tests and collections locally.
- [Any other tools you used: Copilot, ChatGPT, etc.]

## Two representative prompts
1. [Your first prompt, e.g. pasting the assignment PDF and asking for the full MVP with a Node + Supabase backend, first with Claude summaries and then switched to Google Gemini because it has a free tier.]
2. [A follow-up prompt you wrote, e.g. asking it to tighten grouping after you saw a wrong merge, or to change the story ordering.]

## AI-generated mistakes found and corrected
These happened during development and were caught by running the code against real data or tests:

1. **Wrong story merges.** The first grouping version merged "Trump endorses Netanyahu" with "Israel's opposition is hawkish on Iran", and an NPR midterms roundup that mentioned Macron with French protest coverage. Cause: the same person was counted twice as two entities ("Netanyahu" and "Israeli Prime Minister Benjamin Netanyahu"), so one shared name passed the "two shared entities" rule. Fix: collapse nested entities and raise the weak threshold. Re-running the live sample confirmed the merges were gone.
2. **Fake names from capitalization.** Background lookup linked a story to the Wikipedia page "Deeply" (from a quoted "'Deeply appalled'") and "Satellite". Title-Case CBS headlines produced entities like "minutes interview actor sacha baron cohen". Fix: ignore sentence-initial words unless they are also capitalized mid-sentence, and ignore Title-Case headlines for entity extraction.
3. **A test that contradicted the design.** The seven-day test placed coverage of the same event 164 hours apart, which the 72-hour grouping window can never join, so 4 of 7 tests failed. The failing tests also left databases open and hung the test runner. Fix: realistic timestamps and failure-safe cleanup with `t.after`.
4. **Migration splitter bug.** A semicolon inside an SQL comment split a `CREATE TABLE` statement, so the database would not initialize.
5. **Wikipedia rate limiting.** Lookups were blocked (HTTP 429) because the User-Agent had no contact information. Fix: one combined request per term, throttling, stop on 429, and a `CONTACT_EMAIL` setting.
6. **An invented example in the documentation.** A draft README used a specific military base name the assistant had not seen in any article. It was replaced with an accurate example.

[Pick one of these, or one you found yourself, and explain it in your own words.]

## What I personally verified
[Write this yourself. For example: read the grouping output for the live sample and judged each merge; checked publisher buttons open the right article; read three AI summaries against their excerpts (see AI_SUMMARY_REVIEW.md); confirmed two consecutive scheduled runs in /status; ran the three-run regression on the phone; confirmed no secrets are in the APK or repository.]
