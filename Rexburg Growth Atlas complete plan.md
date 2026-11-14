# Rexburg Growth Atlas: complete plan

Nov 13, 2026 · @yujin lim

## Opening hooks (optional, pick one)

"Screens options before an engineering study" works best as the closing credibility line, not the opener.

| Hook | What to say or show | Best for |
| --- | --- | --- |
| See the traffic before you vote | Every council approval is a traffic decision, but nobody sees the traffic until it's built | Civic-impact judges |
| Rexburg in 2034, at 5 pm | Open on the 3D map, drag the timeline to 2034, let the streets turn red | Visual opener, no words needed |
| The future is already in the meeting minutes | Dozens of approved projects sit in documents almost nobody reads; the AI reads them and shows what they do to your drive | Showing what's new |
| How long will your drive to campus take in 2030? | Personal and instant; everyone has an opinion on Rexburg traffic | Local or student audience |
| Weeks of traffic study, answered in seconds | A traffic study takes weeks and real money; this compares ten site options in a minute | Practical or business judges |

**Suggested combination:**

> "Rexburg has already approved 46 projects. They're in meeting minutes almost nobody reads. Our AI read them. Here's what they do to Rexburg at 5 pm in 2034." *(drag the timeline; roads turn red)*

Then the before-and-after, the accuracy check, and the close: "It doesn't replace an engineering study. It tells a city which options are worth one."

**Caution:** any specific result quoted on stage (e.g., a street at 97% of capacity) is a model estimate; say so.

## Summary

