/* Steps 4–8 of the plan: trips from every zone, destinations, hourly table, batch routing with BPR.
   Pure functions, no DOM: runs in the routing worker, in Vitest and in scripts/calibrate.ts.
   Volumes come out per street segment in the same shape as Atlas.traffic(), so the 3D view and panels don't change. */
import { HOURLY, POP, TODAY, type Atlas } from './atlas';
import type { Fix, Params } from './types';

export type GraphFile = { nodes: number[]; edges: [number, number, number, number, number, number, number, number][] };
export type ZoneAcs = { drive: number; occ: number; wfh: number; walk: number; vehPerHH: number; zeroCar: number };
export type Zone = { id: string; kind: 'town' | 'campus' | 'gateway'; share?: number; x: number; z: number; node: number; nodes?: number[]; acs?: ZoneAcs; residents: number; students: number; workers: number;
  jobs: { retail: number; edu: number; other: number }; inPed: boolean; road?: string; aadt?: number };
export type ZonesFile = { zones: Zone[]; work: [number, number, number][]; acsCounty?: { drive: number; occ: number; wfh: number; walk: number } };
export type Calib = { alpha: number; beta: number; studentTrips: number; throughShare: number };
export const CALIB0: Calib = { alpha: 1, beta: 0.1, studentTrips: 3, throughShare: 0.5 };

/* Rates (ESTIMATES unless noted; replace with ACS B08201 / B08301 and NHTS values when the Census key is in) */
export const RATES = {
  personTrips: 3.0,   // person trips per resident per day (NHTS 2022 national average is about 3)
  wfh: 0.08,          // share of workers working from home on a given day
  driveWork: 0.80,    // share of commuters who drive
  occWork: 1.10,      // people per car on the commute
  driveOther: 0.60,   // share of other trips by car (plan doc d_o)
  occOther: 1.5,      // people per car for other trips (NHTS)
  nhbShare: 0.25,     // not-home-based share of person trips
  studentOcc: 1.3,    // people per car, students
  toCampus: 0.70,     // share of student car trips to campus
  hhSize: 3.3,        // people per resident household
  attr: { retail: 4, other: 1, edu: 1, hh: 0.5 }  // attraction weights per job / household
};
export const BATCHES = [0.4, 0.3, 0.2, 0.1];
/* hourly.json from scripts/build_hourly.py (ITD counter 059); without it the atlas's assumed profile is used */
export type HourlyFile = { weekday: number[]; saturday: number[]; sunday: number[]; dayFactor: { weekday: number; saturday: number; sunday: number } };

export type Scenario = { t: number; hour: number; withProjects: boolean; prm: Params; spring: boolean; widen: string[]; fixes: Fix[];
  closed?: number[]; extra?: { zone: number; students?: number; residents?: number }[]; day?: 'weekday' | 'saturday' | 'sunday';
  rev?: string };  /* rev: which confirmed agent projects are loaded; only part of the cache key */
export type RouteResult = { vol: Float64Array; tti: Float64Array; vht: number; trips: number; through: number };

/* Binary heap keyed on float distances (node ids as payload) */
class Heap {
  k: number[] = []; v: number[] = [];
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!, n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}

export function bpr(t0: number, v: number, c: number) { const x = v / c; return t0 * (1 + 0.15 * x * x * x * x); }
export function geh(m: number, c: number) { return m + c > 0 ? Math.sqrt(2 * (m - c) * (m - c) / (m + c)) : 0; }

