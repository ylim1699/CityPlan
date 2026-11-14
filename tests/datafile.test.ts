/* Data files: edited Census and shopping numbers reach the router, and a file keeps only its edits. */
import { describe, it, expect } from 'vitest';
import { loadAtlas, readJson } from './load';
import { createRouter, type ZonesFile } from '../src/model/routing';
import { DEFAULTS } from '../src/model/atlas';
import { applyBlocks, applyZones, editsKey, modelEdits, EMPTY, type DataEdits } from '../src/model/datafile';
import type { BlockGroup } from '../src/model/types';

const Z: ZonesFile = readJson('public/data/zones.json'), groups: BlockGroup[] = readJson('public/data/blockgroups.json').groups;
const A = loadAtlas(), G = readJson('public/data/graph-rexburg.json'), cal = readJson('public/data/calibration.json').calib;
const sc = { t: 2026.875, hour: 17, withProjects: true, prm: DEFAULTS, spring: false, widen: [], fixes: [] };
const router = (e: DataEdits) => createRouter(A, G, applyZones(Z, modelEdits(groups, Z.zones.map(z => z.id), e)), cal);
const R0 = router(EMPTY);

describe('data files', () => {
  it('no edits: the default numbers, the same traffic', () => {
    expect(applyZones(Z, modelEdits(groups, Z.zones.map(z => z.id), EMPTY))).toBe(Z);
    expect(editsKey(EMPTY)).toBe('');
  });
  it('a block shows the edited number and keeps the rest', () => {
    const b = groups[0], out = applyBlocks(groups, { blocks: { [b.id]: { pop: 5000, drive: 0.5 } } })[0];
    expect(out.pop).toBe(5000); expect(out.homes).toBe(b.homes);
    if (b.commute) expect(out.commute!.drive).toBe(0.5);
  });
  it('doubling a block group\'s people adds car trips', () => {
    const b = groups.find(g => Z.zones.some(z => z.kind === 'town' && z.residents > 500 && z.id.startsWith(g.id.slice(-4))))!;
    const more = router({ blocks: { [b.id]: { pop: b.pop! * 2 } } }).run(sc), base = R0.run(sc);
    expect(more.trips).toBeGreaterThan(base.trips);
  });
  it('shopping numbers typed for a store are what the router uses (no rebuild: they ride with the scenario)', () => {
    const base = R0.run(sc), f = base.flows![0], sid = Z.zones[f.zone].id;
    const top = f.from.indexOf(Math.max(...f.from)), oid = Z.zones[top].id;
    const r = R0.run({ ...sc, shops: { [sid]: { total: 1000, from: { [oid]: 7 } } } }), g = r.flows!.find(x => x.zone === f.zone)!;
    expect(g.from[top]).toBeCloseTo(7, 3);
    /* the total is set first (every area scaled to 1,000 a day), then that one area is replaced */
    const was = f.from.reduce((a, b) => a + b, 0), total = g.from.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1000 - f.from[top] * 1000 / was + 7, 0);
  });
});
