/* Rexburg Growth Atlas: data + model. No DOM in this file. Ported from legacy/model.js with the same logic;
   city geometry and projects are passed in instead of read from window globals. */
import type { OsmCity, Project, ProjectsFile, Params, Fix, SegResult, XZ } from './types';

export const TODAY = 2026.875; // Q4 2026
export const S = 1 / 200, VEX = 2.5; // 1 scene unit = 200 m; buildings drawn 2.5x taller

/* Capacity is vehicles per hour per through lane (ASSUMED planning values); daily traffic defaults are ASSUMED
   for streets with no city count. Streets with a city count (2015 or later) use it, grown 2.5% a year to 2026. */
export const CLS: Record<string, { lane: number; adt: number; w: number; wt: number }> = {
  highway:   { lane: 1800, adt: 21500, w: 22, wt: 1.5 },
  arterial:  { lane: 900,  adt: 12000, w: 16, wt: 3 },
  minor:     { lane: 850,  adt: 7000,  w: 13, wt: 2.5 },
  collector: { lane: 700,  adt: 4000,  w: 11, wt: 2 },
  ramp:      { lane: 1400, adt: 3500,  w: 9,  wt: 1.5 },
  local:     { lane: 450,  adt: 500,   w: 8,  wt: 0.5 }
};
export const PERIODS = {
  am:  { label: 'Morning', share: 0.075 },
  mid: { label: 'Midday',  share: 0.065 },
  pm:  { label: 'Evening', share: 0.095 }
};
/* Share of a weekday's traffic in each hour, midnight to 11 pm. ASSUMED typical profile; replace with local counts. */
export const HOURLY = [0.008,0.005,0.004,0.004,0.007,0.018,0.040,0.068,0.075,0.055,0.052,0.057,0.065,0.060,0.060,0.064,0.078,0.095,0.068,0.048,0.036,0.027,0.018,0.011];
const KEY_HOUR: Record<string, number> = { am: 8, mid: 12, pm: 17 };
export function hourOf(p: number | string) { return typeof p === 'number' ? ((Math.round(p) % 24) + 24) % 24 : KEY_HOUR[p]; }

/* ---------- Population: P(t+1) = P + N - L + s*L + g ---------- */
export const POP = {
  S0: 21900,        // students living in Rexburg, fall 2026 (24,111 campus-based x 0.907 share living in town)
  R0: 22100,        // other residents (assumed total 44,000: census ~40k, city estimate ~45k)
  beds0: 22350,     // student beds, fall 2026 (assumed 98% full)
  turnover: 0.25,   // share of students leaving each year
  g: 0.012,         // ordinary resident growth per year
  hh: 3.3,          // people per resident household
  resSupply0: 0.98, // resident housing supply as a share of need, 2026
  back: { 2025: 24450 / 24111, 2024: (24450 / 1.067) / 24111 } as Record<number, number>,
  springFactor: 17326 / 24111
};
export const DEFAULTS: Params = { enroll: 0.02, stay: 0.06, bedsPerYear: 300, unitsPerYear: 120, carShare: 0.55, S0: POP.S0, R0: POP.R0, resGrowth: POP.g };

export type PopYear = { S: number; R: number; Su: number; beds: number; cap: boolean };
export type PopAt = { S: number; R: number; Su: number; beds: number; total: number };
export type PopSeries = { at: (t: number) => PopAt; years: Record<number, PopYear>; capYear: number | null };

