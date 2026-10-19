# Presentation checklist (5–7 minutes)

**Before class:** phone charged, Do Not Disturb on (suppress notifications), Phone Link connected and mirroring, phone font size readable on the projector, release APK installed and opened once (wakes the server). Open in browser tabs: `/status`, the GitHub Actions run history, and the Render and Supabase dashboards.

| Time | Show | Say |
|---|---|---|
| 0:00 | Architecture diagram (README) | Server collects, groups, and summarizes once per hour. The app only reads stored results. |
| 0:45 | Phone: launch → **Top stories** | Headline, publisher count, latest time, "Updated …", newest-first ordering with wider coverage boosted. |
| 1:30 | Tap a 3–4 publisher story → **Story detail** | Overview, one button per publisher (only those that covered it). Open one publisher, press Back, and the story is still selected. |
| 2:15 | **Background** button | Wikipedia page chosen automatically from the story's main names. Show a story with "No background resource available". |
| 2:45 | **AI analysis** → a **perspective** → Switch | AI-generated label, time and model, agreement/uncertainty, numbered supporting articles, feed-excerpt disclosure. Show a story with "Insufficient evidence for distinct perspectives". |
| 3:45 | Browser: `/status` | Two consecutive `trigger: schedule` runs with start time, outcome, and counts; GitHub Actions history. |
| 4:30 | Two clients | Open the same story on the phone and in a browser (`/stories/{id}`): same `version` and `generated_at`; `total_generations` in `/status` unchanged. |
| 5:15 | Failure handling | Airplane mode → refresh → offline banner with the saved copy → Retry. Mention partial runs when a feed fails, and honest AI-failure status. |
| 6:00 | Render + Supabase dashboards | Deployed service and persistent database. Secrets live only in Render env vars. |
| 6:30 | Wrap up | Grouping method and one known weakness; what you verified yourself. |
