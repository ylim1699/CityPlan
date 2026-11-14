/* Census block groups for the map's hover layer: published numbers carried through unchanged, shapes where the town is. */
import { describe, it, expect } from 'vitest';
import { loadAtlas, readJson } from './load';
import type { BlockGroupsFile } from '../src/model/types';
import { DENSITY, density, densityClass } from '../src/scene/blockLayer';

const F = readJson<BlockGroupsFile>('public/data/blockgroups.json');
const acs = readJson('data/raw/acs/B01003_bg.json').rows.slice(1) as string[][];

describe('block groups file', () => {
  it('keeps the Census numbers as published', () => {
    for (const b of F.groups) {
      const row = acs.find(r => r[3] + r[4] + r[5] + r[6] === b.id)!;  // NAME, estimate, margin, state, county, tract, block group
      expect(b.pop).toBe(+row[1]); expect(b.popMoe).toBe(+row[2]);
    }
  });
  it('every group has a shape, an area and a 2020 count', () => {
    expect(F.groups.length).toBeGreaterThan(25);
    F.groups.forEach(b => { expect(b.rings[0].length).toBeGreaterThanOrEqual(6); expect(b.landKm2).toBeGreaterThan(0); expect(b.pop2020).not.toBeNull(); });
  });
  it('the campus block groups are the densest shade', () => {
    const A = loadAtlas(), campus = A.OSM.places.campus;
    const inside = (p: number[], fl: number[]) => { let c = false; for (let i = 0, j = fl.length - 2; i < fl.length; j = i, i += 2)
      if ((fl[i + 1] > p[1]) !== (fl[j + 1] > p[1]) && p[0] < (fl[j] - fl[i]) * (p[1] - fl[i + 1]) / (fl[j + 1] - fl[i + 1]) + fl[i]) c = !c; return c; };
    const b = F.groups.find(g => g.rings.some(r => inside(campus, r)))!;
    expect(b).toBeDefined();
    expect(density(b)! > 1000).toBe(true);
    expect(densityClass(b)).toBeGreaterThanOrEqual(2);
  });
  it('shades every density into one class', () => {
    expect(densityClass({ ...F.groups[0], pop: 50, landKm2: 1 })).toBe(0);
    expect(densityClass({ ...F.groups[0], pop: 20000, landKm2: 1 })).toBe(DENSITY.length - 1);
    expect(densityClass({ ...F.groups[0], pop: null })).toBe(-1);
  });
});