export function createRouter(A: Atlas, G: GraphFile, Z: ZonesFile, calib: Calib = CALIB0, hourly?: HourlyFile | null) {
  /* share of the day's trips in an hour, times how busy that kind of day is (Step 6) */
  const shareAt = (hour: number, day: Scenario['day'] = 'weekday') => hourly ? hourly[day][hour] * hourly.dayFactor[day] : HOURLY[hour];
  const nNodes = G.nodes.length / 2, zones = Z.zones, nz = zones.length;
  /* Directed links: forward for every edge, backward unless one-way */
  const L = { from: [] as number[], to: [] as number[], t0: [] as number[], edge: [] as number[], s0: [] as number[], s1: [] as number[] };
  G.edges.forEach((e, i) => {
    const t0 = e[5] / e[6];
    L.from.push(e[0]); L.to.push(e[1]); L.t0.push(t0); L.edge.push(i); L.s0.push(e[3]); L.s1.push(e[4]);
    if (!e[7]) { L.from.push(e[1]); L.to.push(e[0]); L.t0.push(t0); L.edge.push(i); L.s0.push(e[3]); L.s1.push(e[4]); }
  });
  const nL = L.from.length;
  const zn = zones.map(z => z.nodes && z.nodes.length ? z.nodes : [z.node]);
  const out: number[][] = Array.from({ length: nNodes }, () => []);
  for (let l = 0; l < nL; l++) out[L.from[l]].push(l);
  const dirShare = (l: number) => G.edges[L.edge[l]][7] ? 1 : 0.5;

  /* Shortest paths from one node; returns predecessor link per node */
  const dist = new Float64Array(nNodes), pred = new Int32Array(nNodes);
  function dijkstra(src: number | number[], cost: Float64Array) {
    dist.fill(Infinity); pred.fill(-1);
    const h = new Heap();
    for (const s of Array.isArray(src) ? src : [src]) { dist[s] = 0; h.push(0, s); }
    while (h.size) {
      const u = h.pop(), du = dist[u];
      const ol = out[u];
      for (let k = 0; k < ol.length; k++) {
        const l = ol[k], c = cost[l]; if (c === Infinity) continue;
        const nd = du + c, w = L.to[l];
        if (nd < dist[w]) { dist[w] = nd; pred[w] = l; h.push(nd, w); }
      }
    }
  }

  /* Free-flow zone-to-zone drive times in minutes (the skim used by the gravity model) */
  const free = Float64Array.from(L.t0);
  const skim = new Float64Array(nz * nz);
  zones.forEach((zi, i) => {
    dijkstra(zi.node, free);
    zones.forEach((zj, j) => { skim[i * nz + j] = i === j ? 1.5 : (dist[zj.node] === Infinity ? 999 : dist[zj.node] / 60 + 1); });
  });

  const town = zones.map((z, i) => z.kind !== 'gateway' ? i : -1).filter(i => i >= 0);
  /* Campus is several zones (one per side, by parking lot area); class trips are shared by their share */
  const campus = zones.map((z, i) => z.kind === 'campus' ? i : -1).filter(i => i >= 0);
  const campusXZ = [0, 0]; campus.forEach(c => { campusXZ[0] += zones[c].x * zones[c].share!; campusXZ[1] += zones[c].z * zones[c].share!; });
  const R0z = zones.reduce((s, z) => s + z.residents, 0) || 1;
  /* Projects: housing adds people to its zone; everything else with trips adds attraction */
  function zoneAt(pos: [number, number]) {
    let best = -1, bd = Infinity;
    town.forEach(i => { const z = zones[i], d = Math.hypot(z.x * A.S - pos[0], z.z * A.S - pos[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  const projZone: Record<string, number> = {};
  A.PROJECTS.forEach(p => { if (p.pos && p.trips) projZone[p.id] = zoneAt(p.pos); });
  const workRows: Record<number, [number, number][]> = {};
  Z.work.forEach(([h, w, n]) => { (workRows[h] = workRows[h] || []).push([w, n]); });

  /* Daily car trips, origin x destination (both legs of each round trip included) */
  function tripTable(sc: Scenario) {
    const tp = sc.withProjects ? sc.t : Math.min(sc.t, TODAY);
    const pop = A.popSeries(sc.prm).at(sc.t), sem = sc.spring ? POP.springFactor : 1;
    const R = new Float64Array(nz), S_ = new Float64Array(nz), Aj = new Float64Array(nz), OD = new Float64Array(nz * nz);
    /* Background growth comes from the population model; known projects come on top of it, as in the count-based method
       (the plan's double-counting note: the background rate is the "growth only" scenario). */
    zones.forEach((z, i) => { R[i] = z.residents * pop.R / R0z; S_[i] = z.students * pop.S * sem / POP.S0; });
    const visits: [number, number][] = [];
    A.PROJECTS.forEach(p => {
      const zi = projZone[p.id]; if (zi == null || zi < 0) return;
      const pr = A.projState(p, tp).progress, done = p.phased ? pr : (pr >= 1 ? 1 : 0);
      if (p.units) R[zi] += p.units * done * (p.parkRate ? 1 : RATES.hhSize);
      else if (p.beds && /student/i.test(p.type)) S_[zi] += p.beds * done;
      else if (p.trips) { Aj[zi] += p.trips * done; visits.push([zi, p.trips * done]); }
    });
    (sc.extra || []).forEach(e => { if (e.students) S_[e.zone] += e.students; if (e.residents) R[e.zone] += e.residents; });
    const at = RATES.attr;
    town.forEach(j => { const z = zones[j]; Aj[j] += at.retail * z.jobs.retail + at.other * z.jobs.other + at.edu * z.jobs.edu + at.hh * R[j] / RATES.hhSize; });
    const beta = calib.beta;
    function gravity(i: number, trips: number, half: boolean) {
      if (trips <= 0) return;
      let sum = 0; for (const j of town) sum += Aj[j] * Math.exp(-beta * skim[i * nz + j]);
      if (!sum) return;
      for (const j of town) {
        const v = trips * Aj[j] * Math.exp(-beta * skim[i * nz + j]) / sum;
        if (half) { OD[i * nz + j] += v / 2; OD[j * nz + i] += v / 2; } else OD[i * nz + j] += v;
      }
    }
    const carW = RATES.driveWork / RATES.occWork, carO = RATES.driveOther / RATES.occOther;
    let nhbTotal = 0;
    const cty = Z.acsCounty;
    zones.forEach((z, i) => {
      if (z.kind === 'gateway') return;
      const grow = z.residents > 0 ? R[i] / (z.residents || 1) : 1;
      /* commute mode from the zone's ACS block group when available (real); other trips follow the zone's drive share
         relative to the county (ASSUMED: places where people walk to work also walk more for errands) */
      const a = z.acs, wfh = a ? a.wfh : RATES.wfh, cw = a ? a.drive / a.occ : carW;
      const co = a && cty ? carO * Math.min(1.2, Math.max(0.6, a.drive / cty.drive)) : carO;
      const W = 2 * z.workers * grow * (1 - wfh), PT = R[i] * RATES.personTrips, NHB = PT * RATES.nhbShare, HBO = Math.max(0, PT - W - NHB);
      /* work: LODES home-to-work shares */
      const rows = workRows[i] || []; let tot = 0; rows.forEach(r => { tot += r[1]; });
      if (tot) rows.forEach(([j, n]) => { if (j === i) return; const v = W * cw * n / tot; OD[i * nz + j] += v / 2; OD[j * nz + i] += v / 2; });
      gravity(i, HBO * co, true);
      nhbTotal += NHB * co;
      /* students: campus rules */
      const d = Math.hypot(z.x - campusXZ[0], z.z - campusXZ[1]), m = z.inPed ? 0.25 : d < 2500 ? 0.5 : 0.7;
      const ST = S_[i] * calib.studentTrips * sc.prm.carShare * m / RATES.studentOcc;
      campus.forEach(c => { if (c === i) return; const v = ST * RATES.toCampus * zones[c].share! / 2; OD[i * nz + c] += v; OD[c * nz + i] += v; });
      gravity(i, ST * (1 - RATES.toCampus), true);
    });
    /* commuters living outside town: gateway -> job zone and back (LODES) */
    zones.forEach((z, g) => {
      if (z.kind !== 'gateway') return;
      const wfhC = cty ? cty.wfh : RATES.wfh, cwC = cty ? cty.drive / cty.occ : carW;
      (workRows[g] || []).forEach(([j, n]) => { const v = 2 * n * (1 - wfhC) * cwC; OD[g * nz + j] += v / 2; OD[j * nz + g] += v / 2; });
    });
    /* stores, temple, offices: their own daily car trips, to and from homes by the gravity rule */
    visits.forEach(([zi, n]) => gravity(zi, n, true));
    /* not-home-based trips start where the jobs and stores are */
    let jsum = 0; town.forEach(i => { const z = zones[i]; jsum += z.jobs.retail + z.jobs.other; });
    if (jsum) town.forEach(i => { const z = zones[i]; gravity(i, nhbTotal * (z.jobs.retail + z.jobs.other) / jsum, false); });
    for (let k = 0; k < OD.length; k++) OD[k] *= calib.alpha;
    /* Gateways: traffic counted there minus the model's local trips is outside traffic (Step 7).
       On highways half of it passes straight through (ASSUMED); the rest, and all of it on smaller roads,
       is people from outside town coming in (shopping, school, errands), spread by the gravity rule. */
    const ext = zones.map((z, g) => {
      if (z.kind !== 'gateway') return 0;
      let loc = 0; for (let j = 0; j < nz; j++) loc += OD[g * nz + j] + OD[j * nz + g];
      return Math.max(0, (z.aadt || 0) - loc);
    });
    const hw = zones.map((z, i) => z.kind === 'gateway' && (z.aadt || 0) >= 10000 ? i : -1).filter(i => i >= 0);
    const thr = hw.map(g => ext[g] * calib.throughShare);
    const tsum = thr.reduce((a, b) => a + b, 0); let through = 0;
    hw.forEach((g, a) => hw.forEach((h, b) => { if (a === b || !tsum) return; const v = thr[a] * thr[b] / tsum / 2; OD[g * nz + h] += v; through += v; }));
    zones.forEach((z, g) => { if (ext[g]) gravity(g, ext[g] * (hw.includes(g) ? 1 - calib.throughShare : 1), true); });
    let trips = 0; for (let k = 0; k < OD.length; k++) trips += OD[k];
    return { OD, trips, through };
  }

  /* Hourly assignment: 4 batches, fastest paths on current times, BPR after each batch */
  function assign(OD: Float64Array, hour: number, caps: number[], closed?: number[], day?: Scenario['day']): RouteResult {
    const share = shareAt(hour, day);
    const capL = new Float64Array(nL), V = new Float64Array(nL), cost = Float64Array.from(L.t0);
    for (let l = 0; l < nL; l++) {
      let c = Infinity; for (let s = L.s0[l]; s < L.s1[l]; s++) c = Math.min(c, caps[s]);
      capL[l] = Math.max(1, c * dirShare(l));
    }
    const shut = new Set(closed || []);
    if (shut.size) for (let l = 0; l < nL; l++) if (shut.has(L.edge[l])) cost[l] = Infinity;
    for (const f of BATCHES) {
      for (let i = 0; i < nz; i++) {
        let any = false; for (let j = 0; j < nz; j++) if (i !== j && OD[i * nz + j] > 0) { any = true; break; }
        if (!any) continue;
        dijkstra(zn[i], cost);  /* from all of the zone's street points; each trip leaves by the quickest one */
        for (let j = 0; j < nz; j++) {
          if (i === j) continue;
          const v0 = OD[i * nz + j] * share * f; if (v0 <= 0) continue;
          const ends = zn[j].filter(n => dist[n] !== Infinity), v = v0 / (ends.length || 1);
          for (let n of ends) while (dist[n] > 0) { const l = pred[n]; if (l < 0) break; V[l] += v; n = L.from[l]; }
        }
      }
      for (let l = 0; l < nL; l++) if (cost[l] !== Infinity) cost[l] = bpr(L.t0[l], V[l], capL[l]);
    }
    const nS = A.SEGS.length, vol = new Float64Array(nS), tti = new Float64Array(nS).fill(1);
    let vht = 0;
    for (let l = 0; l < nL; l++) {
      if (cost[l] !== Infinity) vht += V[l] * cost[l] / 3600;
      const r = cost[l] === Infinity ? 1 : cost[l] / L.t0[l];
      for (let s = L.s0[l]; s < L.s1[l]; s++) { vol[s] += V[l]; if (r > tti[s]) tti[s] = r; }
    }
    return { vol, tti, vht, trips: 0, through: 0 };
  }

  function run(sc: Scenario): RouteResult {
    const tp = sc.withProjects ? sc.t : Math.min(sc.t, TODAY);
    const caps = A.capacities(tp, { widen: sc.widen, fixes: sc.fixes });
    const tt = tripTable(sc), r = assign(tt.OD, sc.hour, caps, sc.closed, sc.day);
    r.trips = tt.trips; r.through = tt.through;
    return r;
  }

  /* Calibration score at one hour: GEH per counted street segment (count grown to 2026 x that hour's share) */
  function score(vol: Float64Array, hour: number) {
    const pts = A.OSM.counts.pts;
    return pts.filter(p => p[4] != null && p[4]! < A.SEGS.length).map((p, k) => {
      const s = A.SEGS[p[4]!], c = (p[5] ?? p[2]) * shareAt(hour) / (s.road.oneway ? 2 : 1), m = vol[p[4]!];
      return { k, seg: p[4]!, count: c, model: m, geh: geh(m, c), year: p[3], road: s.road.name };
    });
  }

  return { zones, links: L, nLinks: nL, skim, tripTable, assign, run, score, zoneAt, calib, shareAt };
}
export type Router = ReturnType<typeof createRouter>;
