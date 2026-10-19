# My News 1.0.0 (beta): release notes

## Features
- Top stories from six publishers (Fox News, NPR, BBC News, The Guardian, Al Jazeera, CBS News), updated hourly, covering the last seven days.
- Each story groups every publisher's coverage of the same event, with one button per publisher. A chooser appears when one publisher has several articles.
- Background links (Wikipedia) chosen automatically from the story's main names, or "No background resource available".
- AI analysis (labeled AI-generated): overview, what sources agree on and where they differ, uncertainty, attributed perspectives with supporting articles, and an honest "insufficient evidence" result when there aren't two real viewpoints.
- Offline mode shows the last saved stories with a clear banner, and still hides anything older than seven days.
- About sheet with version, server address, and a "Report a problem" link.

## Known minor issues
- The Refresh icon greys out while loading; there is no other progress indicator during a pull-to-refresh beyond the bar at the top.
- Some CBS video segments (e.g. "Face The Nation") appear as single-source stories with generic titles.
- Long ongoing situations (e.g. several West Bank incidents in one week) can be grouped as one story.
- Times show in the phone's time zone; relative labels ("Today", "Yesterday") use the phone's clock.

## Service limitations
- AI summaries are based on RSS feed excerpts only, not full articles. Read the original coverage for full context.
- The free hosting tier sleeps when idle; the first load after a quiet period can take up to a minute.
- Scheduled collection runs roughly hourly (GitHub may delay a run by a few minutes).
- Publisher and Wikipedia pages open in the browser and need an internet connection.

## Reporting problems
Beta testers: use **About → Report a problem** in the app ([set `FEEDBACK_URL` to your issue tracker or form when building]). Please include the story headline, what you tapped, and what you expected.

## Beta test record
| Run | Build / version | Device / Android version | Date | Server URL | Result (launch → list → story → publisher → background → AI → perspective → back to list) |
|---|---|---|---|---|---|
| 1 | 1.0.0+1 release APK | | | | |
| 2 | 1.0.0+1 release APK | | | | |
| 3 | 1.0.0+1 release APK | | | | |

## Defect log
| ID | Severity | Summary | Steps to reproduce | Status | Verification |
|---|---|---|---|---|---|
| D1 | Critical | Database would not initialize: a semicolon inside an SQL comment split a statement | `npm run collect` on an empty database | Fixed | Migration runs; collection completed (159 articles) |
| D2 | Major | Unrelated stories merged when they shared one prominent person (entity double-counted) | Group the 2026-10-19 live sample; "Trump endorses Netanyahu" merged with an Iran analysis | Fixed | Live sample regrouped: 0 false merges found; fixture tests pass |
| D3 | Major | Background links to the wrong pages ("Deeply", "Satellite") from capitalized sentence starts and Title-Case headlines | Collect live feeds; inspect `story_background` | Fixed | Unit test for entity extraction; re-run shows the pages gone |
| D4 | Major | Wikipedia lookups failed with HTTP 429 | Collect with the default User-Agent | Fixed (needs `CONTACT_EMAIL`) | 59 links created in a run; 0 rate-limit errors |
| D5 | Major | Release build could not reach the server or open links (missing INTERNET permission and https intent query) | Install the release APK | Fixed | Manifest updated; **re-verify on phone** |
| D6 | Minor | Top stories buried multi-publisher stories under single-source items | Open the app after a collection | Fixed (ordering boosts each extra publisher by 6 h) | UI check: grouped stories at the top |
| D7 | Minor | First request after free-tier sleep could exceed the 15 s client timeout | Open the app after 15+ min idle | Fixed (60 s timeout + hint text) | **Re-verify against the deployed server** |
| D8 | Minor | Test runner hung when a test failed (databases not closed) | `npm test` with a failing test | Fixed (`t.after` cleanup) | `npm test` completes: 12/12 |

Add any defects found during phone testing here. The release is beta-ready only with no open Critical or Major rows.