The Rexburg Growth Atlas shows how approved growth will change traffic in Rexburg, hour by hour and year by year, so a city can test options before paying for a full engineering study. This doc combines the working app (Ben's atlas), our traffic method, the case for trusting it, and the build plan.

- **What it does:** a 3D map of real Rexburg streets and buildings, the city's projects on a 2024–2034 timeline, population for students and residents, and each street colored by how full it is at any hour.
- **What's built:** the 3D city, timeline, hourly view, population model, housing and parking gaps, resident and planner modes, and a project register with sources.
- **What's left:** real routing (trips choosing roads), problem cards, road suggestions, and a placement heat map. Routing comes first because the rest depends on it.
- **The method:** the same four-step approach planners use (trips made → destinations → mode → routes), built from free public data and checked against the city's 89 traffic counts.
- **What's new:** reading city records to find approved projects, and a fast "what if" for a city too small to run its own traffic model often.

**Honest framing for the demo:** projects and traffic counts are real and sourced. Traffic loads, gaps and future years are a what-if model. The tool screens many options cheaply and narrows them to the few worth a real engineering study; it doesn't replace that study.

## How it works

People become trips, trips get destinations, trips get routes, and routes fill roads. Eight steps; the atlas has the base for most of them, and routing is the main piece still to build.

| Step | What it does | In the atlas | Still to add |
| --- | --- | --- | --- |
| 1. Roads | Every street with lanes, capacity, travel time | Streets, lanes, capacity | Travel times; drive-time table between zones |
| 2. Population | Students and residents for any year, spread to zones | City model with sliders | Spread to zones |
| 3. Projects | Approved developments on the timeline | 46 city projects + news | AI agent for new approvals |
| 4. Trips | Car trips from every household and student | Project trips only | Residents and students |
| 5. Destinations | Where each trip goes | Planned | LODES work trips, campus, gravity |
| 6. Hours | Spread trips across 24 hours and day types | Assumed profile | Check against real hourly counter |
| 7. Routing | Each trip picks roads; busy roads slow down | Not built | Batch assignment with BPR |
| 8. Congestion | Color streets, flag problems, check accuracy | Load colors, modes | V/C levels, travel time index, accuracy scores |

Until routing exists, the atlas colors streets by their old count plus nearby project trips. After routing, routed volumes replace that method, and the city's counts become the test instead of the input.

## Step 1: roads, capacity and travel time

Every street comes from OpenStreetMap (OSM). For each one we know how many cars it can carry per hour and how long it takes to drive.

### Capacity

```latex
C_e = \text{lanes}_e \times c_{\text{type}}
```

**In plain words:** capacity is the most cars that can pass a spot in one hour, in one direction, before traffic backs up.

| Road type | Cars per lane per hour | Why |
| --- | --- | --- |
| Highway (US-20) | 1,800 | No stops: about one car every 2 seconds |
| Main road / arterial (2nd East, Main St) | 900 | Traffic lights mean green only about half the time |
| Collector | 700 | More stop signs and turning cars |
| Local street | 450 | Stop signs, parked cars, driveways, walkers |

**Example:** 2nd East with 2 lanes each way → 2 × 900 = 1,800 cars per hour in each direction.

**Lanes drive everything:** a street missing its lane count in OSM can look better or worse than it is. Check lanes first when a result looks wrong.

### Travel time

```latex
t_e = \frac{\text{length}_e}{\text{speed}_e}
```

**In plain words:** the same idea as "60 miles at 60 mph takes 1 hour." Speed is the posted limit, or the typical speed for that road type when OSM doesn't list one.

**Example:** a half-mile stretch at 35 mph takes 0.5 ÷ 35 × 60 ≈ 0.86 minutes, or **51 seconds**.

### Drive-time table between zones

Pick one road point per zone and find the fastest route between every pair, adding up each road's time. With 60 zones that's 3,600 routes, which takes seconds. These are empty-road times; Step 7 slows them down as roads fill.

## Step 2: population

Students and other residents are tracked separately, because they live, drive and travel differently. Then each group is spread across zones.

### City totals for any year

```latex
P_{t+1} = P_t + N_t - L_t + s \cdot L_t + g_t
```

- P\_t = population this period
- N\_t = new arrivals (mainly new students, from the enrollment growth slider)
- L\_t = people leaving (mainly graduates)
- s = share of graduates who stay (slider)
- g\_t = other growth: new homes × 3.3 people per household

**In plain words:** next year's population = this year's, plus newcomers, minus people who leave, plus graduates who stay, plus people moving into new homes.

**Start:** 21,900 students living in town + 22,100 other residents = 44,000, between the Census estimate (40,334 for 2025) and the city's own figure. **Student beds cap students:** if enrollment grows faster than beds, the gaps panel shows the shortage.

**Example (mock numbers):** 22,100 residents, 100 graduates staying, 150 new homes a year → next year about 22,100 + 100 + 150 × 3.3 = 22,695 residents.

**Avoid double counting:** a general growth rate already includes some new housing. When adding known projects, use a lower background rate or count growth only through projects.

### Spreading people to zones

- **Students** go where the beds are: each student housing complex has a known bed count (city project list, parcels).
- **Other residents** go by Census blocks and ACS block groups, plus parcels for homes built since.
- **Scale to the total** so zones add up exactly to the city totals:

```latex
R_i = \text{Census}_i \times \frac{R_{\text{city}}}{\sum_j \text{Census}_j} \qquad S_i = \text{beds}_i \times \frac{S_{\text{city}}}{\sum_j \text{beds}_j}
```

## Step 3: projects

Approved developments drive future growth, so each one goes on the timeline with its size, location, opening date and source.

**Where projects come from:**

- **City project map:** 46 city projects and 10 developer widenings (no dates), already in the atlas.
- **City five-year street plan** (2026–2030) for road changes.
- **News, ITD, BYU-I and church pages** for Madison Commons, White Owl / Homestead, WinCo, the temple, Sundance and campus buildings.
- **The AI agent** reads council and planning agendas, minutes and permits to find new approvals as they happen. This is the tool's most original piece.

**Each project records:** status, progress, size (homes, beds, square feet), opening date, trips, code-minimum parking, a source quote and link, a confidence level, and flags.

**How projects feed the model:**

- **Housing** (homes, student beds) adds people to its zone in Step 2 once it opens. Its trips then come from Step 4's household and student formulas, not a separate project rate.
- **Stores, offices, services** become destinations in Step 5, pulling trips by their size.
- **Road projects** change lanes or add roads in Step 1 from their opening date.

**Make the AI reviewable:** misread unit counts or missed projects throw off every forecast. Show each project the agent found with its source quote, and let a person confirm it before it counts.

## Step 4: car trips

Every household and student makes trips, not just people near new projects. Residents use household types and trip purposes; students use campus rules; new stores and offices become destinations.

### Residents

**4a. Trips per household type.** A family of five with two cars makes far more trips than one person without a car.

```latex
PT_i = \sum_{s,v} H_{i,s,v} \times R_{s,v}
```

H = households in zone i by size s and cars v (ACS B08201); R = trips per day for that type (NHTS 2022).

**4b. Split by purpose.**

```latex
W_i = 2 \times \text{workers}_i \times (1 - \text{wfh}_i) \qquad NHB_i = PT_i \times 0.25 \qquad HBO_i = PT_i - W_i - NHB_i
```

Work trips (W) from ACS worker counts, × 2 for there and back; not-home-based (NHB, e.g., work → lunch) about a quarter of trips; other trips (HBO: shopping, school, church) are the rest.

**4c. People into cars.** Four friends in one car is one car on the road.

```latex
CW_i = W_i \times \frac{d_{w,i}}{o_{w,i}} \qquad CO_i = HBO_i \times \frac{d_o}{1.5}
```

d\_w = share of commuters who drive (ACS B08301); o\_w = people per car on the commute (ACS); d\_o = share of other trips by car (estimate); 1.5 = people per car for other trips (NHTS).

### Students

```latex
ST_i = S_i \times r_s \times c \times m_i \div o_s
```

S\_i = students in zone i; r\_s = trips per student per day; c = share with a car (atlas slider); m\_i = share of trips by car from that zone (low near campus and in the Pedestrian Emphasis District); o\_s = people per car.

### Worked example (mock numbers)

A resident zone with 364 households and 500 workers, plus 400 students living 1.5 miles from campus:

| Group | Person trips | Car trips |
| --- | --- | --- |
| Resident work | 2 × 500 × 0.88 = 880 | 880 × 0.60 ÷ 1.13 = **467** |
| Resident other | 2,482 − 880 − 621 = 981 | 981 × 0.60 ÷ 1.5 = **392** |
| Resident not-home-based | 2,482 × 0.25 = 621 | 248, placed at job and store zones |
| Students | 400 × 3 = 1,200 | 1,200 × 0.5 × 0.5 ÷ 1.3 = **231** |

The resident total of 2,482 person trips comes from household types (e.g., 60 small no-car households × 2.5 trips, 100 families with 2+ cars × 10 trips). **Result:** 467 + 392 + 231 = **1,090 car trips a day** start or end at homes in this zone.

### New buildings

- **Housing:** counted through its residents or students above. Don't also add a per-home rate, or it's counted twice.
- **Stores, offices, services:** atlas rates (supermarket 94 trips per 1,000 sq ft less 35% pass-by; assisted living 2.6 per bed) become destination pull in Step 5. Check rates against the ITE Trip Generation Manual before quoting.

## Step 5: zones and destinations

Step 5 adds no trips. It decides where each of Step 4's trips goes: work trips by real Census data, student class trips mostly to campus, and everything else by a gravity rule on drive time.

### Zones

- **40–60 zones in town:** Census block groups, with big ones split along main roads.
- **Shop zones:** any Census block with 40+ store or restaurant jobs (LODES CNS07 + CNS18) is its own zone, placed at its commercial buildings and joined to the nearest main streets, so shoppers arrive at Walmart, Broulim's or the 2nd East strips, not at the middle of a big block group.
- **Campus zone:** BYU-I (or 2–3 zones for its main parking areas).
- **Gateway zones:** US-20 north and south, SH-33 east and west, and other roads out of town, for trips to Idaho Falls, Rigby or Sugar City.

### Where each trip goes

| Trip type | Rule | Data |
| --- | --- | --- |
| Resident work | Real home-to-work shares | LODES OD, block level |
| Student class trips | Mostly to campus, morning peak | Enrollment, campus zone |
| Other (shopping, church, errands) | Gravity on drive time | Attractions below |
| Not-home-based | Start at job and store zones, then gravity | Attractions below |

### Work trips

```latex
CW_{ij} = CW_i \times \frac{F_{ij}}{\sum_k F_{ik}}
```

F\_ij = workers living in zone i who work in zone j (LODES). Morning trips go home → work, evening trips go back.

### Attractions and gravity

```latex
A_j = a_{\text{ret}} \cdot \text{RetailJobs}_j + a_{\text{food}} \cdot \text{FoodJobs}_j + a_{\text{oth}} \cdot \text{OtherJobs}_j + a_{\text{hh}} \cdot \text{Households}_j + \text{ProjectTrips}_j
```

```latex
CO_{ij} = CO_i \times \frac{A_j \, e^{-\beta t_{ij}}}{\sum_k A_k \, e^{-\beta t_{ik}}}
```

**In plain words:** zones with more jobs and stores pull more trips, and every extra minute of driving weakens the pull. Retail jobs count more than office jobs because stores draw shoppers. New stores (WinCo, Madison Commons) add pull once they open. β ≈ 0.1 per minute to start: each minute cuts the pull by about 10%.

### Worked example (mock numbers, continuing Step 4)

| Zone | LODES work share | Attraction | Drive time | Pull |
| --- | --- | --- | --- | --- |
| D (downtown) | 60% | 1,500 | 4 min | 1,005 |
| E | 25% | 900 | 7 min | 447 |
| F | 15% | 1,200 | 10 min | 442 |

Students send 70% of their 231 car trips to campus; the rest follow the same pull as other trips.

| Destination | Work | Other | Students | Total |
| --- | --- | --- | --- | --- |
| Campus | — | — | 162 | **162** |
| D | 280 | 208 | 37 | **525** |
| E | 117 | 93 | 16 | **226** |
| F | 70 | 91 | 16 | **177** |
| **Total** | **467** | **392** | **231** | **1,090** |

The total still matches Step 4: trips are only being placed.

## Step 6: hours and day types

Congestion happens in specific hours, so each day's trips are spread across 24 hours with a pattern for each trip type and kind of day.

```latex
T_{ij}(h, d) = T_{ij} \times f_d \times k_h
```

- k\_h = share of that trip type in hour h. Work and class trips peak in the morning and late afternoon; shopping peaks midday and evening. The atlas profile peaks at 7.5% of the day at 8 am and 9.5% at 5 pm, shaped by campus, retail and downtown activity.
- f\_d = how busy that kind of day is compared with an average weekday.

**In plain words:** take a day's trips, adjust for how busy that day is, then take the share that happens in that hour.

**Example (mock share):** 280 work trips between a zone and downtown; if 10% happen at 5 pm, that's **28 cars** at 5 pm, mostly heading home. On Sunday, commuting nearly disappears while shopping trips stay.

**Real data to check the shape:** ITD's permanent counter 059 on SH-33 east of Rexburg records every hour of every day. In 2022 it averaged 3,460 cars on weekdays, 2,733 on weekend days and 2,167 on Sundays (a Sunday factor of about 0.6), and its July average was almost double January's. It's a highway outside town, so it's a check, not a perfect match for city streets.

**User choices:** year (timeline), day type (weekday, Saturday, Sunday; school year or summer), hour 0–23, and with or without projects.

## Step 7: routing

Each hour's trips are loaded onto the roads in 4 batches. After each batch, roads that are filling up get slower, so the next batch avoids them, the way real drivers learn to avoid jams. This runs in plain JavaScript inside the atlas.

### How it works

1. **Road graph** from OSM intersections: each street piece has length, speed, lanes and capacity.
2. **Hourly trip table:** zone-to-zone trips for that hour (Steps 4–6).
3. **Batch 1 (40% of trips):** each trip takes the fastest path on empty-road times.
4. **Slow down full roads** with the BPR formula.
5. **Batches 2–4 (30%, 20%, 10%):** route on the updated times, updating after each.
6. **Save each street's volume** for Step 8.

```latex
t_e = t_{0,e} \left[ 1 + 0.15 \left( \frac{V_e}{C_e} \right)^4 \right]
```

**In plain words:** BPR (from the federal Bureau of Public Roads) says a road barely slows until it's nearly full, then slows fast. On the 51-second stretch from Step 1:

| Traffic level (V/C) | Slowdown | Time |
| --- | --- | --- |
| 0.5 (light) | about 1% | 52 sec |
| 0.9 (busy) | about 10% | 56 sec |
| 1.2 (jammed) | about 31% | 67 sec |

### Through traffic

US-20 and SH-33 carry cars just passing through. At each gateway, add through trips = count − the model's local trips there, routed gateway to gateway. Without this, the highway looks too empty.

### Feedback

Destinations in Step 5 used empty-road times. After routing, rerun Step 5 once with the slower times, so a few trips shift away from jammed areas.

### Speed

About 60 zones × 4 batches = 240 fastest-path searches per hour on about 3,250 street pieces: quick in JavaScript. Run it in a Web Worker so the 3D view doesn't freeze, and cache results by quarter, hour and scenario.

### Later: SUMO

SUMO simulates individual cars, queues and full equilibrium, but it's desktop software. Run it offline for a few key scenarios and load the results as a "detailed simulation" layer.

## Step 8: measuring congestion

A road is congested when it carries about 90% or more of the cars it can handle (V/C of 0.9 or higher).

```latex
\text{V/C} = \frac{\text{cars on the road this hour}}{\text{capacity per hour}}
```

| V/C | What drivers feel | Color |
| --- | --- | --- |
| Under 0.7 | Moves freely | Green |
| 0.7 to 0.9 | Busy, a little slower | Yellow |
| 0.9 to 1.0 | Congested: stop-and-go, long waits at lights | Red |
| Over 1.0 | More cars want the road than it can carry; queues grow | Dark red |

**Example:** 2nd East northbound at 5 pm: capacity 1,800 cars per hour, model counts 1,620 → 1,620 ÷ 1,800 = **0.90**: congested.

**Why 0.9:** up to about 70–80% full, cars barely affect each other. Near 90%, one car braking or one long red light starts a backup that snowballs.

**Where the cutoffs come from:** planners grade roads A to F with "level of service" from the Highway Capacity Manual. A–C is free-flowing, D busy, E–F congested or failing; V/C near 0.9–1.0 roughly matches E, over 1.0 matches F. Cutoffs vary by agency, so ask Rexburg or ITD which standard they use.

### Travel time index

```latex
\text{TTI} = \frac{\text{actual travel time}}{\text{empty-road travel time}}
```

About 1.0 is no delay; 1.3 means trips take 30% longer, a common "congested" line. **Example:** the 51-second stretch takes 70 seconds at 5 pm → 70 ÷ 51 = **1.37**.

**In the app:** color streets by V/C (what planners know); show the travel time index when a street is tapped ("takes 37% longer than usual"). Problem cards flag streets over 0.9, with when it starts, what causes it and how sure the model is.

## Data sources

Most inputs are real local or Census data; a few are national averages; a handful are estimates tuned against counts.

| Input | Used in | Source | Date | Status | Type |
| --- | --- | --- | --- | --- | --- |
| Streets, lanes, buildings (5,179), parking, parks, rail, campus | 1 | OpenStreetMap via Overpass Turbo | Nov 2026 | In hand | Real |
| Traffic counts (317 records, 89 used) | 8, accuracy | Madison County / Rexburg GIS TrafficCount | Mostly 2016–2019 | In hand | Real |
| City projects (46), developer widenings (10) | 3 | City Project Details map | Current | In hand | Real |
| Five-year street plan | 1, 3 | City Road Improvement Projects map | 2026–2030 | In hand | Real |
| Other projects (Madison Commons, WinCo, temple, etc.) | 3 | News, ITD, BYU-I, church pages | 2024–2026 | In hand | Real; locations approximate |
| Pedestrian Emphasis District | 4 | City GIS PED layer | Current | In hand | Real |
| Enrollment (24,111 campus-based) | 2 | East Idaho News, BYU-I pages | Fall 2026 | In hand | Real |
| City population | 2 | Census population estimates | 2025 | To add | Real |
| County parcels (17,910, zoning, acres) | 2, 3 | County GIS | Current | Available | Real |
| People and households by block group | 2 | Census ACS 5-year | 2020–2024 | To add | Real |
| Households by size × cars | 4 | ACS B08201 (tract level) | 2020–2024 | To add | Real |
| Workers, commute mode, work from home | 4 | ACS B08301 | 2020–2024 | To add | Real |
| Home-to-work pairs; jobs by industry | 5 | Census LODES OD and WAC | 2023; 2019 | To add | Real |
| Hourly traffic shape | 6 | ITD permanent counter 059 | 2022–2023 | To add | Real |
| Trip rates, trip purposes, people per car | 4, 6 | NHTS 2022; NCHRP 716 | 2022 | To add | National average |
| Project trip rates | 4 | Textbook values; check with ITE Trip Generation | — | In use | Estimate |

**Why these sources:** OSM covers every street and can be edited to test new roads; the city's counts are the best local truth we have; ACS and LODES give household, car, commute and job data for every U.S. city; NHTS is the federal standard when there's no local travel survey.

**Data age:** 84 of 89 counts are from before the 2024 US-20 interchange rebuild and the 2024–2025 2nd East widening. ACS is a 5-year average and LODES runs about two years behind, so recent construction comes from city records and parcels.

## Estimates and mock values

A few numbers can't come from local data, so they're estimated, labeled, kept in believable ranges and tuned against the city's counts.

| Estimate | Starting value | Why estimated | How it's fixed |
| --- | --- | --- | --- |
| Distance preference β | 0.1 per minute | No local data on how far people go to shop | Tune to counts; check trip lengths against NHTS |
| Scale factor α | 1.0 | Small errors add up across steps | Total counts ÷ total model volume on counted roads |
| Non-work trips by car (d\_o) | 60% | ACS covers only commuting | Tune; ask for the county model's value |
| Not-home-based share | 25% | No local survey | NHTS; check with NCHRP 716 |
| Student trips per day, car share | 3 trips; slider | No public BYU-I travel data | Tune; BYU-I parking or housing survey |
| Capacity per lane | 450–1,800 | OSM doesn't store capacity | Standard values; adjust where counts disagree |
| Missing speeds and lanes | Defaults by road type | Many OSM tags blank | Fix OSM tags; spot-check drive times |
| Background growth | From past Census trend | The future is unknown | Low, expected and high scenarios |
| Through traffic on US-20 | Count − local trips | No data on non-local cars | Anchored to real counts |
| Streets without counts (before routing) | 12,000 / 7,000 / 4,000 / 500 a day by road type | Placeholder until routing | Retired once routing works |

**Mock values:** the worked examples in Steps 2, 4, 5 and 6 (household mix, trip rates, zone pulls, hourly shares) are made up to show the math. They'll be replaced by real data when the model runs, and should never appear as results in the demo.

**Why estimates are okay:** every professional model has settings like these. Small towns without a travel survey are told to borrow national values and tune them; that's what NCHRP Report 716 is for.

## Why trust it

Four proofs: the method is the standard one, it matches the city's real counts, it still matches counts it never saw, and its results make sense.

### 1. Standard method

The four-step model (trips made → destinations → mode → routes), volume ÷ capacity, and the BPR formula are what planning agencies and state DOTs use. Each step is published and can be checked on its own.

### 2. Matches real counts (calibration)

**Run a 2019 version of Rexburg** to match the counts' age: 2019 population and enrollment, ACS 2015–2019, LODES 2019, roads as they were (2nd East before widening, old US-20 interchange), projects open by 2019. This removes the guessed 2.5% yearly growth.

Then adjust only the labeled estimates (α, β, student car share, local capacity) until the model matches the counts. Never adjust single roads by hand.

**Score each counted road with GEH,** which is fair to both busy and quiet roads:

```latex
\text{GEH} = \sqrt{\frac{2\,(M - C)^2}{M + C}}
```

M = model's hourly cars, C = real count (daily count × the hour's share). Under 5 is a good match; the target is about 85% of counts under 5.

