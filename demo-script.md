# Demo script (about 3 minutes)

Numbers below are from the current build (calibration.json, Nov 14 2026). Re-check them after any change to the model or data.

## 1. Open (20 s) — Resident view, 5 pm today

> "Rexburg's records and local news list dozens of projects — new housing, a WinCo, a temple, Madison Commons. They're in documents almost nobody reads. Here's what they do to Rexburg at 5 pm."

Drag the timeline to 2034. Streets shift toward red.

If the agent has confirmed at least one project from the minutes, add: *"Our AI agent read the council minutes and found this one — here's the quote."* (Tap that project; the panel shows "Found by the AI agent".) If not, don't claim the AI read them.

## 2. How it works (30 s)

> "Every household and student becomes trips, trips get destinations from real Census commuting data, and every trip is routed through the real street network, hour by hour — the same four-step method planning agencies use."

Point at a problem card: *when it starts, what causes it, how sure we are.*

## 3. Before and after (45 s) — Planner view

- **Demo views:** "5 pm 2034, with projects" vs "5 pm 2034, growth only".
- **Problems → Compare fixes** on the top street: roundabout vs turn lanes vs signal timing, ranked by delay saved.
- **Where should 500 new student beds go?** → Compare three sites. The walk-district site adds the least delay.

## 4. Accuracy, honestly (30 s)

Scroll to **Accuracy against city counts**.

> "We checked it against the city's 89 traffic counts. It ranks streets in roughly the right order — correlation about 0.8 — but only about 30% of counts pass the strict GEH test, and 10–15% of the ones we held back. Agencies aim for 85%. So: use it to compare options, not to quote exact numbers."

## 5. Close (15 s)

> "It doesn't replace an engineering study. It tells a city which options are worth one."

## Limits slide

- Future years are what-ifs from growth sliders; projects and counts are real and sourced.
- Counts are 2015–2020, grown 2.5% a year; most predate the 2024 interchange and 2nd East work.
- Residents and students are placed by building floor area (estimate); jobs and commutes are LODES 2023.
- Commute mode, carpooling and work-from-home come from Census ACS 2020–2024 by block group; other trip rates are national averages scaled by one calibrated factor (α = 3); no local travel survey.
- Not an intersection or signal-timing study; no special events.

## Likely questions

| Question | Answer |
| --- | --- |
| How do you know it's right? | Correlation ~0.8 with 89 city counts; about 30% pass GEH 5 (10–15% of held-out counts). Honest: good for ranking, not exact volumes yet. |
| Where's the data from? | OpenStreetMap, Madison County / Rexburg GIS, Census LODES 2023 and ACS 2020–2024, city project map, five-year street plan, P&Z minutes. All public. |
| Did the AI really read the records? | Only say yes for projects marked "Found by the AI agent" with a quote. |
| Other cities? | LODES and OpenStreetMap cover the whole U.S.; rerun the three build scripts with a new city's files. |
