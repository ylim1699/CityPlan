/* Parity: the TypeScript port must give the same numbers as legacy/model.js. */
import { describe, it, expect } from 'vitest';
import { loadAtlas, loadLegacy } from './load';

const A = loadAtlas(), L = loadLegacy();
const scenarios = [
  { name: 'Q4 2026, 5 pm, with projects', t: 2026.875, h: 17, o: { withProjects: true } },
  { name: '2034, 5 pm, with projects', t: 2034.125, h: 17, o: { withProjects: true } },
  { name: '2034, 8 am, growth only, spring', t: 2034.125, h: 8, o: { withProjects: false, spring: true } },
  { name: '2030, noon, widening + fix', t: 2030.125, h: 12, o: { withProjects: true, widen: ['w15'], fixes: [{ road: 'North 2nd East', at: [2, -5], factor: 1.25, label: 'x' }] } }
];

describe('port matches legacy model.js', () => {
  it('same segments and projects', () => {
    expect(A.SEGS.length).toBe(L.SEGS.length);
    expect(A.PROJECTS.map(p => p.id)).toEqual(L.PROJECTS.map((p: any) => p.id));
    expect(A.WIDEN.map(w => w.segs.length)).toEqual(L.WIDEN.map((w: any) => w.segs.length));
  });
  for (const s of scenarios) it(s.name, () => {
    const a = A.traffic(s.t, s.h, { ...s.o, pop: A.popSeries(A.DEFAULTS) } as any);
    const b = L.traffic(s.t, s.h, { ...s.o, pop: L.popSeries(L.DEFAULTS) });
    expect(a.length).toBe(b.length);
    let worst = 0;
    a.forEach((r, i) => { worst = Math.max(worst, Math.abs(r.vol - b[i].vol), Math.abs(r.cap - b[i].cap)); });
    expect(worst).toBeLessThan(1e-6);
  });
  it('gaps and population', () => {
    const prm = { ...A.DEFAULTS, enroll: 0.04 };
    expect(A.gaps(2032.375, prm)).toEqual(L.gaps(2032.375, prm));
    expect(A.popSeries(prm).capYear).toBe(L.popSeries(prm).capYear);
  });
});