| Example road | Real | Model | Off by | GEH | Result |
| --- | --- | --- | --- | --- | --- |
| Busy road | 1,000 | 1,100 | 10% | 3.1 | Pass |
| Busy road | 1,000 | 1,300 | 30% | 8.8 | Fail |
| Small street | 80 | 120 | 50% | 4.0 | Pass |

Show a scatter plot in planner mode: real counts vs. model, one dot per road, dots close to the diagonal.

### 3. Works on data it never saw (validation)

- **Hold-out counts:** set about 20 of the 89 counts aside while tuning, then score them.
- **Forecast test:** run 2019 forward to 2026 with real projects and roads, and compare with the 5 counts from after 2019.
- **Hourly shape:** tune on daily totals, then check the hours against ITD counter 059.

### 4. Makes sense

- **Local knowledge:** red streets should be the ones locals already complain about.
- **Google Maps spot checks:** compare the model's 5 pm drive time on a few routes with Google's typical time; look only, don't store Google's data.
- **Change tests:** add 1,000 people → traffic rises nearby; close a road → cars shift to parallel roads; Sunday → no morning rush; summer → less traffic near campus.

## Comparing with professional models

With routing built, the atlas follows the same structure as a professional four-step model; the main gaps are local survey data and mode choice. Rexburg already has a professional model to compare against, from the 2015 Madison County / Rexburg / Sugar City Transportation Master Plan.

