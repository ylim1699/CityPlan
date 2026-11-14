/* Calibration (plan section "Why trust it", proof 2 and 3): tune only the labeled estimates against the city's counts at 5 pm,
   holding 20 counts out (fixed seed) to test on afterwards. Writes public/data/calibration.json, which the app's accuracy panel reads.
   Usage: pnpm tsx scripts/calibrate.ts */
import { readFileSync, writeFileSync } from 'node:fs';
import { createAtlas, DEFAULTS } from '../src/model/atlas';
import { createRouter, CALIB0, geh, type Calib } from '../src/model/routing';

const rd = (f: string) => JSON.parse(readFileSync('public/data/' + f, 'utf8'));
const A = createAtlas(rd('city-rexburg.json'), rd('projects.json'));
const G = rd('graph-rexburg.json'), Z = rd('zones.json'), HR = rd('hourly.json');
const HOUR = 17;
const sc = { t: A.TODAY, hour: HOUR, withProjects: true, prm: DEFAULTS, spring: false, widen: [], fixes: [] };

/* Fixed hold-out: 20 of the counts, chosen by a seeded shuffle */
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const n = A.OSM.counts.pts.length, order = [...Array(n).keys()].sort(() => rnd() - 0.5);
const hold = new Set(order.slice(0, 20));

function evaluate(c: Calib) {
  const R = createRouter(A, G, Z, c, HR), r = R.run(sc as any), s = R.score(r.vol, HOUR);
  const tune = s.filter(x => !hold.has(x.k)), test = s.filter(x => hold.has(x.k));
  const pass = (a: typeof s) => a.filter(x => x.geh < 5).length / a.length;
  const meanGeh = (a: typeof s) => a.reduce((t, x) => t + x.geh, 0) / a.length;
  return { c, s, tune: pass(tune), test: pass(test), tuneGeh: meanGeh(tune), testGeh: meanGeh(test) };
}
let best: ReturnType<typeof evaluate> | null = null, tried = 0;
for (const alpha of [1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5])
  for (const beta of [0.05, 0.08, 0.1, 0.14])
    for (const studentTrips of [2.5, 3, 3.5])
      for (const throughShare of [0.3, 0.5, 0.7]) {
        const e = evaluate({ alpha, beta, studentTrips, throughShare }); tried++;
        if (!best || e.tune > best.tune || (e.tune === best.tune && e.tuneGeh < best.tuneGeh)) best = e;
      }
const base = evaluate(CALIB0), b = best!;
/* Recent check: 2023 intersection approach counts (never tuned on). Leg two-way volume ~ 2 x approach, grown to 2026. */
const RB = createRouter(A, G, Z, b.c, HR), rv = RB.run(sc as any).vol;
const recent = (A.OSM.counts.approach || []).map(a => { const s = A.SEGS[a[4]], c = a[5] * RB.shareAt(HOUR) / (s.road.oneway ? 2 : 1), m = rv[a[4]];
  return { seg: a[4], road: s.road.name, year: a[3], dir: a[6], count: Math.round(c), model: Math.round(m), geh: +geh(m, c).toFixed(2) }; });
const recentPass = recent.filter(x => x.geh < 5).length / (recent.length || 1);
const pct = (x: number) => Math.round(x * 100);
console.log('tried', tried, 'settings');
console.log('before (plan defaults):', pct(base.tune) + '% of tuning counts under GEH 5,', pct(base.test) + '% of held-out');
console.log('2023 approach counts (never tuned on):', pct(recentPass) + '% under GEH 5 of', recent.length);
console.log('after:', JSON.stringify(b.c), pct(b.tune) + '% tuning,', pct(b.test) + '% held-out, mean GEH', b.tuneGeh.toFixed(1), '/', b.testGeh.toFixed(1));
writeFileSync('public/data/calibration.json', JSON.stringify({
  meta: { source: 'Calibrated against 89 Madison County / Rexburg traffic counts (2015 and later, grown 2.5% a year to 2026), 5 pm share of daily', url: '', fetched: '2026-11-14', type: 'estimate' },
  hour: HOUR, calib: b.c, defaults: CALIB0, tried,
  before: { tune: base.tune, test: base.test },
  after: { tune: b.tune, test: b.test, tuneGeh: b.tuneGeh, testGeh: b.testGeh },
  recent: { pass: recentPass, n: recent.length, points: recent },
  points: b.s.map(x => ({ seg: x.seg, road: x.road, year: x.year, count: Math.round(x.count), model: Math.round(x.model), geh: +x.geh.toFixed(2), holdout: hold.has(x.k) }))
}));