export function popSeries(prm: Params): PopSeries {
  const yrs: Record<number, PopYear> = {};
  const beds0 = POP.beds0 * prm.S0 / POP.S0;  // beds scale with the students who live in them (same 98% full)
  let S_ = prm.S0, R = prm.R0, Su = prm.S0, y: number;
  yrs[2026] = { S: S_, R, Su, beds: beds0, cap: false };
  for (y = 2026; y < 2036; y++) {
    const beds = beds0 + prm.bedsPerYear * (y + 1 - 2026);
    let Sn = S_ * (1 + prm.enroll), cap = false;
    Su = Su * (1 + prm.enroll);
    if (Sn > beds) { Sn = beds; cap = true; }
    const L = S_ * POP.turnover;
    const Rn = R * (1 + prm.resGrowth) + prm.stay * L;
    yrs[y + 1] = { S: Sn, R: Rn, Su, beds, cap };
    S_ = Sn; R = Rn;
  }
  yrs[2025] = { S: prm.S0 * POP.back[2025], R: prm.R0 / (1 + prm.resGrowth), Su: prm.S0 * POP.back[2025], beds: beds0, cap: false };
  yrs[2024] = { S: prm.S0 * POP.back[2024], R: prm.R0 / Math.pow(1 + prm.resGrowth, 2), Su: prm.S0 * POP.back[2024], beds: beds0, cap: false };
  yrs[2023] = yrs[2024];
  let capYear: number | null = null;
  for (y = 2027; y <= 2036; y++) { if (yrs[y].cap) { capYear = y; break; } }
  function at(t: number): PopAt {
    const x = t - 0.75; let y0 = Math.floor(x), f = x - y0;
    if (y0 < 2023) { y0 = 2023; f = 0; }
    if (y0 > 2035) { y0 = 2035; f = 1; }
    const a = yrs[y0], b = yrs[y0 + 1], o: any = {};
    (['S', 'R', 'Su', 'beds'] as const).forEach(k => { o[k] = a[k] + (b[k] - a[k]) * f; });
    o.total = o.S + o.R;
    return o;
  }
  return { at, years: yrs, capYear };
}

/* ---------- Projects over time ---------- */
export type ProjPhase = { phase: 'done' | 'active' | 'future'; progress: number };
export function projState(p: Project, t: number): ProjPhase {
  if (t >= p.end) return { phase: 'done', progress: 1 };
  if (t >= p.start) return { phase: 'active', progress: (t - p.start) / (p.end - p.start) };
  return { phase: 'future', progress: 0 };
}
export function projTrips(p: Project, t: number) {
  if (!p.trips) return 0;
  const s = projState(p, t);
  return p.phased ? p.trips * s.progress : (s.phase === 'done' ? p.trips : 0);
}

export function dist(a: XZ, b: XZ) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
export function ptSeg(p: XZ, a: XZ, b: XZ) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let u = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dz));
}
function inRing(p: XZ, ring: XZ[]) {
  let c = false, j = ring.length - 1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c;
    j = i;
  }
  return c;
}
function flat(fl: number[]): XZ[] { const o: XZ[] = []; for (let k = 0; k < fl.length; k += 2) o.push([fl[k] * S, fl[k + 1] * S]); return o; }

export function level(vc: number) {
  if (vc >= 1) return { key: 4, label: 'Over capacity' };
  if (vc >= 0.85) return { key: 3, label: 'Heavy' };
  if (vc >= 0.7) return { key: 2, label: 'Busy' };
  if (vc >= 0.5) return { key: 1, label: 'Steady' };
  return { key: 0, label: 'Light' };
}

export type Road = { id: number; name: string; cls: string; adt: number; adtBasis: string; pts: XZ[]; near: number[]; lanes: number; oneway: boolean;
  laneBasis: string; segAdt: number[]; segBasis: number[]; mph: number; mphTagged: boolean; c: typeof CLS[string] };
export type Seg = { i: number; road: Road; a: XZ; b: XZ; mid: XZ; len: number; near: string; adt: number; counted: boolean; adtBasis: string; cap0: number; dAvg?: number };
export type Widening = { id: string; name: string; desc: string; start: string | null; impact: string | null; rings: XZ[][]; segs: number[]; pos: XZ; factor: number; set: Record<number, 1> };
export type TrafficOpts = { pop?: PopSeries; withProjects?: boolean; spring?: boolean; widen?: string[]; fixes?: Fix[]; volumes?: Float64Array | number[] | null };