| Step | Professional model | The atlas (with this plan) | How close |
| --- | --- | --- | --- |
| Trip generation | Rates by household type from a local survey | Rates by household type from NHTS; students by campus rules | Same method, national rates |
| Distribution | Gravity on drive-time tables | LODES real work trips; gravity on drive time for the rest | Same, better work data |
| Mode choice | Logit model (car, bus, walk by time and cost) | Fixed car shares; walk share near campus | Simplified |
| Assignment | Static equilibrium with BPR | Batch assignment with BPR, hour by hour | Similar |
| Validation | Against state counts | Against 89 city counts with hold-out | Same |

Roughly 85–90% of a professional model's structure.

### Ways to compare

1. **Request the county's model:** zones, trip rates, trip tables, base-year volumes, or a newer version.
2. **Compare volumes** road by road for the same base year, scored with GEH.
3. **Compare forecasts:** the 2015 plan lists segments expected over capacity by 2040; check whether the atlas flags the same ones, and explain differences (new projects since 2015).
4. **Compare settings:** swap in the county's local trip rates and β where they exist.
5. **Cross-check the method:** AequilibraE (free Python) runs a standard four-step assignment; similar volumes mean both methods agree.

### Competitors and partners

PTV Vissim, Aimsun, Cube and TransCAD (traffic modeling), Replica and StreetLight (phone and GPS travel data), and Esri ArcGIS Urban (3D city planning) already offer strong models and visuals. 3D alone isn't unique. What's unique here: **AI that reads city records to find approved projects**, and a fast what-if for small cities using free data. A realistic partnership pitch: "We turn city records into growth forecasts you can plug into your models." Check these products' current features before pitching.

