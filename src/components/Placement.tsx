/* Demo helpers for planner mode: saved views (plan Phase 6.1) and a placement test,
   "the same 500 student beds in different places", ranked by the delay each adds. */
import { useState, type Dispatch } from 'react';
import type { Atlas } from '../model/atlas';
import type { Scenario, ZonesFile } from '../model/routing';
import type { Action } from '../state';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { TODAY_I, LAST_I, fmt, hourLabel, pct } from '../ui';

export function DemoViews({ dispatch }: { dispatch: Dispatch<Action> }) {
  const v = (patch: any) => () => dispatch({ type: 'view', patch: { sel: null, ...patch } });
  return <div><p className="sec">Demo views</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
    <button className="mini" onClick={v({ ti: TODAY_I, hour: 17, withProjects: true })}>5 pm today</button>
    <button className="mini" onClick={v({ ti: LAST_I, hour: 17, withProjects: true })}>5 pm 2034, with projects</button>
    <button className="mini" onClick={v({ ti: LAST_I, hour: 17, withProjects: false })}>5 pm 2034, growth only</button>
    <button className="mini" onClick={v({ ti: TODAY_I, hour: 8, withProjects: true })}>8 am today</button>
  </div></div>;
}

const SITES = [
  { id: 'campus', label: 'Next to campus, in the walk district', ll: [43.8236, -111.7885] as [number, number] },
  { id: 'west', label: 'West of US-20, by Madison Commons', ll: [43.8295, -111.8050] as [number, number] },
  { id: 'north', label: 'North end, by the new temple', ll: [43.8575, -111.7850] as [number, number] }
];
const BEDS = 500;

export function Placement({ A, sc, zones }: { A: Atlas; sc: Scenario; zones: ZonesFile }) {
  const zoneAt = (ll: [number, number]) => {
    const p = A.LL(ll[0], ll[1]); let best = 0, bd = Infinity;
    zones.zones.forEach((z, i) => { if (z.kind !== 'town') return; const d = Math.hypot(z.x * A.S - p[0], z.z * A.S - p[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const key = JSON.stringify({ ...sc, k: 'place' });
  const [res, setRes] = useState<{ key: string; base: number; options: { id: string; vht: number }[] } | null>(null);
  useWorkerMessages(m => { if (m.type === 'compare' && m.key === key) setRes({ key, base: m.base, options: m.options }); });
  const run = () => {
    setRes({ key, base: 0, options: [] });
    send({ type: 'compare', key, sc, options: SITES.map(s => ({ id: s.id, sc: { ...sc, extra: [{ zone: zoneAt(s.ll), students: BEDS }] } })) });
  };
  const cur = res && res.key === key ? res : null;
  const rows = cur && cur.options.length ? cur.options.map(o => ({ s: SITES.find(x => x.id === o.id)!, add: o.vht - cur.base })).sort((a, b) => a.add - b.add) : null;
  return <div><p className="sec">Where should {BEDS} new student beds go? · {hourLabel(sc.hour)}</p>
    {!cur && <button className="mini" onClick={run}>Compare three sites</button>}
    {cur && !rows && <small>Routing each site…</small>}
    {rows && <table><thead><tr><th>Site</th><th>Delay added</th></tr></thead><tbody>
      {rows.map((r, i) => <tr key={r.s.id}><td>{i === 0 ? <b>{r.s.label}</b> : r.s.label}</td><td className="num">{fmt(Math.max(0, r.add))} veh-h{cur!.base ? ' (+' + pct(Math.max(0, r.add) / cur!.base) + ')' : ''}</td></tr>)}
    </tbody></table>}
    <p className="note" style={{ marginTop: 6 }}>Each site adds the same {BEDS} students to its zone; trips follow the student rules (fewer car trips in the walk district). Delay is extra vehicle-hours on the whole network in that hour. A screening comparison, not a site study.</p>
  </div>;
}
