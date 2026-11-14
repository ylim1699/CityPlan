/* Steps 4–8 of the plan: trips from every zone, destinations, hourly table, batch routing with BPR.
   Pure functions, no DOM: runs in the routing worker, in Vitest and in scripts/calibrate.ts.
   Volumes come out per street segment in the same shape as Atlas.traffic(), so the 3D view and panels don't change. */
import { HOURLY, POP, TODAY, type Atlas } from './atlas';
import type { Fix, Params, XZ } from './types';

export type GraphFile = { nodes: number[]; edges: [number, number, number, number, number, number, number, number][] };
export type ZoneAcs = { drive: number; occ: number; wfh: number; walk: number; vehPerHH: number; zeroCar: number };
export type Zone = { id: string; kind: 'town' | 'campus' | 'gateway'; share?: number; shop?: boolean; name?: string; x: number; z: number; node: number; nodes?: number[]; acs?: ZoneAcs; residents: number; students: number; workers: number;
  jobs: { retail: number; edu: number; other: number; food?: number }; inPed: boolean; road?: string; aadt?: number };
export type ZonesFile = { zones: Zone[]; work: [number, number, number][]; stores?: [string, 'shop' | 'food', number, number][]; acsCounty?: { drive: number; occ: number; wfh: number; walk: number } };
/* shopping numbers typed in the Shopping filter: daily arrivals at a store zone, and trips from given zones (by zone id) */
export type ShopEdit = { total?: number; from?: Record<string, number> };
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
  shopShare: 0.4,     // share of home-based other trips that are shopping (ASSUMED; NHTS puts shopping and errands near 40%)
  walmartShare: 0.6,  // share of those shopping trips that go to Walmart, from every zone (ASSUMED: it is where most of town shops)
  attr: { retail: 4, food: 4, other: 1, edu: 1, hh: 0.5 }  // attraction weights per job / household (food: restaurants, ASSUMED to pull like stores)
};
export const BATCHES = [0.4, 0.3, 0.2, 0.1];
/* Planner additions, ported from the UI sandbox's router.js:
   planned projects become their own small zones (trips leave from the site), and new roads can be added for one run. */
export type PlanSite = { id: string; pos: XZ; beds?: number; units?: number; attract?: number };
export type NewRoad = { id: string; plan?: string; from?: number; to: number; lenM: number; cls?: keyof typeof NEW_ROAD };
/* new links: capacity per lane per hour, lanes, speed in m/s (ASSUMED planning values) */
export const NEW_ROAD = { collector: { lane: 700, lanes: 2, speed: 15.6 }, local: { lane: 450, lanes: 2, speed: 11.2 }, drive: { lane: 900, lanes: 2, speed: 9 } };
const RANK: Record<string, number> = { local: 0, ramp: 1, collector: 2, minor: 3, arterial: 4, highway: 5 };
const WORKER_SHARE = 0.48;  /* ASSUMED: employed residents per resident in a new neighborhood (no LODES rows for it) */
/* hourly.json from scripts/build_hourly.py (ITD counter 059); without it the atlas's assumed profile is used */
export type HourlyFile = { weekday: number[]; saturday: number[]; sunday: number[]; dayFactor: { weekday: number; saturday: number; sunday: number } };

export type Scenario = { t: number; hour: number; withProjects: boolean; prm: Params; spring: boolean; widen: string[]; fixes: Fix[];
  closed?: number[]; extra?: { zone: number; students?: number; residents?: number; trips?: number }[]; day?: 'weekday' | 'saturday' | 'sunday';
  plans?: PlanSite[]; roads?: NewRoad[];
  rev?: string; data?: string; shops?: Record<string, ShopEdit> };  /* rev: which confirmed agent projects are loaded; data: which data-file numbers; only part of the cache key */
export type RouteResult = { vol: Float64Array; tti: Float64Array; vht: number; trips: number; through: number;
  planTrips?: number[]; planNode?: number[]; roadVol?: Record<string, { vol: number; vc: number }>; zone?: ZoneStats;
  /* daily car trips arriving at each shop zone, by the zone they leave from (the Shopping filter) */
  flows?: { zone: number; from: Float32Array }[] };
/* per zone for the trip-zone map layer: residents and students in the scenario year, daily car trips leaving and
   arriving (trips within the zone are not routed, so not counted), and the hour's share of the day */
