/* Problem cards (plan Phase 4.1): streets at 90% of capacity or more, with when it starts and what causes it;
   plus housing and parking gaps. Fix comparisons (4.2) run in the routing worker on demand. */
import { useEffect, useMemo, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { Scenario } from '../model/routing';
import type { State } from '../state';
import type { Computed } from './Panels';
import type { CalibFile } from './AccuracyPanel';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { CCOL, FIXES, fmt, hourLabel, pct } from '../ui';

type Props = { A: Atlas; s: State; c: Computed; sc: Scenario; tti: Float64Array | null; cal: CalibFile | null; n: number; onFly: (pos: [number, number]) => void; planner?: boolean;
  /* Planner actions: apply a compared fix (its scenario's fixes and widenings), or ask for suggested sites for a shortfall */
  onApply?: (sc: Scenario) => void; onSuggest?: (kind: 'student' | 'homes' | 'parking', n: number, why: string) => void;
  /* beds, homes and spaces the planner's own projects add this year (counted against the shortfalls) */
  added?: { beds: number; units: number; spaces: number } };
type Prob = { road: string; segs: number[]; vc: number; delta: number; mid: [number, number]; near: string; tti: number };

export function ProblemCards({ A, s, c, sc, tti, cal, n, onFly, planner, onApply, onSuggest, added }: Props) {
  const probs: Prob[] = useMemo(() => {
    const by: Record<string, Prob> = {};
    c.shown.forEach((r, i) => {
      const seg = A.SEGS[i], name = seg.road.name;
      if (!name || seg.road.cls === 'local' || r.vc < 0.9) return;
      const p = by[name] || (by[name] = { road: name, segs: [], vc: 0, delta: 0, mid: seg.mid, near: seg.near, tti: 1 });
      p.segs.push(i);
      if (r.vc > p.vc) { p.vc = r.vc; p.mid = seg.mid; p.near = seg.near; p.delta = r.vc - c.base[i].vc; }
      if (tti && tti[i] > p.tti) p.tti = tti[i];
    });
    return Object.values(by).sort((a, b) => b.vc - a.vc).slice(0, n);
  }, [A, c, tti, n]);

  /* When each problem starts: the worker routes 2026–2034 at this hour */
  const ykey = JSON.stringify({ ...sc, t: 0, k: 'years' });
  const [years, setYears] = useState<{ key: string; years: { t: number; vc: Float32Array }[] } | null>(null);
  useWorkerMessages(m => { if (m.type === 'years' && m.key === ykey) setYears({ key: m.key, years: m.years }); });
  useEffect(() => { send({ type: 'years', key: ykey, sc, from: 2026, to: 2034 }); }, [ykey]);
  const yr = years && years.key === ykey ? years.years : null;
  function startYear(p: Prob) {
    if (!yr) return null;
    for (const y of yr) if (p.segs.some(i => y.vc[i] >= 0.9)) return Math.floor(y.t);
    return null;
  }
  function today(p: Prob) { if (!yr) return null; let m = 0; p.segs.forEach(i => { m = Math.max(m, yr[0].vc[i]); }); return m; }

  /* Fix comparison for one problem street */
  const [cmp, setCmp] = useState<{ key: string; road: string; base: number; scs: Record<string, Scenario>; options: { id: string; vht: number; vol: Float64Array }[] } | null>(null);
  const cmpKey = (p: Prob) => JSON.stringify({ ...sc, k: 'cmp', road: p.road });
  useWorkerMessages(m => { if (m.type === 'compare') setCmp(cur => cur && cur.key === m.key ? { ...cur, base: m.base, options: m.options } : cur); });
  function compare(p: Prob) {
    const options = FIXES.map(f => ({ id: f.k, sc: { ...sc, fixes: sc.fixes.filter(x => x.road !== p.road).concat([{ road: p.road, at: p.mid, factor: f.f, label: f.l + ', ' + p.road + ' near ' + p.near }]) } }));
    A.WIDEN.forEach(w => { if (p.segs.some(i => w.set[i]) && !sc.widen.includes(w.id)) options.push({ id: w.id, sc: { ...sc, widen: sc.widen.concat([w.id]) } }); });
    const key = cmpKey(p);
    setCmp({ key, road: p.road, base: 0, scs: Object.fromEntries(options.map(o => [o.id, o.sc])), options: [] });
    send({ type: 'compare', key, sc, options });
  }
  const label = (id: string) => FIXES.find(f => f.k === id)?.l || ('Build: ' + (A.WIDEN.find(w => w.id === id)?.name || id));

  const g0 = A.gaps(c.t, s.prm, c.pop), ad = added || { beds: 0, units: 0, spaces: 0 };
  const less = (x: { supply: number; need: number }, add: number) => { const supply = x.supply + add; return { supply, need: x.need, ratio: supply / x.need, short: Math.max(0, x.need - supply) }; };
  const g = { ...g0, beds: less(g0.beds, ad.beds), homes: less(g0.homes, ad.units), parking: g0.parking ? less(g0.parking, ad.spaces) : null };
  const gapsShort = [
    g.beds.ratio < 1 && { t: 'Student beds run short', d: fmt(g.beds.short) + ' more students want to live here than there are beds', k: 'student' as const, n: Math.ceil(g.beds.short / 500) },
    g.homes.ratio < 1 && { t: 'Homes for residents run short', d: 'about ' + fmt(g.homes.short) + ' homes short of need', k: 'homes' as const, n: Math.ceil(g.homes.short / 250) },
    g.parking && g.parking.ratio < 1 && { t: 'Campus-area parking is tight (rough)', d: 'very roughly ' + fmt(g.parking.short) + ' more student cars than mapped spaces', k: 'parking' as const, n: Math.ceil(g.parking.short / 600) }
  ].filter(Boolean) as { t: string; d: string; k: 'student' | 'homes' | 'parking'; n: number }[];

  return <div><p className="sec">Problems · {hourLabel(s.hour)}{c.routed ? '' : ' · routing…'}</p>
    {probs.length === 0 && <p className="note">No main street reaches 90% of its capacity at {hourLabel(s.hour)} in this scenario.</p>}
    {probs.map(p => {
      const lv = A.level(p.vc), sy = startYear(p), td = today(p);
      const growth = td != null ? p.vc - p.delta - td : null;
      const open = cmp && cmp.road === p.road ? cmp : null;
      return <div className="hot" key={p.road} style={{ gridTemplateColumns: '10px 1fr' }}><span className="stripe" style={{ background: CCOL[lv.key] }}></span>
        <div>
          <div className="row"><button className="back" onClick={() => onFly(p.mid)}>{p.road}</button><span className="lv" style={{ background: CCOL[lv.key] }}>{pct(p.vc)}</span></div>
          <small>near {p.near} · {p.tti > 1.05 ? 'trips take ' + pct(p.tti - 1) + ' longer than on an empty road' : 'little delay yet'}</small>
          <small><b>When:</b> {sy == null ? (yr ? 'not over 90% at this hour before 2035' : 'checking…') : sy <= 2026 ? 'already at this level today' : 'from about ' + sy}</small>
          <small><b>Why:</b> {growth != null ? (growth > 0.01 ? 'growth adds ' + Math.round(growth * 100) + ' points since today' : 'already busy today') : '…'}{s.withProjects && p.delta > 0.01 ? '; new projects add ' + Math.round(p.delta * 100) : ''}</small>
          {planner && <div style={{ marginTop: 6 }}>
            {!open && <button className="mini" onClick={() => compare(p)}>Compare fixes</button>}
            {open && (open.options.length ? <table style={{ marginTop: 4 }}><thead><tr><th>Option</th><th>Delay saved</th><th>This street</th>{onApply && <th></th>}</tr></thead><tbody>
              {open.options.map(o => {
                const os = open.scs[o.id], caps = A.capacities(c.tp, { widen: os.widen, fixes: os.fixes });
                return { o, saved: open.base - o.vht, vc: Math.max(...p.segs.map(i => o.vol[i] / caps[i])) };
              }).sort((a, b) => b.saved - a.saved).map(({ o, saved, vc }) =>
                <tr key={o.id}><td>{label(o.id)}</td><td className="num">{saved > 0 ? fmt(saved) + ' veh-h' : '—'}</td><td className="num">{pct(vc)}</td>
                  {onApply && <td><button className="mini act" onClick={() => onApply(open.scs[o.id])}>Apply</button></td>}</tr>)}
            </tbody></table> : <small>Routing each option…</small>)}
          </div>}
        </div></div>;
    })}
    {planner && probs.length > 0 && <p className="note">Delay saved is vehicle-hours across the whole network in that hour, from re-routing with each option. "This street" is its busiest point with that option. Options are preset capacity changes; cost, land and safety are outside the model.</p>}
    {gapsShort.map(x => <div className="hot" key={x.t}><span className="stripe" style={{ background: CCOL[3] }}></span><div><b>{x.t}</b><small>{x.d}</small>
      {planner && onSuggest && <button className="mini act" style={{ marginTop: 4 }} onClick={() => onSuggest(x.k, Math.min(3, Math.max(1, x.n)), x.t)}>Suggest sites</button>}</div>
      <span className="lv" style={{ background: CCOL[3] }}>Gap</span></div>)}
  </div>;
}