## Limits and the demo

Saying what the tool can't do makes planners trust what it can. Comparisons between plans are its most reliable output: errors mostly cancel because both versions share the same assumptions.

| Limit | How we handle it |
| --- | --- |
| Future years are guesses | Low, expected and high scenarios |
| Small streets aren't counted | Show levels (free, busy, congested), not exact numbers |
| Counts are mostly 2016–2019 | Calibrate in 2019; ask the city for newer counts |
| Project locations partly approximate | Mark confidence on each project; load parcels |
| No store-popularity or student travel data | Jobs stand in for popularity; student values tuned |
| Not an intersection or signal-timing study | Say it screens options before a real engineering study |
| Special events (games, move-in week) | Out of scope; future add-on |

### What to say (about 30 seconds)

> "The Rexburg Growth Atlas reads city records to find approved projects, then shows how they'll change traffic hour by hour. It uses the same four-step method planning agencies use, built from Census, LODES and OpenStreetMap data, and we calibrated it to the city's traffic counts: X% pass the standard GEH test, including counts it never saw. Projects and counts are real; future traffic is a what-if model that helps a city narrow its options before paying for an engineering study."

**Show on screen:**

- [ ] Accuracy: GEH result and the counts-vs-model scatter plot
- [ ] 5 pm today vs. 2034, with and without projects
- [ ] Before and after: one project in two locations, and the delay each adds
- [ ] The project register with source quotes (proof the AI reads real records)