export function createAtlas(C: OsmCity, PF: ProjectsFile) {
  function LL(lat: number, lon: number): XZ { return [(lon - C.origin[1]) * C.kx * S, -(lat - C.origin[0]) * C.kz * S]; }
  function M(v: XZ): XZ { return [v[0] * S, v[1] * S]; }
  /* scene position back to [lat, lon] (inverse of LL), for projects a reviewer places on the map */
  function toLL(p: XZ): [number, number] { return [C.origin[0] - p[1] / (C.kz * S), C.origin[1] + p[0] / (C.kx * S)]; }

  const ROADS: Road[] = C.roads.map((r, i) => {
    const cls = C.cls[r[0]], f = r[4], pts: XZ[] = [];
    for (let k = 0; k < f.length; k += 2) pts.push([f[k] * S, f[k + 1] * S]);
    const ow = !!r[7], base = r[2] ? r[2] / (ow ? 2 : 1) : CLS[cls].adt / (ow ? 2 : 1);
    return { id: i, name: C.names[r[1]], cls, adt: base, adtBasis: r[2] ? C.names[r[3]] : 'assumed for road type', pts, near: r[5],
      lanes: r[6], oneway: ow, laneBasis: C.names[r[8]], segAdt: r[9], segBasis: r[10], mph: r[11], mphTagged: !!r[12], c: CLS[cls] };
  });
  function centerMult(c: any, h: number) {
    const pts = [[0, 0.8], [6, 0.85], [8, c.m.am], [12, c.m.mid], [17, c.m.pm], [22, 0.85], [24, 0.8]];
    for (let i = 0; i < pts.length - 1; i++) if (h >= pts[i][0] && h <= pts[i + 1][0]) {
      const f = (h - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    }
    return 0.8;
  }
  const CENTERS = [
    { name: 'campus',   p: M(C.places.campus),  r: 4, m: { am: 1.3,  mid: 1.1,  pm: 1.05 } },
    { name: 'retail',   p: M(C.places.walmart), r: 4, m: { am: 0.7,  mid: 1.15, pm: 1.3 } },
    { name: 'downtown', p: [0, 0] as XZ,        r: 3, m: { am: 0.95, mid: 1.1,  pm: 1.12 } }
  ];

  /* ---------- Projects: the standard format from the plan ----------
     status: construction | approved | planned.  start/end are decimal years.
     confidence: high (official source, dates stated) | medium (news source or a date assumed) | low (key detail missing). */
  const PROJECTS: Project[] = PF.projects.map(p => JSON.parse(JSON.stringify(p)));
  (C.streetplan || []).forEach(l => {
    PROJECTS.push({ id: l.id, name: l.name + ' street reconstruction', type: 'Road work', status: l.year <= 2026 ? 'construction' : 'approved',
      lines: l.lines, start: l.year + 0.42, end: l.year + 0.85, size: l.where,
      trips: 0, tripBasis: 'No new trips. Mostly local streets with lane closures, so no capacity change is modeled.',
      where: l.where, plain: 'Planned rebuild of several neighborhood streets in ' + l.year + (l.cost ? ', about $' + (l.cost / 1e6).toFixed(1) + ' million' : '') + '.',
      evidence: l.name + ' is a ' + (l.type || 'street').toLowerCase() + ' project in the city\'s five-year street plan for ' + l.year + (l.cost ? ', estimated at $' + l.cost.toLocaleString('en-US') : '') + '. Streets: ' + l.where + '.',
      source: { label: 'City of Rexburg Road Improvement Projects map', url: 'https://cw.rexburg.org/cwweb/rest/services/PW_Streets/AGOL_ST_RoadImprovementProjects/MapServer' },
      confidence: 'high', flags: ['Construction months are assumed (June to October of the plan year)'], foundBy: 'person', reviewed: true });
  });
  PROJECTS.forEach(p => {
    if (p.lines) {
      p.strips = p.lines.map(flat);
      const al = ([] as XZ[]).concat(...p.strips); p.pos = al[Math.floor(al.length / 2)]; p.h = 0.02;
    }
    if (p.fid) { const f = C.foot[p.fid]; p.pos = M(f[0]); p.foot = [f[1][0] * S, f[1][1] * S]; p.h = p.hM! * VEX * S; }
    else if (p.footM) { p.foot = [p.footM[0] * S, p.footM[1] * S]; p.h = (p.hM || 10) * VEX * S; }
    else if (!p.lines) { p.h = 0.02; }
    if (p.sid) {
      p.strips = C.strips[p.sid].map(flat);
      const all = ([] as XZ[]).concat(...p.strips); p.pos = all[Math.floor(all.length / 2)];
    }
    if (p.ll) p.pos = LL(p.ll[0], p.ll[1]);
    (p.effects || []).forEach(e => { e.near = LL(e.ll[0], e.ll[1]); e.r = e.rM * S; });
  });
  function byId(id: string) { for (let i = 0; i < PROJECTS.length; i++) if (PROJECTS[i].id === id) return PROJECTS[i]; return null; }

  /* City profile. collegeTown switches on the student modules (beds, parking). The agent sets it when it finds a campus. */
  const CITY = { name: 'Rexburg, Idaho', collegeTown: true, campus: 'BYU-Idaho',
    parkSpaces0: C.parking.spacesNear, // ROUGH: OpenStreetMap lot area inside the Pedestrian Emphasis District / 30 m2. Not counted, not official.
    parkOfficial: null as number | null, // BYU-Idaho Parking Services per-lot counts: not published; replace when received
    codeRate: { perUnit: 2, visitor: 0.10 }, // Rexburg Development Code Table 3: multi-family 2 spaces per unit + 10% visitor
    parkLots: C.parking.lotsNear,
    spacesPerNewBed: 0.6 // ASSUMED: spaces that come with each new student bed
  };

  /* ---------- Street segments ---------- */
  const SEGS: Seg[] = [];
  ROADS.forEach(r => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], counted = r.segAdt[i] > 0;
      SEGS.push({ i: SEGS.length, road: r, a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len: Math.max(0.01, dist(a, b)), near: C.names[r.near[i]] || '',
        adt: counted ? r.segAdt[i] : r.adt, counted, adtBasis: counted ? C.names[r.segBasis[i]] : r.adtBasis, cap0: r.c.lane * r.lanes });
    }
  });

  /* Developer-led widenings the city lists with no date (Project Details map). Off unless the planner assumes them built. */
  const WIDEN: Widening[] = (C.widenings || []).map(w => {
    const rings = w.rings.map(flat);
    function nearRing(p: XZ, r: XZ[]) { if (inRing(p, r)) return true; for (let k = 0; k < r.length; k++) if (ptSeg(p, r[k], r[(k + 1) % r.length]) < 0.15) return true; return false; }
    const segs = SEGS.filter(s => s.road.cls !== 'local' && rings.some(r => nearRing(s.mid, r) || nearRing(s.a, r) || nearRing(s.b, r))).map(s => s.i);
    const all = ([] as XZ[]).concat(...rings); let cx = 0, cz = 0;
    all.forEach(p => { cx += p[0]; cz += p[1]; });
    const set: Record<number, 1> = {}; segs.forEach(i => { set[i] = 1; });
    return { id: w.id, name: w.name, desc: w.desc, start: w.start, impact: w.impact, rings, segs, pos: [cx / all.length, cz / all.length] as XZ, factor: 1.8, set };
  });
  const WIDEN_BY: Record<string, Widening> = {};
  WIDEN.forEach(w => { WIDEN_BY[w.id] = w; });
  const WIDEN_SRC = { label: 'City of Rexburg construction map (Project Details layer)', url: 'https://services1.arcgis.com/EiEr2xT4gB5AIOtc/arcgis/rest/services/Project_Details_(view)/FeatureServer' };

  /* ---------- Traffic: share of capacity used on each segment ---------- */
  const K_ROUTE = 7.5; // average trip length near its origin, in scene units (about 1.5 km)
  function activity(mid: XZ, period: number | string) {
    let m = 0;
    CENTERS.forEach(c => {
      const d = dist(mid, c.p);
      m = Math.max(m, Math.exp(-(d * d) / (2 * c.r * c.r)) * centerMult(c, hourOf(period)));
    });
    return 0.72 + 0.55 * m;
  }
  function dayAvg(mid: XZ) { let t = 0; for (let h = 0; h < 24; h++) t += HOURLY[h] * activity(mid, h); return t; }

  /* Capacity on each segment after widenings, road work and tested fixes. Shared by both volume methods. */
  function capacities(tp: number, o: TrafficOpts) {
    return SEGS.map(s => {
      let cap = s.cap0;
      if (o.widen) o.widen.forEach(wid => { const w = WIDEN_BY[wid]; if (w && w.set[s.i]) cap *= w.factor; });
      PROJECTS.forEach(p => {
        if (!p.effects) return;
        const st = projState(p, tp);
        if (st.phase === 'future') return;
        p.effects.forEach(e => {
          if (e.names.indexOf(s.road.name) >= 0 && dist(s.mid, e.near!) <= e.r!) cap *= (st.phase === 'active' ? e.during : e.after);
        });
      });
      (o.fixes || []).forEach(f => { if (f.road === s.road.name && dist(s.mid, f.at) <= 1.6) cap *= f.factor; });
      return cap;
    });
  }

  /* Count-based method (before routing): count x hourly share x activity, plus project trips near each project.
     When o.volumes is given (routed hourly volumes per segment), those replace the count-based volumes. */
  function traffic(t: number, period: number | string, o: TrafficOpts = {}): SegResult[] {
    const pop = o.pop || popSeries(DEFAULTS);
    const tp = o.withProjects === false ? Math.min(t, TODAY) : t;
    const caps = capacities(tp, o);
    if (o.volumes) { const v = o.volumes; return SEGS.map((s, i) => ({ vol: v[i], cap: caps[i], vc: v[i] / caps[i] })); }
    const now = pop.at(t), sem = o.spring ? POP.springFactor : 1;
    const popF = (now.R + now.S * sem) / (POP.R0 + POP.S0);
    const share = HOURLY[hourOf(period)];
    const add = SEGS.map(() => 0);
    PROJECTS.forEach(p => {
      const dT = projTrips(p, tp) - projTrips(p, TODAY);
      if (!dT) return;
      const w = p._w || (p._w = SEGS.map(s => { const d = dist(s.mid, p.pos!); return d > 4.5 ? 0 : s.road.c.wt * Math.exp(-(d * d) / 8); }));
      const sum = p._ws || (p._ws = w.reduce((x, y, i) => x + y * SEGS[i].len, 0));
      if (!sum) return;
      w.forEach((x, i) => { if (x) add[i] += dT * share * K_ROUTE * x / sum; });
    });
    return SEGS.map((s, i) => {
      if (s.dAvg == null) s.dAvg = dayAvg(s.mid);
      const vol = Math.max(0, s.adt * HOURLY[hourOf(period)] * activity(s.mid, period) / s.dAvg * popF + add[i]);
      return { vol, cap: caps[i], vc: vol / caps[i] };
    });
  }
  function hotspots(res: SegResult[], base: SegResult[] | null, n?: number) {
    const best: Record<string, { seg: Seg; vc: number; delta: number }> = {};
    res.forEach((r, i) => {
      const id = SEGS[i].road.name;
      if (!id || SEGS[i].road.cls === 'local') return;
      if (!best[id] || r.vc > best[id].vc) best[id] = { seg: SEGS[i], vc: r.vc, delta: base ? r.vc - base[i].vc : 0 };
    });
    return Object.keys(best).map(k => best[k]).sort((a, b) => b.vc - a.vc).slice(0, n || 5);
  }
  function roadShareOver(res: SegResult[], lim: number) {
    let tot = 0, over = 0;
    res.forEach((r, i) => { if (SEGS[i].road.cls === 'local') return; tot += SEGS[i].len; if (r.vc >= lim) over += SEGS[i].len; });
    return over / tot;
  }
  function gaps(t: number, prm: Params, pop?: PopSeries) {
    pop = pop || popSeries(prm);
    const p = pop.at(t), mad = byId('madison')!;
    const need = p.R / POP.hh;
    const supply = (POP.R0 / POP.hh) * POP.resSupply0 + mad.units! * projState(mad, t).progress + prm.unitsPerYear * Math.max(0, t - TODAY);
    return {
      pop: p,
      beds: { supply: p.beds, need: p.Su, ratio: p.beds / p.Su, short: Math.max(0, p.Su - p.beds) },
      homes: { supply, need, ratio: supply / need, short: Math.max(0, need - supply) },
      parking: CITY.collegeTown ? (() => {
        const pn = p.S * prm.carShare, ps = CITY.parkSpaces0 + Math.max(0, p.beds - pop!.years[2026].beds) * CITY.spacesPerNewBed;
        return { supply: ps, need: pn, ratio: ps / pn, short: Math.max(0, pn - ps) };
      })() : null
    };
  }

  return { TODAY, CLS, ROADS, PERIODS, PROJECTS, UNMAPPED: PF.unmapped, CONTEXT: PF.context, CITY, WIDEN, WIDEN_SRC, OSM: C, S, VEX, LL, M, toLL, HOURLY, POP, DEFAULTS, SEGS,
    popSeries, projState, projTrips, traffic, capacities, level, hotspots, roadShareOver, gaps, ptSeg, byId };
}
export type Atlas = ReturnType<typeof createAtlas>;
