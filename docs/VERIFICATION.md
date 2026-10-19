# Verification evidence

"Local" results were produced on 2026-10-19 on a development machine (macOS, Node 24.20, Flutter 3.47.2). Automated checks run with `cd server && npm test` (12 tests, all passing) and `cd app && flutter test` (3 tests, all passing). Rows marked **TODO (deployed)** must be completed against the deployed service and the presentation phone. Paste the evidence (screenshots, `/status` excerpts, GitHub Actions run links) under each row.

## Required checks

| Check | How it was tested | Expected result | Actual result |
|---|---|---|---|
| Repeated ingestion | Test `repeated ingestion…` runs the same feeds twice. Live: two `npm run collect` runs against all 6 real feeds, a few minutes apart | No duplicate articles or stories | **Pass (local).** Test: 2nd run `articlesNew = 0`, `unchanged = 4`, same article and story counts. Live: run 1 `new 159`; run 2 `new 0, unchanged 158, updated 1` (one outlet edited an excerpt, so the row was updated in place). |
| Same event, different publishers | Test `same event…` + live sample (below) | One story, working publisher buttons | **Pass (local).** Test: 3 publishers → 1 story, buttons BBC/Fox/NPR. Live: 9 multi-publisher stories (examples below). UI check showed one button per covering publisher, labeled with that publisher's own headline. **TODO (phone):** tap each Open button and confirm it reaches the matching article. |
| Similar topic, different events | Fixture `expected_separate` + live sample | Unrelated events stay separate | **Pass (local).** Fixture: "Governor Maria Lopez signs budget" vs "…hospitalized after crash"; Chile vs Turkey earthquakes stay separate. Live examples below. |
| Hourly automation | GitHub Actions workflow + `GET /status` | ≥2 consecutive scheduled runs without client activity | **TODO (deployed).** Paste two consecutive `trigger: "schedule"` run records from `/status` and the Actions run links. |
| Seven-day boundary | Test `seven-day boundary…` with controlled timestamps (article published 166 h before T0; clock advanced 3 h) | Expired article leaves the API, is deleted at cleanup; recent ones remain | **Pass (local).** Before the next run, the API already excludes it (publisher count 3 → 2; summary `outdated`, text withheld). After the run, `articlesExpired = 1`, the row is deleted, and the other two articles remain. At +200 h all stories, summaries, and links are removed. |
| Source expiration inside a group | Same test | Expired source button disappears; summary no longer depends on removed content | **Pass (local).** Detail publishers become `["fox","npr"]`. After rebuild: `summary.status = current`, `input_article_ids.length = 2`, `version` incremented. |
| Shared AI output | Test `shared AI output…`: two API clients and three reads, then an unchanged collection run | Same stored version, no extra generation calls | **Pass (local).** All reads return one `version`/`generated_at`; the generation call count stays at 2 after the unchanged run. **TODO (deployed):** show `total_generations` in `/status` unchanged before and after reading a story from two phones. |
| Provider failure | Test `provider failure…` (NPR feed throws HTTP 503, AI throws 529). Live: AI key absent | Clear status; valid stories still usable | **Pass (local).** Run `outcome = partial`, NPR `ok: false`, stories remain, previous summary kept with `last_error`. Live without a key: 40 summaries `failed`, app shows "AI summary unavailable…". Optional deployed demo: set `FEED_URL_OVERRIDES={"npr":"https://example.invalid/x"}`. |
| Client connectivity failure | UI check: API stopped while the app was open | Retry state or labeled cached content | **Pass (local, Flutter web build).** "Offline mode: showing saved copy from Today, 9:12 AM. No connection to the My News server." with Retry. **TODO (phone):** repeat in airplane mode, including a fresh install with no cache (expected: "Could not load stories" + Retry). |
| Physical-phone presentation | Release APK on phone via Phone Link | Visible on computer | **TODO (phone).** |
| Beta-readiness regression | 3 consecutive core-workflow runs on the release build | No blocking defect | **TODO (phone).** Record in [RELEASE_NOTES.md](RELEASE_NOTES.md#beta-test-record). |
| Source fidelity | Code review + UI check | Excerpts stay original; AI claims traceable | **Pass (local).** Excerpts appear in quotation marks labeled "Feed excerpt … (original wording)". AI text is labeled "AI-generated" with numbered supporting-article buttons. The server drops citations to non-input articles (verified with a stubbed model response citing `A9`, which was removed). **TODO:** [AI summary review](AI_SUMMARY_REVIEW.md) with real output. |

## Grouping examples (live data)

Source: the 159 articles fetched from all six feeds on 2026-10-19 ~08:50 EDT, replayed through the final grouping code.

**Five+ stories with two or more publishers:**

| # | Story (paraphrased) | Publishers |
|---|---|---|
| 1 | Fire at a Canadian military base kills four | Guardian, Al Jazeera, CBS News |
| 2 | World Food Programme cuts aid to Gaza over funding shortages | BBC, Guardian, Al Jazeera |
| 3 | Alberta referendum vote on separation | NPR, BBC, Guardian |
| 4 | Australian MP Helen Haines critically injured by car | NPR, Al Jazeera |
| 5 | Pope Leo XIV returns after cancer surgery | BBC, CBS News (2 articles) |
| 6 | Amelia Earhart "wreckage" found to be trees | BBC, Guardian (2 articles) |
| 7 | French PM calls for curfews after riots | Guardian (2), Al Jazeera |
| 8 | West Bank settler attacks on journalist and diplomats | Guardian (4), Al Jazeera (2) |

**Related topics kept separate:**

1. "Trump endorses embattled Israeli Prime Minister Benjamin Netanyahu" (NPR) and "On Iran, Israel's opposition is even more hawkish than Netanyahu" (Al Jazeera) share Netanyahu and Israel but are different events. The first version of the grouping merged them (cosine 0.23 with a double-counted entity). After entity de-duplication and the 0.25 threshold, they are separate.
2. "France hit by debt sell-off as protests unnerve investors" (Guardian) stays separate from "French prime minister calls for 'local and partial' curfews after riots". Both are about the French unrest, but one is a market story (shared entity: France only).
3. (Fixture) Two earthquakes the same day in Chile and Turkey; the same governor in a budget story and a car-crash story.

**Observed weaknesses:** #8 chains several distinct West Bank incidents into one ongoing story. Some genuine matches stay split; for example, one outlet's base-fire article joined the group in one run but not after the entity rules changed. Both are documented in the README.

## Background links (live data)

Examples from the same run: "Funding shortages force World Food Programme…" → *Wikipedia: World Food Programme*, *Wikipedia: Gaza Strip*. "Amelia Earhart researchers leave remote atoll…" → *Wikipedia: Nikumaroro*, *Wikipedia: Amelia Earhart*. "Australian MP Helen Haines…" → *Wikipedia: Helen Haines*, *Wikipedia: Anthony Albanese*. "Pope Leo XIV thanks wellwishers…" → *Wikipedia: Pope Leo XIV*. Four checked stories got no acceptable match and correctly show "No background resource available".

## Automated test output (local)

```
✔ fixture: five same-event groups each end up in one story
✔ fixture: related topics that are different events stay separate
✔ new coverage joins an existing story instead of creating a duplicate
✔ a single shared name is not enough to merge
✔ entity extraction ignores sentence-initial words and title case
✔ repeated ingestion of identical feeds does not duplicate articles or stories
✔ same event from different publishers appears once with one button per publisher
✔ seven-day boundary: expired articles leave the API between runs and are deleted at cleanup
✔ shared AI output: repeated reads and unchanged runs reuse the stored summary
✔ provider failure: a failing feed or AI call keeps valid stored stories usable
✔ AI never configured: summary status is an honest failure, not fallback text
✔ admin collection trigger is protected
ℹ pass 12  ℹ fail 0
```