**Likely questions:**

| Question | Answer |
| --- | --- |
| How do you know it's right? | It matches the city's counts, including ones it wasn't tuned on |
| What about streets with no counts? | Same trips that match counted roads; shown as levels |
| Where's the data from? | City GIS, OpenStreetMap, Census ACS and LODES, ITD; all public |
| How sure are future years? | Shown as low, expected and high scenarios |
| Other cities? | Every source covers the whole U.S.; the converter takes a new city's files |

## Build plan

About 19 hours were left at 11:30 pm on Nov 13; this list runs about 20, so trim parking and the full 2019 calibration first.

**Routing (about 8 hours)**

- [ ] Add ACS block groups (B08201, B08301) and LODES 2023 and 2019 for Idaho to the converter (1.5 h)
- [ ] Draw 40–60 zones plus campus and gateway zones; build the drive-time table (1.5 h)
- [ ] Trip table: residents by household type, students by campus rules, commercial projects as attractions (1.5 h)
- [ ] Batch assignment with BPR in a Web Worker; through traffic at gateways (2 h)
- [ ] Quick calibration: GEH against the city counts, tune α and β, scatter plot in planner mode (1.5 h)

**Features (about 10 hours)**

- [ ] Problem cards: over-capacity streets, growth outrunning roads, bed and parking gaps (2 h)
- [ ] Road suggestions per project: second access, turn lanes, roundabout, signal timing, ranked by delay saved; include the city's planned fixes such as the ITD US-20 crossings (3 h)
- [ ] Placement heat map: where the next 500 beds or 250 homes add the least delay, using parcels and zoning; keep owner names out (3 h)
- [ ] Parking by zone: spaces vs. student cars, with options like shared church lots, permits or a shuttle (2 h)

