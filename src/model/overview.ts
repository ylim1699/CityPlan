/* Overview numbers: the congestion measures planners compare across years and scenarios.
   The selected quarter uses whatever the map shows (routed trips, or the count-based estimate). The year and hour series come
   from the routing worker in routed mode (a few seconds), or from the count-based method, which is instant.
   Delay uses the standard BPR curve: travel time = free-flow time x (1 + 0.15 (v/c)^4). Free-flow speeds are ASSUMED by road type. */
import { TODAY, type Atlas, type PopSeries } from './atlas';
import type { Fix, Params, Project, SegResult } from './types';

const MPH: Record<string, number> = { highway: 65, arterial: 40, minor: 35, collector: 30, ramp: 35, local: 25 };
const M_PER_UNIT = 200, M_PER_MI = 1609.34;
export const FROM = 2024, TO = 2034;
export const YEARS = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i);
export const fallOf = (y: number) => y + 0.875;  /* Q4, fall semester: the 2026 point is today */

export type Measures = { delay: number; overMi: number; heavyShare: number; tti: number; vmt: number };
export function measures(A: Atlas, res: SegResult[]): Measures {
  let delay = 0, overM = 0, heavyM = 0, mainM = 0, t0Sum = 0, tSum = 0, vmt = 0;
  res.forEach((r, i) => {
    const s = A.SEGS[i], lenM = s.len * M_PER_UNIT, t0 = lenM / (MPH[s.road.cls] * 0.44704) / 3600;
    const t = t0 * (1 + 0.15 * Math.pow(r.vc, 4));
    delay += r.vol * (t - t0); t0Sum += r.vol * t0; tSum += r.vol * t; vmt += r.vol * lenM / M_PER_MI;
    if (s.road.cls === 'local') return;
    mainM += lenM; if (r.vc >= 1) overM += lenM; if (r.vc >= 0.85) heavyM += lenM;
  });
  return { delay, overMi: overM / M_PER_MI, heavyShare: heavyM / mainM, tti: t0Sum ? tSum / t0Sum : 1, vmt };
}

/* by year (both scenarios), by hour (today vs the selected quarter, with projects), and today's load for comparison */
export type Series = { years: { y: number; grow: Measures; plans: Measures }[]; day: { h: number; now: number; then: number }[]; now: Measures; nowVc: number[] };
export type OverviewIn = { t: number; hour: number; pop: PopSeries; prm: Params; spring: boolean; fixes: Fix[]; widen: string[] };

export function countSeries(A: Atlas, o: OverviewIn): Series {
  const opt = { pop: o.pop, spring: o.spring, fixes: o.fixes, widen: o.widen };
  const run = (t: number, h: number, withProjects: boolean) => A.traffic(t, h, { ...opt, withProjects });
  const nowRes = run(TODAY, o.hour, true);
  return {
    years: YEARS.map(y => ({ y, grow: measures(A, run(fallOf(y), o.hour, false)), plans: measures(A, run(fallOf(y), o.hour, true)) })),
    day: Array.from({ length: 24 }, (_, h) => ({ h, now: measures(A, run(TODAY, h, true)).delay, then: measures(A, run(o.t, h, true)).delay })),
    now: measures(A, nowRes), nowVc: nowRes.map(r => r.vc)
  };
}

/* the selected quarter as the map shows it (withP / base), plus population and housing, plus the series when it is ready */
export function overview(A: Atlas, o: OverviewIn, withP: SegResult[], base: SegResult[], series: Series | null) {
  const pops = YEARS.map(y => { const p = o.pop.at(fallOf(y)); return { y, pop: p.total, students: p.Su, beds: p.beds }; });
  const roads = A.hotspots(withP, null, 8).map(x => ({ name: x.seg.road.name, near: x.seg.near, at: x.seg.mid, vc: x.vc, vcGrow: base[x.seg.i].vc, vcNow: series ? series.nowVc[x.seg.i] : null }));
  const projects = A.PROJECTS.map((p: Project) => ({ p, add: A.projTrips(p, o.t) - A.projTrips(p, TODAY) }))
    .filter(x => x.add > 0).sort((a, b) => b.add - a.add).slice(0, 6);
  return { grow: measures(A, base), plans: measures(A, withP), series, pops, roads, projects,
    gaps: A.gaps(o.t, o.prm, o.pop), gapsNow: A.gaps(TODAY, o.prm, o.pop), capYear: o.pop.capYear };
}
export type Overview = ReturnType<typeof overview>;
