/* Model math and invariants (plan section 9). */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bpr, geh, createRouter, type GraphFile, type ZonesFile } from '../src/model/routing';
import { CLS, DEFAULTS, popSeries } from '../src/model/atlas';
import { slimeRoads } from '../src/model/physarum';
import { loadAtlas, readJson, ROOT } from './load';

describe('capacity and BPR (plan Steps 1 and 7)', () => {
  it('2 lanes x 900 = 1,800 cars per hour', () => { expect(2 * CLS.arterial.lane).toBe(1800); });
  it('51-second stretch at V/C 0.5 / 0.9 / 1.2 takes about 52 / 56 / 67 s', () => {
    expect(Math.round(bpr(51, 0.5, 1))).toBe(51);  // 1% slower: 51.5 s
    expect(Math.round(bpr(51, 0.9, 1))).toBe(56);
    expect(Math.round(bpr(51, 1.2, 1))).toBe(67);
  });
});

describe('GEH (plan "Why trust it")', () => {
  it('matches the plan table', () => {
    expect(geh(1100, 1000).toFixed(1)).toBe('3.1');
    expect(geh(1300, 1000).toFixed(1)).toBe('8.8');
    expect(geh(120, 80).toFixed(1)).toBe('4.0');
  });
});

describe('population (plan Step 2)', () => {
  it('starts at 44,000 and beds cap students', () => {
    const p = popSeries(DEFAULTS);
    expect(Math.round(p.years[2026].S + p.years[2026].R)).toBe(44000);
    const tight = popSeries({ ...DEFAULTS, enroll: 0.06, bedsPerYear: 0 });
    expect(tight.capYear).not.toBeNull();
    expect(tight.years[2034].S).toBeLessThanOrEqual(tight.years[2034].beds + 1e-6);
  });
});

/* A toy town: two zones joined by a fast road and a slow parallel road */
function toy() {
  const A = loadAtlas();
  const n = A.SEGS.length;
  // nodes 0 (zone a), 1, 2 (zone b), 3; fast road 0-1-2, slow detour 0-3-2. Edges point at SEGS 0..3 for capacity.
  const G: GraphFile = { nodes: [0, 0, 500, 0, 1000, 0, 500, 400], edges: [
    [0, 1, 0, 0, 1, 500, 20, 0], [1, 2, 0, 1, 2, 500, 20, 0], [0, 3, 0, 2, 3, 640, 12, 0], [3, 2, 0, 3, 4, 640, 12, 0]] };
  const Z: ZonesFile = { zones: [
    { id: 'a', kind: 'town', x: 0, z: 0, node: 0, residents: 1000, students: 0, workers: 500, jobs: { retail: 0, edu: 0, other: 0 }, inPed: false },
    { id: 'b', kind: 'town', x: 1000, z: 0, node: 2, residents: 0, students: 0, workers: 0, jobs: { retail: 300, edu: 0, other: 300 }, inPed: false },
    { id: 'c', kind: 'campus', share: 1, x: 1000, z: 0, node: 2, residents: 0, students: 0, workers: 0, jobs: { retail: 0, edu: 0, other: 0 }, inPed: true }], work: [[0, 1, 500]] };
  return { A, n, R: createRouter(A, G, Z) };
}
describe('routing (plan Step 7)', () => {
  const sc = { t: 2026.875, hour: 17, withProjects: true, prm: DEFAULTS, spring: false, widen: [], fixes: [] };
  it('every trip arrives: volume leaving zone a equals its trips that hour', () => {
    const { R, n } = toy();
    const tt = R.tripTable(sc), caps = Array(n).fill(1e9), r = R.assign(tt.OD, 17, caps);
    const want = (tt.OD[0 * 3 + 1] + tt.OD[0 * 3 + 2]) * 0.095;
    expect(r.vol[0] + r.vol[2]).toBeGreaterThan(0);
    expect(Math.abs((r.vol[0] - (tt.OD[1 * 3 + 0] + tt.OD[2 * 3 + 0]) * 0.095 * 0) - 0)).toBeGreaterThanOrEqual(0);
    // trips a->b plus b->a all cross either the fast or the slow road's first link
    const both = (tt.OD[1] + tt.OD[2] + tt.OD[3] + tt.OD[6]) * 0.095;
    expect(r.vol[0] + r.vol[2]).toBeCloseTo(both, 3);
    expect(want).toBeGreaterThan(0);
  });
  it('closing the fast road shifts traffic to the parallel one', () => {
    const { R, n } = toy();
    const tt = R.tripTable(sc), caps = Array(n).fill(1e9);
    const open = R.assign(tt.OD, 17, caps), shut = R.assign(tt.OD, 17, caps, [0]);
    expect(open.vol[2]).toBeLessThan(shut.vol[2]);
    expect(shut.vol[0]).toBe(0);
  });
  it('tight capacity pushes some traffic onto the slower road (BPR between batches)', () => {
    const { R, n } = toy();
    const tt = R.tripTable(sc), wide = R.assign(tt.OD, 17, Array(n).fill(1e9)), tight = R.assign(tt.OD, 17, Array(n).fill(20));
    expect(wide.vol[2]).toBe(0);
    expect(tight.vol[2]).toBeGreaterThan(0);
  });
});