**Demo (about 2 hours)**

- [ ] Stage script, limits slide, accuracy slide, saved second city

**Cut first if short on time:** slime-mold road network layer, live scraping of other cities, walkability, full 2019 calibration, SUMO layer. These work as "next steps" in the pitch.

## Open questions

- [ ] Is part of North 2nd East still two lanes? The city lists one widening as completed and another with no date.
- [ ] Can someone email BYU-Idaho Parking Services (parkingservices@byui.edu) for per-lot spaces and permits sold?
- [ ] Does ITD or the city have traffic counts newer than 2019?
- [ ] Which zoning codes allow student housing, and at what density?
- [ ] Can the county share its 2015 Transportation Master Plan model (zones, trip rates, base volumes) or a newer one?
- [ ] Which level-of-service standard does Rexburg or ITD use to call a road congested?
- [ ] What share of students have a car, and how many trips do they make?
- [ ] How much US-20 traffic is just passing through?

## Glossary

| Term | Plain meaning |
| --- | --- |
| AADT | Average cars per day on a road over a year |
| ACS | The Census Bureau's yearly survey of households, cars and commuting |
| Attraction | How strongly a zone pulls trips (jobs, stores, homes) |
| Batch assignment | Loading trips in batches, slowing full roads between batches |
| BPR formula | Federal formula for how much slower a road gets as it fills |
| Calibration | Adjusting a few settings until the model matches real counts |
| Capacity | Most cars a road can carry per hour before backing up |
| GEH | Score for how close the model is to a count; under 5 is good |
| Gravity model | Rule that sends more trips to bigger, closer destinations |
| Hold-out test | Hiding some counts while tuning, then testing on them |
| LODES | Census data on where people live and where they work, by block |
| Level of service | A–F grade planners give roads; E–F is congested |
| NHTS | Federal travel diary survey: trips per household, timing, people per car |
| OSM | OpenStreetMap: free map of every road |
| Through traffic | Cars passing through town without stopping |
| Travel time index | Actual travel time ÷ empty-road time; 1.3 = 30% longer |
| V/C | Volume ÷ capacity: how full a road is; 0.9+ is congested |
| Zone | A small area of town that trips start or end in |

