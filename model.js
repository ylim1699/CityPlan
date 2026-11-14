/* Rexburg Growth Atlas: data + model. No DOM in this file.
   Swap PROJECTS / ROADS for the agent's output; the 3D view reads only these shapes. */
(function (G) {
  'use strict';
  var TODAY = 2026.875; // Q4 2026

  /* ---------- City geometry from OpenStreetMap (city-<name>.js sets window.OSM_CITY) ----------
     Coordinates there are integer meters east (x) and south (z) of the origin. 1 scene unit = 200 m. */
  var C = G.OSM_CITY, S = 1 / 200, VEX = 2.5;
  function LL(lat, lon) { return [(lon - C.origin[1]) * C.kx * S, -(lat - C.origin[0]) * C.kz * S]; }
  function M(v) { return [v[0] * S, v[1] * S]; }
  /* Capacity is vehicles per hour per through lane (ASSUMED planning values); daily traffic defaults are ASSUMED
     for streets with no city count. Streets with a city count (2015 or later) use it, grown 2.5% a year to 2026. */
  var CLS = {
    highway:   { lane: 1800, adt: 21500, w: 22, wt: 1.5 },
    arterial:  { lane: 900,  adt: 12000, w: 16, wt: 3 },
    minor:     { lane: 850,  adt: 7000,  w: 13, wt: 2.5 },
    collector: { lane: 700,  adt: 4000,  w: 11, wt: 2 },
    ramp:      { lane: 1400, adt: 3500,  w: 9,  wt: 1.5 },
    local:     { lane: 450,  adt: 500,   w: 8,  wt: 0.5 }
  };
  var ROADS = C.roads.map(function (r, i) {
    var cls = C.cls[r[0]], f = r[4], pts = [], k;
    for (k = 0; k < f.length; k += 2) pts.push([f[k] * S, f[k + 1] * S]);
    var ow = !!r[7], base = r[2] ? r[2] / (ow ? 2 : 1) : CLS[cls].adt / (ow ? 2 : 1);
    return { id: i, name: C.names[r[1]], cls: cls, adt: base, adtBasis: r[2] ? C.names[r[3]] : 'assumed for road type', pts: pts, near: r[5],
      lanes: r[6], oneway: ow, laneBasis: C.names[r[8]], segAdt: r[9], segBasis: r[10] };
  });
  var PLANNED_ROADS = [];
  var PERIODS = {
    am:  { label: 'Morning', share: 0.075 },
    mid: { label: 'Midday',  share: 0.065 },
    pm:  { label: 'Evening', share: 0.095 }
  };
  /* Share of a weekday's traffic in each hour, midnight to 11 pm. ASSUMED typical profile; replace with local counts. */
  var HOURLY = [0.008,0.005,0.004,0.004,0.007,0.018,0.040,0.068,0.075,0.055,0.052,0.057,0.065,0.060,0.060,0.064,0.078,0.095,0.068,0.048,0.036,0.027,0.018,0.011];
  var KEY_HOUR = { am: 8, mid: 12, pm: 17 };
  function hourOf(p) { return typeof p === 'number' ? ((Math.round(p) % 24) + 24) % 24 : KEY_HOUR[p]; }
  function centerMult(c, h) {
    var pts = [[0, 0.8], [6, 0.85], [8, c.m.am], [12, c.m.mid], [17, c.m.pm], [22, 0.85], [24, 0.8]], i;
    for (i = 0; i < pts.length - 1; i++) if (h >= pts[i][0] && h <= pts[i + 1][0]) {
      var f = (h - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    }
    return 0.8;
  }
  var CENTERS = [
    { name: 'campus',   p: M(C.places.campus),  r: 4,   m: { am: 1.3,  mid: 1.1,  pm: 1.05 } },
    { name: 'retail',   p: M(C.places.walmart), r: 4,   m: { am: 0.7,  mid: 1.15, pm: 1.3 } },
    { name: 'downtown', p: [0, 0],              r: 3,   m: { am: 0.95, mid: 1.1,  pm: 1.12 } }
  ];

  /* ---------- Projects: the standard format from the plan ----------
     status: construction | approved | planned.  start/end are decimal years.
     confidence: high (official source, dates stated) | medium (news source or a date assumed) | low (key detail missing). */
  var PROJECTS = [
    { id: 'madison', name: 'Madison Commons', type: 'Mixed use', status: 'construction',
      fid: 'madison', hM: 11, n: 10, phased: true,
      start: 2026.3, end: 2034.0, size: 'About 50 acres, about 250 homes, plus restaurant and retail space',
      units: 250, trips: 1675, tripBasis: '250 homes x 6.7 trips a day. Commercial space not counted: tenants not announced.',
      where: 'West of US-20 at Exit 333 (Main St), toward 12th West',
      plain: 'A new neighborhood of homes, restaurants and shops by the Main Street exit, built in phases.',
      evidence: 'Developer Trellis plans about 250 medium-density homes with restaurant and retail space. First-phase roads and utilities come first; full build-out is expected to take seven to ten years.',
      source: { label: 'East Idaho News, Feb 11 2026', url: 'https://www.eastidahonews.com/2026/02/restaurants-retailers-and-housing-coming-to-new-rexburg-development/' },
      confidence: 'medium', flags: ['Footprint placed between US-20 and 12th West from the article; exact parcel not mapped', 'End date is our reading of "seven to ten years"', 'A hotel and a rec center are under discussion, not confirmed'] },
    { id: 'whiteowl', name: 'White Owl Business Park and Homestead Assisted Living', type: 'Senior living and offices', status: 'construction',
      fid: 'whiteowl', hM: 12, n: 4, phased: true,
      start: 2026.0, end: 2028.5, size: '26 acres; 11 acres for the assisted living campus',
      units: 100, parkRate: 1, trips: 260, tripBasis: 'Assumed 100 beds x 2.6 trips a day. Bed count is not in the source.',
      where: 'West of Walmart on North 2nd East, next to the new temple',
      plain: 'An assisted living campus with apartments and condos, with offices or medical space around it.',
      evidence: 'A 26-acre business park anchored by an assisted living campus with a pool, pickleball courts and a walking trail. Described as already underway.',
      source: { label: 'East Idaho News, Feb 2026', url: 'https://www.eastidahonews.com/2026/02/development-near-new-rexburg-temple-to-include-the-homestead-assisted-living-facility/' },
      confidence: 'low', flags: ['Footprint placed west of the temple from the article; exact parcel not mapped', 'No completion date in the source; 2028 is assumed', 'Number of beds is assumed'] },
    { id: 'temple', name: 'Teton River Idaho Temple', type: 'Place of worship', status: 'construction',
      fid: 'temple', hM: 30, n: 1,
      start: 2024.42, end: 2027.5, size: 'About 130,000 sq ft, three stories',
      trips: 500, tripBasis: 'Assumed 500 trips a day once open. No standard rate fits; replace with a local count.',
      where: '111 Teton River Temple St, north Rexburg',
      plain: 'A second Latter-day Saint temple for Rexburg, on the north end of town.',
      evidence: 'Ground was broken June 1 2024 and construction was expected to take up to three years. Open house and dedication dates have not been announced.',
      source: { label: 'churchofjesuschristtemples.org', url: 'https://churchofjesuschristtemples.org/teton-river-idaho-temple/' },
      confidence: 'medium', flags: ['Opening date not announced; mid-2027 is estimated from the groundbreaking'] },
    { id: 'winco', name: 'WinCo Foods', type: 'Grocery store', status: 'construction', unconfirmed: true,
      fid: 'winco', hM: 9, n: 1,
      start: 2026.0, end: 2027.0, size: '84,000 sq ft on an 11-acre lot',
      trips: 5130, tripBasis: '84,000 sq ft x 94 trips per 1,000 sq ft, less 35% assumed pass-by traffic.',
      where: 'North 2nd East at East Moody Rd',
      plain: 'A fourth large grocery store, on the north end of 2nd East.',
      evidence: 'City documents describe an 84,000-square-foot single-story store on an 11-acre lot at North 2nd East and East Moody Road.',
      source: { label: 'East Idaho News, Jan 2025', url: 'https://www.eastidahonews.com/?p=723620' },
      confidence: 'low', flags: ['Opening status not confirmed. A 2026 land listing already calls it "the new WinCo Foods store", so it may be open', 'Dates are assumed', 'Placed on the northeast side of North 2nd East near 1256 N; exact lot not mapped'] },
    { id: 'sundance', name: 'Sundance student housing addition', type: 'Student housing', status: 'construction',
      fid: 'sundance', hM: 12, n: 2, phased: true,
      start: 2024.7, end: 2026.75, size: 'Two buildings, 220 units (120 women, 100 men)',
      units: 220, trips: 550, tripBasis: '220 units x 2.5 trips a day (low rate assumed inside the walk district).',
      where: 'South Center St, next to the Post Office',
      plain: 'Two new student apartment buildings a short walk from campus.',
      evidence: 'Two buildings with 120 units for women and 100 for men, next to the Post Office. The whole project was slated to finish in fall 2026.',
      source: { label: 'East Idaho News, Sept 2024', url: 'https://www.eastidahonews.com/2024/09/a-construction-project-is-in-the-works-next-to-the-post-office-in-rexburg-heres-what-it-is/' },
      confidence: 'medium', flags: ['Completion in fall 2026 was the plan; not confirmed as finished', 'Beds per unit not stated, so it is not added to the student bed count'] },
    { id: 'library', name: 'McKay Library remodel', type: 'Campus building', status: 'construction',
      fid: 'library', hM: 15, n: 1,
      start: 2024.6, end: 2026.7, size: 'Multi-year remodel in two phases',
      trips: 0, tripBasis: 'No new trips: a remodel of an existing building.',
      where: 'BYU-Idaho campus',
      plain: 'The campus library is being remodeled one wing at a time.',
      evidence: 'Contractors began in August 2024. The university lists 2026 for completion of the first of two phases.',
      source: { label: 'BYU-Idaho campus construction', url: 'https://www.byui.edu/campus-construction-projects/current-projects' },
      confidence: 'high', flags: ['The second phase has no date on the university page'] },
    { id: 'uoss', name: 'University Support Services Building', type: 'Campus building', status: 'construction',
      fid: 'uoss', hM: 9, n: 1,
      start: 2025.1, end: 2027.0, size: 'Warehouse, loading docks, grounds facilities and offices',
      trips: 150, tripBasis: 'Assumed 150 trips a day (staff and deliveries).',
      where: 'Near the substation on University Blvd',
      plain: 'A new warehouse and operations building for the university.',
      evidence: 'A new facility with a warehouse, loading and receiving docks and offices near the substation on University Boulevard. Construction was expected to start in early 2025.',
      source: { label: 'BYU-Idaho campus construction', url: 'https://www.byui.edu/campus-construction-projects/current-projects' },
      confidence: 'medium', flags: ['No completion date on the university page; end of 2026 is assumed', 'Location on University Blvd is approximate'] },
    { id: 'signal', name: '2nd West and 2nd South signal upgrade', type: 'Road work', status: 'approved', unconfirmed: true,
      ll: [43.8218768, -111.7895468], start: 2026.6, end: 2027.3, size: 'New signal cabinet, wiring and sidewalk repair',
      trips: 0, tripBasis: 'No new trips. Model assumes 10% less capacity during work and 8% more after.',
      effects: [{ names: ['South 2nd West', 'North 2nd West', 'West 2nd South', 'East 2nd South'], ll: [43.8218768, -111.7895468], rM: 260, during: 0.9, after: 1.08 }],
      where: '2nd West at 2nd South',
      plain: 'The traffic signal at 2nd West and 2nd South is being rebuilt.',
      evidence: 'The city sought bids, due July 8 2026, for a new cabinet and foundation, new wiring, boring and sidewalk repair at this intersection.',
      source: { label: 'City of Rexburg bid listing', url: 'https://www.idahobids.com/government-agencies/madison/rexburg-city-of-41219/' },
      confidence: 'medium', flags: ['Construction dates are assumed from the bid date'] },
    { id: 'mainst', name: 'Main Street resurfacing (ITD)', type: 'Road work', status: 'construction',
      sid: 'mainst', start: 2026.45, end: 2026.7, size: 'SH-33 Business Spur, Exit 333 to 2nd East',
      trips: 0, tripBasis: 'No new trips. Mostly night work, so the model takes 10% off daytime capacity.',
      effects: [{ names: ['West Main Street', 'East Main Street'], ll: [43.8261, -111.7947], rM: 1500, during: 0.9, after: 1 }],
      where: 'Main St from the US-20 interchange to 2nd East',
      plain: 'Main Street was repaved in summer 2026, mostly at night.',
      evidence: 'Work began June 15 2026, mostly overnight, with street parking removed where crews were working between 2nd East and 4th West.',
      source: { label: 'Idaho Transportation Department, June 12 2026', url: 'https://itd.idaho.gov/news/resurfacing-to-begin-monday-on-sh-33-business-spur-in-rexburg/' },
      confidence: 'high', flags: ['End date is assumed'] },
    { id: 'sewer2e', name: '2nd East sewer line', type: 'Road work', status: 'construction',
      sid: 'sewer2e', start: 2026.62, end: 2026.72, size: '2nd East between Yellowstone Hwy and 7th North',
      trips: 0, tripBasis: 'No new trips. One lane each way during work: model halves capacity.',
      effects: [{ names: ['North 2nd East'], ll: [43.841, -111.77815], rM: 360, during: 0.5, after: 1 }],
      where: '2nd East, Yellowstone Hwy to 7th North',
      plain: 'A sewer line went in under 2nd East in late summer 2026, with lane closures.',
      evidence: 'A three-day full closure from August 16 2026, then one lane each way for about 30 days while the sewer line was installed.',
      source: { label: 'Local News 8, Aug 13 2026', url: 'https://localnews8.com/news/2026/08/13/portion-of-rexburgs-2nd-east-closing-for-construction/' },
      confidence: 'high', flags: [] },
    { id: 'nysewer', name: 'North Yellowstone sewer line', type: 'Utility', status: 'construction',
      sid: 'nysewer', start: 2025.3, end: 2026.95, size: '$9 million line serving Rexburg, Sugar City and Teton',
      trips: 0, tripBasis: 'No traffic effect modeled.',
      where: 'Between Moody Rd and Riverside Park',
      plain: 'An aging sewer main north of town was replaced with a larger one.',
      evidence: 'Under construction since April 2025, the project replaced, realigned and enlarged a line built around 1980. The city reported it nearing completion in November 2026.',
      source: { label: 'City of Rexburg news, Nov 2 2026', url: 'https://www.rexburg.org/news/' },
      confidence: 'high', flags: ['Drawn along North Yellowstone Hwy; the real route is approximate'] }
  ];
  (C.streetplan || []).forEach(function (l) {
    PROJECTS.push({ id: l.id, name: l.name + ' street reconstruction', type: 'Road work', status: l.year <= 2026 ? 'construction' : 'approved',
      lines: l.lines, start: l.year + 0.42, end: l.year + 0.85, size: l.where,
      trips: 0, tripBasis: 'No new trips. Mostly local streets with lane closures, so no capacity change is modeled.',
      where: l.where, plain: 'Planned rebuild of several neighborhood streets in ' + l.year + (l.cost ? ', about $' + (l.cost / 1e6).toFixed(1) + ' million' : '') + '.',
      evidence: l.name + ' is a ' + (l.type || 'street').toLowerCase() + ' project in the city\'s five-year street plan for ' + l.year + (l.cost ? ', estimated at $' + l.cost.toLocaleString('en-US') : '') + '. Streets: ' + l.where + '.',
      source: { label: 'City of Rexburg Road Improvement Projects map', url: 'https://cw.rexburg.org/cwweb/rest/services/PW_Streets/AGOL_ST_RoadImprovementProjects/MapServer' },
      confidence: 'high', flags: ['Construction months are assumed (June to October of the plan year)'] });
  });
  PROJECTS.forEach(function (p) {
    if (p.lines) {
      p.strips = p.lines.map(function (fl) { var o = [], k; for (k = 0; k < fl.length; k += 2) o.push([fl[k] * S, fl[k + 1] * S]); return o; });
      var al = [].concat.apply([], p.strips); p.pos = al[Math.floor(al.length / 2)]; p.h = 0.02;
    }
    if (p.fid) { var f = C.foot[p.fid]; p.pos = M(f[0]); p.foot = [f[1][0] * S, f[1][1] * S]; p.h = p.hM * VEX * S; }
    else if (!p.lines) { p.h = 0.02; }
    if (p.sid) {
      p.strips = C.strips[p.sid].map(function (fl) { var o = [], k; for (k = 0; k < fl.length; k += 2) o.push([fl[k] * S, fl[k + 1] * S]); return o; });
      var all = [].concat.apply([], p.strips); p.pos = all[Math.floor(all.length / 2)];
    }
    if (p.ll) p.pos = LL(p.ll[0], p.ll[1]);
    (p.effects || []).forEach(function (e) { e.near = LL(e.ll[0], e.ll[1]); e.r = e.rM * S; });
  });
  var UNMAPPED = [
    { name: 'The Home Depot', note: 'Planning and Zoning recommended approval of a roughly 40-acre plat in July 2026, with Home Depot buying 10 acres. The source does not say where, so it is not on the map or in the traffic model.',
      source: { label: 'GatherGov meeting summary, July 2026', url: 'https://gathergov.com/municipalities/rexburg-id/development-news' } }
  ];
  var CONTEXT = [
    { name: 'US-20 diverging diamond interchanges (Exits 332 and 333)', note: 'Rebuilt by ITD in 2024. Shown as existing.',
      source: { label: 'City of Rexburg', url: 'https://rexburg.org/page/diverging-diamond-interchanges-itd-project' } }
  ];

  /* ---------- Population: P(t+1) = P + N - L + s*L + g ---------- */
  var POP = {
    S0: 21900,        // students living in Rexburg, fall 2026 (24,111 campus-based x 0.907 share living in town)
    R0: 22100,        // other residents (assumed total 44,000: census ~40k, city estimate ~45k)
    beds0: 22350,     // student beds, fall 2026 (assumed 98% full)
    turnover: 0.25,   // share of students leaving each year
    g: 0.012,         // ordinary resident growth per year
    hh: 3.3,          // people per resident household
    resSupply0: 0.98, // resident housing supply as a share of need, 2026
    back: { 2025: 24450 / 24111, 2024: (24450 / 1.067) / 24111 },
    springFactor: 17326 / 24111
  };
  var DEFAULTS = { enroll: 0.02, stay: 0.06, bedsPerYear: 300, unitsPerYear: 120, carShare: 0.55 };
  /* City profile. collegeTown switches on the student modules (beds, parking). The agent sets it when it finds a campus. */
  var CITY = { name: 'Rexburg, Idaho', collegeTown: true, campus: 'BYU-Idaho',
    parkSpaces0: C.parking.spacesNear, // ROUGH: OpenStreetMap lot area inside the Pedestrian Emphasis District / 30 m2. Not counted, not official.
    parkOfficial: null,                 // BYU-Idaho Parking Services per-lot counts: not published; replace when received
    codeRate: { perUnit: 2, visitor: 0.10 }, // Rexburg Development Code Table 3: multi-family 2 spaces per unit + 10% visitor
    parkLots: C.parking.lotsNear,
    spacesPerNewBed: 0.6 // ASSUMED: spaces that come with each new student bed
  };

  function popSeries(prm) {
    var yrs = {}, S = POP.S0, R = POP.R0, Su = POP.S0, y;
    yrs[2026] = { S: S, R: R, Su: Su, beds: POP.beds0, cap: false };
    for (y = 2026; y < 2036; y++) {
      var beds = POP.beds0 + prm.bedsPerYear * (y + 1 - 2026);
      var Sn = S * (1 + prm.enroll), cap = false;
      Su = Su * (1 + prm.enroll);
      if (Sn > beds) { Sn = beds; cap = true; }
      var L = S * POP.turnover;
      var Rn = R * (1 + POP.g) + prm.stay * L;
      yrs[y + 1] = { S: Sn, R: Rn, Su: Su, beds: beds, cap: cap };
      S = Sn; R = Rn;
    }
    yrs[2025] = { S: POP.S0 * POP.back[2025], R: POP.R0 / (1 + POP.g), Su: POP.S0 * POP.back[2025], beds: POP.beds0, cap: false };
    yrs[2024] = { S: POP.S0 * POP.back[2024], R: POP.R0 / Math.pow(1 + POP.g, 2), Su: POP.S0 * POP.back[2024], beds: POP.beds0, cap: false };
    yrs[2023] = yrs[2024];
    var capYear = null;
    for (y = 2027; y <= 2036; y++) { if (yrs[y].cap) { capYear = y; break; } }
    function at(t) {
      var x = t - 0.75, y0 = Math.floor(x), f = x - y0;
      if (y0 < 2023) { y0 = 2023; f = 0; }
      if (y0 > 2035) { y0 = 2035; f = 1; }
      var a = yrs[y0], b = yrs[y0 + 1], o = {};
      ['S', 'R', 'Su', 'beds'].forEach(function (k) { o[k] = a[k] + (b[k] - a[k]) * f; });
      o.total = o.S + o.R;
      return o;
    }
    return { at: at, years: yrs, capYear: capYear };
  }

  /* ---------- Projects over time ---------- */
  function projState(p, t) {
    if (t >= p.end) return { phase: 'done', progress: 1 };
    if (t >= p.start) return { phase: 'active', progress: (t - p.start) / (p.end - p.start) };
    return { phase: 'future', progress: 0 };
  }
  function projTrips(p, t) {
    if (!p.trips) return 0;
    var s = projState(p, t);
    return p.phased ? p.trips * s.progress : (s.phase === 'done' ? p.trips : 0);
  }
  function byId(id) { for (var i = 0; i < PROJECTS.length; i++) if (PROJECTS[i].id === id) return PROJECTS[i]; return null; }

  /* ---------- Street segments ---------- */
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function ptSeg(p, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    var u = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dz));
  }
  var SEGS = [];
  ROADS.forEach(function (r) {
    r.c = CLS[r.cls];
    for (var i = 0; i < r.pts.length - 1; i++) {
      var a = r.pts[i], b = r.pts[i + 1];
      var counted = r.segAdt[i] > 0;
      SEGS.push({ i: SEGS.length, road: r, a: a, b: b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len: Math.max(0.01, dist(a, b)), near: C.names[r.near[i]] || '',
        adt: counted ? r.segAdt[i] : r.adt, counted: counted, adtBasis: counted ? C.names[r.segBasis[i]] : r.adtBasis, cap0: r.c.lane * r.lanes });
    }
  });

  function inRing(p, ring) {
    var c = false, j = ring.length - 1;
    for (var i = 0; i < ring.length; i++) {
      var a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c;
      j = i;
    }
    return c;
  }
  /* Developer-led widenings the city lists with no date (Project Details map). Off unless the planner assumes them built. */
  var WIDEN = (C.widenings || []).map(function (w) {
    var rings = w.rings.map(function (fl) { var o = [], k; for (k = 0; k < fl.length; k += 2) o.push([fl[k] * S, fl[k + 1] * S]); return o; });
    function nearRing(p, r) { if (inRing(p, r)) return true; for (var k = 0; k < r.length; k++) if (ptSeg(p, r[k], r[(k + 1) % r.length]) < 0.15) return true; return false; }
    var segs = SEGS.filter(function (s) { return s.road.cls !== 'local' && rings.some(function (r) { return nearRing(s.mid, r) || nearRing(s.a, r) || nearRing(s.b, r); }); }).map(function (s) { return s.i; });
    var all = [].concat.apply([], rings), cx = 0, cz = 0;
    all.forEach(function (p) { cx += p[0]; cz += p[1]; });
    return { id: w.id, name: w.name, desc: w.desc, start: w.start, impact: w.impact, rings: rings, segs: segs, pos: [cx / all.length, cz / all.length], factor: 1.8 };
  });
  var WIDEN_SRC = { label: 'City of Rexburg construction map (Project Details layer)', url: 'https://services1.arcgis.com/EiEr2xT4gB5AIOtc/arcgis/rest/services/Project_Details_(view)/FeatureServer' };

  /* ---------- Traffic: share of capacity used on each segment ---------- */
  var K_ROUTE = 7.5; // average trip length near its origin, in scene units (about 1.5 km)
  function dayAvg(mid) {
    var t = 0; for (var h = 0; h < 24; h++) t += HOURLY[h] * activity(mid, h); return t;
  }
  function activity(mid, period) {
    var m = 0;
    CENTERS.forEach(function (c) {
      var d = dist(mid, c.p);
      m = Math.max(m, Math.exp(-(d * d) / (2 * c.r * c.r)) * centerMult(c, hourOf(period)));
    });
    return 0.72 + 0.55 * m;
  }
  function traffic(t, period, o) {
    o = o || {};
    var pop = o.pop || popSeries(DEFAULTS);
    var tp = o.withProjects === false ? Math.min(t, TODAY) : t;
    var now = pop.at(t), sem = o.spring ? POP.springFactor : 1;
    var popF = (now.R + now.S * sem) / (POP.R0 + POP.S0);
    var share = HOURLY[hourOf(period)];
    var add = SEGS.map(function () { return 0; });
    PROJECTS.forEach(function (p) {
      var dT = projTrips(p, tp) - projTrips(p, TODAY);
      if (!dT) return;
      var w = p._w || (p._w = SEGS.map(function (s) { var d = dist(s.mid, p.pos); return d > 4.5 ? 0 : s.road.c.wt * Math.exp(-(d * d) / 8); }));
      var sum = p._ws || (p._ws = w.reduce(function (x, y, i) { return x + y * SEGS[i].len; }, 0));
      if (!sum) return;
      w.forEach(function (x, i) { if (x) add[i] += dT * share * K_ROUTE * x / sum; });
    });
    var out = SEGS.map(function (s, i) {
      var cap = s.cap0;
      if (o.widen) o.widen.forEach(function (wid) { var w = WIDEN_BY[wid]; if (w && w.set[s.i]) cap *= w.factor; });
      PROJECTS.forEach(function (p) {
        if (!p.effects) return;
        var st = projState(p, tp);
        if (st.phase === 'future') return;
        p.effects.forEach(function (e) {
          if (e.names.indexOf(s.road.name) >= 0 && dist(s.mid, e.near) <= e.r) cap *= (st.phase === 'active' ? e.during : e.after);
        });
      });
      (o.fixes || []).forEach(function (f) {
        if (f.road === s.road.name && dist(s.mid, f.at) <= 1.6) cap *= f.factor;
      });
      if (s.dAvg == null) s.dAvg = dayAvg(s.mid);
      var vol = Math.max(0, s.adt * HOURLY[hourOf(period)] * activity(s.mid, period) / s.dAvg * popF + add[i]);
      return { vol: vol, cap: cap, vc: vol / cap };
    });
    return out;
  }
  var WIDEN_BY = {};
  WIDEN.forEach(function (w) { w.set = {}; w.segs.forEach(function (i) { w.set[i] = 1; }); WIDEN_BY[w.id] = w; });
  function level(vc) {
    if (vc >= 1) return { key: 4, label: 'Over capacity' };
    if (vc >= 0.85) return { key: 3, label: 'Heavy' };
    if (vc >= 0.7) return { key: 2, label: 'Busy' };
    if (vc >= 0.5) return { key: 1, label: 'Steady' };
    return { key: 0, label: 'Light' };
  }
  function hotspots(res, base, n) {
    var best = {};
    res.forEach(function (r, i) {
      var id = SEGS[i].road.name;
      if (!id || SEGS[i].road.cls === 'local') return;
      if (!best[id] || r.vc > best[id].vc) best[id] = { seg: SEGS[i], vc: r.vc, delta: base ? r.vc - base[i].vc : 0 };
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.vc - a.vc; }).slice(0, n || 5);
  }
  function roadShareOver(res, lim) {
    var tot = 0, over = 0;
    res.forEach(function (r, i) { if (SEGS[i].road.cls === 'local') return; tot += SEGS[i].len; if (r.vc >= lim) over += SEGS[i].len; });
    return over / tot;
  }
  function gaps(t, prm, pop) {
    pop = pop || popSeries(prm);
    var p = pop.at(t), mad = byId('madison');
    var need = p.R / POP.hh;
    var supply = (POP.R0 / POP.hh) * POP.resSupply0 + mad.units * projState(mad, t).progress + prm.unitsPerYear * Math.max(0, t - TODAY);
    return {
      pop: p,
      beds: { supply: p.beds, need: p.Su, ratio: p.beds / p.Su, short: Math.max(0, p.Su - p.beds) },
      homes: { supply: supply, need: need, ratio: supply / need, short: Math.max(0, need - supply) },
      parking: CITY.collegeTown ? (function () {
        var pn = p.S * prm.carShare, ps = CITY.parkSpaces0 + Math.max(0, p.beds - POP.beds0) * CITY.spacesPerNewBed;
        return { supply: ps, need: pn, ratio: ps / pn, short: Math.max(0, pn - ps) };
      })() : null
    };
  }

  G.ATLAS = { TODAY: TODAY, CLS: CLS, ROADS: ROADS, PLANNED_ROADS: PLANNED_ROADS, PERIODS: PERIODS, PROJECTS: PROJECTS,
    UNMAPPED: UNMAPPED, CONTEXT: CONTEXT, CITY: CITY, WIDEN: WIDEN, WIDEN_SRC: WIDEN_SRC, OSM: C, S: S, VEX: VEX, LL: LL, M: M, HOURLY: HOURLY, POP: POP, DEFAULTS: DEFAULTS, SEGS: SEGS, popSeries: popSeries, projState: projState,
    projTrips: projTrips, traffic: traffic, level: level, hotspots: hotspots, roadShareOver: roadShareOver, gaps: gaps, ptSeg: ptSeg, byId: byId };
})(typeof window !== 'undefined' ? window : globalThis);