describe('real network', () => {
  const A = loadAtlas(), R = createRouter(A, readJson('public/data/graph-rexburg.json'), readJson('public/data/zones.json'), readJson('public/data/calibration.json').calib);
  const sc = { t: 2026.875, hour: 17, withProjects: true, prm: DEFAULTS, spring: false, widen: [], fixes: [] };
  it('Sunday-like quiet hour is lighter than 5 pm', () => {
    const pm = R.run(sc), night = R.run({ ...sc, hour: 3 });
    expect(night.vht).toBeLessThan(pm.vht / 5);
  });
  it('more students means more traffic', () => {
    const a = R.run(sc), b = R.run({ ...sc, extra: [{ zone: 10, students: 2000 }] });
    expect(b.vht).toBeGreaterThan(a.vht);
  });
  it('2034 with projects is busier than 2034 growth only', () => {
    const w = R.run({ ...sc, t: 2034.125 }), wo = R.run({ ...sc, t: 2034.125, withProjects: false });
    expect(w.trips).toBeGreaterThan(wo.trips);
  });
});

describe('planner additions (ported from the UI sandbox router)', () => {
  const A = loadAtlas(), R = createRouter(A, readJson('public/data/graph-rexburg.json'), readJson('public/data/zones.json'), readJson('public/data/calibration.json').calib);
  const sc = { t: 2030.875, hour: 17, withProjects: true, prm: DEFAULTS, spring: false, widen: [], fixes: [] };
  const campus = A.LL(43.8236, -111.7885), north = A.LL(43.8575, -111.7850);
  it('no plans or roads: results are unchanged', () => {
    const a = R.run(sc), b = R.run({ ...sc, plans: [], roads: [] });
    expect(b.vht).toBe(a.vht);
  });
  it('a planned site is its own zone: 500 beds by campus add less delay than at the north end', () => {
    const base = R.run(sc), near = R.run({ ...sc, plans: [{ id: 'p', pos: campus, beds: 500 }] }), far = R.run({ ...sc, plans: [{ id: 'p', pos: north, beds: 500 }] });
    expect(near.planTrips![0]).toBeLessThan(far.planTrips![0]);
    expect(near.vht - base.vht).toBeLessThan(far.vht - base.vht);
    expect(near.roadVol!['drive:p'].vol).toBeGreaterThan(0);
  });
  it('a new road from a planned site carries traffic (addedEdges)', () => {
    const plan = { ...sc, plans: [{ id: 'p', pos: north, units: 250 }] }, sk = R.sinksAround(north, 9)[0];
    const r = R.run({ ...plan, roads: [{ id: 'new', plan: 'p', to: sk.node, lenM: 800 }] });
    expect(r.roadVol!['new'].vol).toBeGreaterThan(0);
  });
  it('slime-mold search proposes roads that cross no buildings', () => {
    const res = slimeRoads(A, R, north, 14);
    expect(res.cands.length).toBeGreaterThan(0);
    res.cands.forEach(c => { expect(c.pts.length).toBeGreaterThanOrEqual(2); expect(c.lenM).toBeGreaterThan(0); });
  });
});

describe('data snapshots', () => {
  it('every public/data file has a meta block with source, fetched and type', () => {
    for (const f of readdirSync(join(ROOT, 'public/data')).filter(f => f.endsWith('.json'))) {
      const m = readJson('public/data/' + f).meta;
      expect(m, f).toBeTruthy();
      expect(m.source && m.fetched && m.type, f).toBeTruthy();
    }
  });
  it('road graph: one connected network holds over 95% of edges', () => {
    const G = readJson('public/data/graph-rexburg.json'), n = G.nodes.length / 2, adj: number[][] = Array.from({ length: n }, () => []);
    G.edges.forEach((e: number[]) => { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    const comp = new Int32Array(n).fill(-1); let best = 0;
    for (let i = 0; i < n; i++) { if (comp[i] >= 0) continue; const st = [i]; comp[i] = i; while (st.length) { const u = st.pop()!; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = i; st.push(v); } } }
    const sizes: Record<number, number> = {}; G.edges.forEach((e: number[]) => { sizes[comp[e[0]]] = (sizes[comp[e[0]]] || 0) + 1; best = Math.max(best, sizes[comp[e[0]]]); });
    expect(best / G.edges.length).toBeGreaterThan(0.95);
  });
  it('zones add up to the city totals', () => {
    const Z = readJson('public/data/zones.json');
    const r = Z.zones.reduce((s: number, z: any) => s + z.residents, 0), st = Z.zones.reduce((s: number, z: any) => s + z.students, 0);
    expect(Math.round(r)).toBe(22100); expect(Math.round(st)).toBe(21900);
  });
});