## Sources

**Earlier documents this combines**

- [From neighborhoods to congestion: our traffic model, step by step](https://claude.ai/artifact/9XWuE4Dki8KHe4srEb5z3f)
- [Why our congestion estimates can be trusted](https://claude.ai/artifact/EqjYAAXfzyp2T9tdciTUgh)
- [Rexburg Growth Atlas + traffic model: combined plan](https://claude.ai/artifact/E5Mq9jkEFTNdYhMchn5JRT)
- Rexburg Growth Atlas: Handoff (Ben, Nov 13, 2026), and the atlas files in atlas-hackathon on Ben's Desktop

**Local data**

- Madison County / Rexburg GIS layers: TrafficCount, PED, City Project Details, Road Improvement Projects, parcels (saved by Ben)
- [Madison County / Rexburg / Sugar City Transportation Master Plan, 2015](https://cms2.revize.com/revize/madisoncounty/Document%20center/Departments/Road%20Department/transplan2015.pdf)
- [ITD counter 059, hourly report (Nov 2023)](https://apps.itd.idaho.gov/apps/roadwaydata/059Newdale/2023/23-11nov/P059_Nov23_MonthlyAverageHourlyTrafficReport.pdf)
- [ITD counter 059, annual day-of-week summary (2022)](https://apps.itd.idaho.gov/Apps/roadwaydata/059Newdale/2022/22-annual/P059_2022_AnnualDayOfWeekSummary.pdf)

**Census and national data**

- [LEHD LODES downloads (2002–2023)](https://lehd.ces.census.gov/data)
- [ACS table B08201 in the Census API](https://api.census.gov/data/2023/acs/acs5/variables/B08201_024MA.html)
- [2022 National Household Travel Survey](https://nhts.ornl.gov/)
- [NCHRP Report 716: Travel Demand Forecasting: Parameters and Techniques](https://www.trb.org/main/blurbs/167055.aspx)

**Software**

- [SUMO Dynamic User Assignment](https://sumo.dlr.de/docs/Demand/Dynamic_User_Assignment.html)
- [OSMnx routing, speeds and travel times](https://nbviewer.jupyter.org/github/gboeing/osmnx-examples/blob/main/notebooks/02-routing-speed-time.ipynb)

**Also used (look up current pages):** Census population estimates, ACS B08301, TIGER/Line, 2020 Census PL blocks, ITE Trip Generation Manual, Highway Capacity Manual, FHWA travel model validation guidance, AequilibraE.