export type ZoneStats = { res: Float64Array; stu: Float64Array; out: Float64Array; in: Float64Array; share: number; hour: number };

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

  type Links = typeof L;
  /* Shortest paths over a set of links; returns predecessor link per node */
  function makeDij(nN: number, Lk: Links, outk: number[][]) {
    const dist = new Float64Array(nN), pred = new Int32Array(nN);
    function run(src: number | number[], cost: Float64Array) {
      dist.fill(Infinity); pred.fill(-1);
      const h = new Heap();
      for (const s of Array.isArray(src) ? src : [src]) { dist[s] = 0; h.push(0, s); }
      while (h.size) {
        const u = h.pop(), du = dist[u];
        const ol = outk[u];
        for (let k = 0; k < ol.length; k++) {
          const l = ol[k], c = cost[l]; if (c === Infinity) continue;
          const nd = du + c, w = Lk.to[l];
          if (nd < dist[w]) { dist[w] = nd; pred[w] = l; h.push(nd, w); }
        }
      }
    }
    return { run, dist, pred };
  }
  const dijB = makeDij(nNodes, L, out), dist = dijB.dist, dijkstra = dijB.run;

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
  /* the Walmart shop zone (build_zones.py names it from OpenStreetMap), else the shop zone nearest the store */
  const wm = A.OSM.places.walmart, shops = zones.map((z, i) => z.shop ? i : -1).filter(i => i >= 0);
  const walmart = shops.find(i => /walmart/i.test(zones[i].name || '')) ?? (wm && shops.length ? shops.reduce((b, i) => Math.hypot(zones[i].x - wm[0], zones[i].z - wm[1]) < Math.hypot(zones[b].x - wm[0], zones[b].z - wm[1]) ? i : b) : -1);
  const zoneIdx = new Map(zones.map((z, i) => [z.id, i] as [string, number]));
  const workRows: Record<number, [number, number][]> = {};
  Z.work.forEach(([h, w, n]) => { (workRows[h] = workRows[h] || []).push([w, n]); });

  /* ---- Planner additions: the busiest kind of road at each node, so new roads join real streets ---- */
  const nodeXZ = (n: number): XZ => [G.nodes[2 * n] * A.S, G.nodes[2 * n + 1] * A.S];
  const nodeRank = new Int8Array(nNodes), nodeName: string[] = new Array(nNodes).fill('');
  G.edges.forEach(e => {
    const r = A.ROADS[e[2]]; if (!r) return; const k = RANK[r.cls] || 0;
    [e[0], e[1]].forEach(n => { if (k >= nodeRank[n]) { nodeRank[n] = k; nodeName[n] = r.name; } });
  });
  function nearestNode(pos: XZ, minRank = 0, skip?: Record<number, 1>) {
    let best = -1, bd = Infinity;
    for (let n = 0; n < nNodes; n++) {
      if (minRank && nodeRank[n] < minRank) continue; if (skip && skip[n]) continue;
      const x = G.nodes[2 * n] * A.S - pos[0], z = G.nodes[2 * n + 1] * A.S - pos[1], d = x * x + z * z;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  type Net = { nN: number; L: Links; nL: number; dij: ReturnType<typeof makeDij>; cap: Record<number, number>;
    plans: { p: PlanSite; node: number; drive: number }[]; roadLinks: Record<string, number[]> };
  const baseNet: Net = { nN: nNodes, L, nL, dij: dijB, cap: {}, plans: [], roadLinks: {} };
  /* One scenario's network: base links + a node and driveway for each planned site + new roads */
  function buildNet(sc: Scenario): Net {
    const plans = sc.plans || [], roads = sc.roads || [];
    if (!plans.length && !roads.length) return baseNet;
    const Ln: Links = { from: L.from.slice(), to: L.to.slice(), t0: L.t0.slice(), edge: L.edge.slice(), s0: L.s0.slice(), s1: L.s1.slice() };
    const cap: Record<number, number> = {}, roadLinks: Record<string, number[]> = {}, P: Net['plans'] = [];
    let nN = nNodes;
    function addLink(a: number, b: number, lenM: number, kind: keyof typeof NEW_ROAD, tag: string) {
      const k = NEW_ROAD[kind] || NEW_ROAD.collector, t0 = lenM / k.speed;
      for (const [x, y] of [[a, b], [b, a]]) {
        const id = Ln.from.length; Ln.from.push(x); Ln.to.push(y); Ln.t0.push(t0); Ln.edge.push(-1); Ln.s0.push(0); Ln.s1.push(0);
        cap[id] = k.lane * k.lanes * 0.5;
        (roadLinks[tag] = roadLinks[tag] || []).push(id);
      }
    }
    plans.forEach(p => {
      const node = nN++, dn = nearestNode(p.pos), q = nodeXZ(dn);
      addLink(node, dn, Math.max(40, Math.hypot(q[0] - p.pos[0], q[1] - p.pos[1]) / A.S * 1.25), 'drive', 'drive:' + p.id);
      P.push({ p, node, drive: dn });
    });
    const nodeOf: Record<string, number> = {}; P.forEach(q => { nodeOf[q.p.id] = q.node; });
    roads.forEach(r => {
      const a = r.plan != null ? nodeOf[r.plan] : r.from;
      if (a == null || r.to == null) return;
      addLink(a, r.to, r.lenM, r.cls || 'collector', r.id);
    });
    const outN: number[][] = Array.from({ length: nN }, () => []);
    for (let k = 0; k < Ln.from.length; k++) outN[Ln.from[k]].push(k);
    return { nN, L: Ln, nL: Ln.from.length, dij: makeDij(nN, Ln, outN), cap, plans: P, roadLinks };
  }

  /* Daily car trips, origin x destination (both legs of each round trip included) */
  function tripTable(sc: Scenario, net: Net = baseNet) {
    /* planned sites (sc.plans) are extra zones numbered after the Census zones */
    const np = net.plans.length, NZ = nz + np;
    const skP: Float64Array[] = [];
    if (np) {  /* drive-time rows for each site: one free-flow search from it, assumed the same both ways */
      const fr = Float64Array.from(net.L.t0), d = net.dij.dist;
      net.plans.forEach(q => {
        net.dij.run(q.node, fr);
        const row = new Float64Array(NZ);
        for (let j = 0; j < nz; j++) row[j] = d[zones[j].node] === Infinity ? 999 : d[zones[j].node] / 60 + 1;
        net.plans.forEach((q2, m) => { row[nz + m] = q2 === q ? 1.5 : (d[q2.node] === Infinity ? 999 : d[q2.node] / 60 + 1); });
        skP.push(row);
      });
    }
    const sk = (i: number, j: number) => i < nz && j < nz ? skim[i * nz + j] : i >= nz ? skP[i - nz][j] : skP[j - nz][i];
    const dest = np ? town.concat(net.plans.map((_, m) => nz + m)) : town;
    const tp = sc.withProjects ? sc.t : Math.min(sc.t, TODAY);
    const pop = A.popSeries(sc.prm).at(sc.t), sem = sc.spring ? POP.springFactor : 1;
    const R = new Float64Array(NZ), S_ = new Float64Array(NZ), Aj = new Float64Array(NZ), OD = new Float64Array(NZ * NZ);
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
    /* extra.trips: daily car trips of a planned store or office (Planner ghosts), handled like a project's visits */
    (sc.extra || []).forEach(e => { if (e.students) S_[e.zone] += e.students; if (e.residents) R[e.zone] += e.residents; if (e.trips) { Aj[e.zone] += e.trips; visits.push([e.zone, e.trips]); } });
    net.plans.forEach((q, m) => {
      const k = nz + m, p = q.p;
      if (p.units) R[k] += p.units * RATES.hhSize;
      if (p.beds) S_[k] += p.beds;
      if (p.attract) { Aj[k] += p.attract; visits.push([k, p.attract]); }
    });
    const at = RATES.attr;
    town.forEach(j => { const z = zones[j]; Aj[j] += at.retail * z.jobs.retail + at.food * (z.jobs.food || 0) + at.other * z.jobs.other + at.edu * z.jobs.edu + at.hh * R[j] / RATES.hhSize; });
    net.plans.forEach((_, m) => { Aj[nz + m] += at.hh * R[nz + m] / RATES.hhSize; });
    const beta = calib.beta;
    function gravity(i: number, trips: number, half: boolean) {
      if (trips <= 0) return;
      let sum = 0; for (const j of dest) sum += Aj[j] * Math.exp(-beta * sk(i, j));
      if (!sum) return;
      for (const j of dest) {
        const v = trips * Aj[j] * Math.exp(-beta * sk(i, j)) / sum;
        if (half) { OD[i * NZ + j] += v / 2; OD[j * NZ + i] += v / 2; } else OD[i * NZ + j] += v;
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
      if (tot) rows.forEach(([j, n]) => { if (j === i) return; const v = W * cw * n / tot; OD[i * NZ + j] += v / 2; OD[j * NZ + i] += v / 2; });
      const toW = walmart >= 0 && walmart !== i ? HBO * co * RATES.shopShare * RATES.walmartShare : 0;
      if (toW) { OD[i * NZ + walmart] += toW / 2; OD[walmart * NZ + i] += toW / 2; }
      gravity(i, HBO * co - toW, true);
      nhbTotal += NHB * co;
      /* students: campus rules */
      const d = Math.hypot(z.x - campusXZ[0], z.z - campusXZ[1]), m = z.inPed ? 0.25 : d < 2500 ? 0.5 : 0.7;
      const ST = S_[i] * calib.studentTrips * sc.prm.carShare * m / RATES.studentOcc;
      campus.forEach(c => { if (c === i) return; const v = ST * RATES.toCampus * zones[c].share! / 2; OD[i * NZ + c] += v; OD[c * NZ + i] += v; });
      gravity(i, ST * (1 - RATES.toCampus), true);
    });
    /* planned sites: a new neighborhood's work trips go to jobs by the gravity rule (no LODES rows for it yet);
       students follow the campus rules, walking more within about 1.2 km of campus */
    net.plans.forEach((q, m) => {
      const k = nz + m, x = q.p.pos[0] / A.S, z = q.p.pos[1] / A.S;
      if (R[k]) {
        const wfh = cty ? cty.wfh : RATES.wfh, cw = cty ? cty.drive / cty.occ : carW;
        const W = 2 * R[k] * WORKER_SHARE * (1 - wfh), PT = R[k] * RATES.personTrips, NHB = PT * RATES.nhbShare, HBO = Math.max(0, PT - W - NHB);
        gravity(k, W * cw, true); gravity(k, HBO * carO, true); nhbTotal += NHB * carO;
      }
      if (S_[k]) {
        const d = Math.hypot(x - campusXZ[0], z - campusXZ[1]), mm = d < 1200 ? 0.25 : d < 2500 ? 0.5 : 0.7;
        const ST = S_[k] * calib.studentTrips * sc.prm.carShare * mm / RATES.studentOcc;
        campus.forEach(c => { const v = ST * RATES.toCampus * zones[c].share! / 2; OD[k * NZ + c] += v; OD[c * NZ + k] += v; });
        gravity(k, ST * (1 - RATES.toCampus), true);
      }
    });
    /* commuters living outside town: gateway -> job zone and back (LODES) */
    zones.forEach((z, g) => {
      if (z.kind !== 'gateway') return;
      const wfhC = cty ? cty.wfh : RATES.wfh, cwC = cty ? cty.drive / cty.occ : carW;
      (workRows[g] || []).forEach(([j, n]) => { const v = 2 * n * (1 - wfhC) * cwC; OD[g * NZ + j] += v / 2; OD[j * NZ + g] += v / 2; });
    });
    /* stores, temple, offices: their own daily car trips, to and from homes by the gravity rule */
    visits.forEach(([zi, n]) => gravity(zi, n, true));
    /* not-home-based trips start where the jobs and stores are */
    let jsum = 0; town.forEach(i => { const z = zones[i]; jsum += z.jobs.retail + (z.jobs.food || 0) + z.jobs.other; });
    if (jsum) town.forEach(i => { const z = zones[i]; gravity(i, nhbTotal * (z.jobs.retail + (z.jobs.food || 0) + z.jobs.other) / jsum, false); });
    for (let k = 0; k < OD.length; k++) OD[k] *= calib.alpha;
    /* Gateways: traffic counted there minus the model's local trips is outside traffic (Step 7).
       On highways half of it passes straight through (ASSUMED); the rest, and all of it on smaller roads,
       is people from outside town coming in (shopping, school, errands), spread by the gravity rule. */
    const ext = zones.map((z, g) => {
      if (z.kind !== 'gateway') return 0;
      let loc = 0; for (let j = 0; j < NZ; j++) loc += OD[g * NZ + j] + OD[j * NZ + g];
      return Math.max(0, (z.aadt || 0) - loc);
    });
    const hw = zones.map((z, i) => z.kind === 'gateway' && (z.aadt || 0) >= 10000 ? i : -1).filter(i => i >= 0);
    const thr = hw.map(g => ext[g] * calib.throughShare);
    const tsum = thr.reduce((a, b) => a + b, 0); let through = 0;
    hw.forEach((g, a) => hw.forEach((h, b) => { if (a === b || !tsum) return; const v = thr[a] * thr[b] / tsum / 2; OD[g * NZ + h] += v; through += v; }));
    zones.forEach((z, g) => { if (ext[g]) gravity(g, ext[g] * (hw.includes(g) ? 1 - calib.throughShare : 1), true); });
    /* shopping numbers typed in the Shopping filter (sc.shops), applied last so it shows exactly what was typed:
       the store's daily arrivals scale every trip to it, then a number for one area replaces the trips from there;
       the trips home change by the same amount */
    for (const [sid, e] of Object.entries(sc.shops || {})) {
      const j = zoneIdx.get(sid); if (j == null) continue;
      const set = (i: number, n: number) => { const d = n - OD[i * NZ + j]; OD[i * NZ + j] = n; OD[j * NZ + i] = Math.max(0, OD[j * NZ + i] + d); };
      if (e.total != null) {
        let cur = 0; for (let i = 0; i < nz; i++) if (i !== j) cur += OD[i * NZ + j];
        const f = cur ? e.total / cur : 0;
        for (let i = 0; i < nz; i++) if (i !== j) set(i, OD[i * NZ + j] * f);
      }
      Object.entries(e.from || {}).forEach(([oid, n]) => { const i = zoneIdx.get(oid); if (i != null && i !== j) set(i, Math.max(0, n)); });
    }
    let trips = 0; for (let k = 0; k < OD.length; k++) trips += OD[k];
    const planTrips = net.plans.map((_, m) => { const k = nz + m; let t = 0; for (let j = 0; j < NZ; j++) t += OD[k * NZ + j] + OD[j * NZ + k]; return t; });
    const zout = new Float64Array(nz), zin = new Float64Array(nz);
    for (let i = 0; i < nz; i++) for (let j = 0; j < NZ; j++) if (i !== j) { zout[i] += OD[i * NZ + j]; if (j < nz) zin[j] += OD[i * NZ + j]; }
    for (let m = nz; m < NZ; m++) for (let j = 0; j < nz; j++) zin[j] += OD[m * NZ + j];  /* trips from planned sites */
    return { OD, trips, through, planTrips, zone: { res: R.slice(0, nz), stu: S_.slice(0, nz), out: zout, in: zin } };
  }

  /* Hourly assignment: 4 batches, fastest paths on current times, BPR after each batch.
     net (optional) adds planned sites and new roads; OD then also has a row and column per planned site. */
  function assign(OD: Float64Array, hour: number, caps: number[], closed?: number[], day?: Scenario['day'], net: Net = baseNet): RouteResult {
    const share = shareAt(hour, day), Lk = net.L, nLk = net.nL, NZ = Math.round(Math.sqrt(OD.length));
    const capL = new Float64Array(nLk), V = new Float64Array(nLk), cost = Float64Array.from(Lk.t0);
    for (let l = 0; l < nLk; l++) {
      if (Lk.edge[l] < 0) { capL[l] = net.cap[l]; continue; }  /* a new road or driveway */
      let c = Infinity; for (let s = Lk.s0[l]; s < Lk.s1[l]; s++) c = Math.min(c, caps[s]);
      capL[l] = Math.max(1, c * (G.edges[Lk.edge[l]][7] ? 1 : 0.5));
    }
    const shut = new Set(closed || []);
    if (shut.size) for (let l = 0; l < nLk; l++) if (Lk.edge[l] >= 0 && shut.has(Lk.edge[l])) cost[l] = Infinity;
    const ZN = net.plans.length ? zn.concat(net.plans.map(q => [q.node])) : zn;
    const dist = net.dij.dist, pred = net.dij.pred;
    for (const f of BATCHES) {
      for (let i = 0; i < NZ; i++) {
        let any = false; for (let j = 0; j < NZ; j++) if (i !== j && OD[i * NZ + j] > 0) { any = true; break; }
        if (!any) continue;
        net.dij.run(ZN[i], cost);  /* from all of the zone's street points; each trip leaves by the quickest one */
        for (let j = 0; j < NZ; j++) {
          if (i === j) continue;
          const v0 = OD[i * NZ + j] * share * f; if (v0 <= 0) continue;
          const ends = ZN[j].filter(n => dist[n] !== Infinity), v = v0 / (ends.length || 1);
          for (let n of ends) while (dist[n] > 0) { const l = pred[n]; if (l < 0) break; V[l] += v; n = Lk.from[l]; }
        }
      }
      for (let l = 0; l < nLk; l++) if (cost[l] !== Infinity) cost[l] = bpr(Lk.t0[l], V[l], capL[l]);
    }
    const nS = A.SEGS.length, vol = new Float64Array(nS), tti = new Float64Array(nS).fill(1);
    let vht = 0;
    for (let l = 0; l < nLk; l++) {
      if (cost[l] !== Infinity) vht += V[l] * cost[l] / 3600;
      if (Lk.edge[l] < 0) continue;
      const r = cost[l] === Infinity ? 1 : cost[l] / Lk.t0[l];
      for (let s = Lk.s0[l]; s < Lk.s1[l]; s++) { vol[s] += V[l]; if (r > tti[s]) tti[s] = r; }
    }
    /* busiest direction of each new road and driveway */
    const roadVol: Record<string, { vol: number; vc: number }> = {};
    Object.keys(net.roadLinks).forEach(k => { let mx = 0, cp = 1; net.roadLinks[k].forEach(id => { if (V[id] > mx) { mx = V[id]; cp = capL[id]; } }); roadVol[k] = { vol: mx, vc: mx / cp }; });
    return { vol, tti, vht, trips: 0, through: 0, roadVol };
  }

  function run(sc: Scenario): RouteResult {
    const tp = sc.withProjects ? sc.t : Math.min(sc.t, TODAY);
    const caps = A.capacities(tp, { widen: sc.widen, fixes: sc.fixes });
    const net = buildNet(sc), tt = tripTable(sc, net), r = assign(tt.OD, sc.hour, caps, sc.closed, sc.day, net);
    r.trips = tt.trips; r.through = tt.through; r.planTrips = tt.planTrips; r.planNode = net.plans.map(q => q.drive);
    r.zone = { ...tt.zone, share: shareAt(sc.hour, sc.day), hour: sc.hour };
    const NZ = Math.round(Math.sqrt(tt.OD.length));
    r.flows = shops.map(j => ({ zone: j, from: Float32Array.from({ length: nz }, (_, i) => i === j ? 0 : tt.OD[i * NZ + j]) }));
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

  /* worst load on a main street within rad (scene units) of pos */
  function localWorst(sc: Scenario, vol: Float64Array, pos: XZ, rad: number) {
    const tp = sc.withProjects ? sc.t : Math.min(sc.t, TODAY), caps = A.capacities(tp, { widen: sc.widen, fixes: sc.fixes });
    let w = { vc: 0, name: '' };
    A.SEGS.forEach((s, i) => {
      if (s.road.cls === 'local' || Math.hypot(s.mid[0] - pos[0], s.mid[1] - pos[1]) > rad) return;
      const vc = vol[i] / caps[i]; if (vc > w.vc) w = { vc, name: s.road.name };
    });
    return w;
  }
  /* end points for new roads: the nearest street node in each of 8 directions within rad, preferring bigger streets */
  function sinksAround(pos: XZ, rad: number, skip?: Record<number, 1>) {
    const best: Record<number, { node: number; pos: XZ; d: number; score: number; name: string }> = {};
    for (let n = 0; n < nNodes; n++) {
      if (skip && skip[n]) continue;
      const p = nodeXZ(n), dx = p[0] - pos[0], dz = p[1] - pos[1], d = Math.hypot(dx, dz);
      if (d > rad || d < 0.6) continue;
      const sec = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * 8) % 8, score = d / (1 + 0.35 * nodeRank[n]);
      if (!best[sec] || score < best[sec].score) best[sec] = { node: n, pos: p, d, score, name: nodeName[n] };
    }
    return Object.values(best);
  }

  return { zones, links: L, nLinks: nL, skim, tripTable, assign, run, score, zoneAt, calib, shareAt,
    buildNet, nearestNode, nodeXZ, nodeName, sinksAround, localWorst };
}
export type Router = ReturnType<typeof createRouter>;
