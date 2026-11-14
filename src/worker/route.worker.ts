/* Routing worker: loads the snapshot files, builds the atlas and router once, then answers scenario requests.
   Only the newest request of each type is worked on (older ones are dropped while dragging sliders),
   main runs first, then fix comparisons, then the year scan. Results are cached. */
import { createAtlas, HOURLY } from '../model/atlas';
import { createRouter, type Router, type Scenario } from '../model/routing';
import { slimeRoads, type RoadCandidate } from '../model/physarum';
import type { XZ } from '../model/types';

export type Req =
  | { type: 'init'; base: string }
  | { type: 'projects'; extra: any[] }
  | { type: 'run'; key: string; sc: Scenario; hours?: boolean }
  | { type: 'hours'; key: string; sc: Scenario }
  | { type: 'years'; key: string; sc: Scenario; from: number; to: number }
  | { type: 'compare'; key: string; sc: Scenario; options: { id: string; sc: Scenario }[]; pos?: XZ }
  | { type: 'slime'; key: string; site: XZ; rad?: number; skipNode?: number | null };
export type Res =
  | { type: 'ready' } | { type: 'error'; error: string }
  | { type: 'run'; key: string; with: { vol: Float64Array; tti: Float64Array; vht: number; trips?: number }; without: { vol: Float64Array; tti: Float64Array; vht: number }; ms: number }
  | { type: 'hours'; key: string; hours: { mx: number; avg: number }[] }
  | { type: 'years'; key: string; years: { t: number; vc: Float32Array }[] }
  | { type: 'compare'; key: string; base: number; options: { id: string; vht: number; vol: Float64Array; worst?: Worst | null; roadVol?: Record<string, { vol: number; vc: number }>; planTrips?: number[] }[]; baseWorst?: Worst | null }
  | { type: 'slime'; key: string; cands: RoadCandidate[]; sinks: number; ms: number };
type Worst = { vc: number; name: string };

let R: Router | null = null, A: ReturnType<typeof createAtlas> | null = null;
let files: any = null, extra: any[] = [];
function build() {
  const [city, projects, graph, zones, cal, hourly] = files, ids = new Set(extra.map(p => p.id));
  A = createAtlas(city, { ...projects, projects: projects.projects.filter((p: any) => !ids.has(p.id)).concat(extra) });
  R = createRouter(A, graph, zones, cal.calib, hourly);
  cache.clear();
}
const ORDER = ['run', 'compare', 'slime', 'years', 'hours'] as const;
const pending = new Map<string, Req>(); let busy = false;
const newerRun = () => pending.has('run');
const cache = new Map<string, any>();
function remember(k: string, v: any) { cache.set(k, v); if (cache.size > 300) cache.delete(cache.keys().next().value!); return v; }
const post = (m: Res, tr: Transferable[] = []) => (self as any).postMessage(m, tr);

function runOne(sc: Scenario) {
  const k = JSON.stringify(sc);
  return cache.get(k) || remember(k, R!.run(sc));
}
function summarize(sc: Scenario, vol: Float64Array) {
  const tp = sc.withProjects ? sc.t : Math.min(sc.t, A!.TODAY), caps = A!.capacities(tp, { widen: sc.widen, fixes: sc.fixes });
  let mx = 0, sum = 0, len = 0;
  A!.SEGS.forEach((s, i) => { const vc = vol[i] / caps[i]; mx = Math.max(mx, vc); sum += vc * s.len; len += s.len; });
  return { mx, avg: sum / len };
}
function handle(m: Req) {
  if (m.type === 'run') {
    const t0 = performance.now();
    const w = runOne(m.sc), wo = runOne({ ...m.sc, withProjects: false });
    post({ type: 'run', key: m.key, with: { vol: w.vol, tti: w.tti, vht: w.vht, trips: w.trips }, without: { vol: wo.vol, tti: wo.tti, vht: wo.vht }, ms: Math.round(performance.now() - t0) });
    if (m.hours) pending.set('hours', { type: 'hours', key: m.key, sc: m.sc });  // the hour bar fills in last
  } else if (m.type === 'hours') {
    {
      const hours: { mx: number; avg: number }[] = [];
      for (let h = 0; h < 24; h++) {
        if (newerRun()) return;  // a newer scenario arrived: stop filling the hour bar
        const sc = { ...m.sc, hour: h };
        hours.push(summarize(sc, runOne(sc).vol));
      }
      post({ type: 'hours', key: m.key, hours });
    }
  } else if (m.type === 'years') {
    const years: { t: number; vc: Float32Array }[] = [];
    for (let y = m.from; y <= m.to; y++) {
      if (newerRun()) { pending.set('years', pending.get('years') || m); return; }  // finish after the new main run
      const sc = { ...m.sc, t: y + 0.875 }, r = runOne(sc);
      const tp = sc.withProjects ? sc.t : Math.min(sc.t, A!.TODAY), caps = A!.capacities(tp, { widen: sc.widen, fixes: sc.fixes });
      years.push({ t: sc.t, vc: Float32Array.from(r.vol, (v: number, i: number) => v / caps[i]) });
    }
    post({ type: 'years', key: m.key, years });
  } else if (m.type === 'compare') {
    const base = runOne(m.sc).vht;
    /* pos: also report the worst main street within 2 km of it (scene radius 10), for local before/after */
    const options = m.options.map(o => { const r = runOne(o.sc); return { id: o.id, vht: r.vht, vol: r.vol, roadVol: r.roadVol, planTrips: r.planTrips,
      worst: m.pos ? R!.localWorst(o.sc, r.vol, m.pos, 10) : null }; });
    post({ type: 'compare', key: m.key, base, options, baseWorst: m.pos ? R!.localWorst(m.sc, runOne(m.sc).vol, m.pos, 10) : null });
  } else if (m.type === 'slime') {
    const t0 = performance.now(), r = slimeRoads(A!, R!, m.site, m.rad, m.skipNode);
    post({ type: 'slime', key: m.key, cands: r.cands, sinks: r.sinks, ms: Math.round(performance.now() - t0) });
  }
}
function pump() {
  if (busy || !pending.size || !R) return;
  busy = true;
  const t = ORDER.find(k => pending.has(k))!, m = pending.get(t)!; pending.delete(t);
  try { handle(m); } catch (e) { post({ type: 'error', error: String(e) }); }
  busy = false;
  if (pending.size) setTimeout(pump, 0);
}
self.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const get = (f: string) => fetch(m.base + 'data/' + f).then(r => r.json());
      files = await Promise.all(['city-rexburg.json', 'projects.json', 'graph-rexburg.json', 'zones.json', 'calibration.json', 'hourly.json'].map(f => get(f).catch(() => null)));
      build();
      void HOURLY;
      post({ type: 'ready' });
      pump();
    } catch (err) { post({ type: 'error', error: String(err) }); }
    return;
  }
  if (m.type === 'projects') { extra = m.extra; if (files) build(); return; }
  pending.set(m.type, m);
  setTimeout(pump, 0);
};
