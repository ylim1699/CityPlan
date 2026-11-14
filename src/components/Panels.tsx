/* Right-hand panels, ported from legacy renderResident / renderPlanner / renderDetail. */
import type { Dispatch, ReactNode } from 'react';
import type { Atlas, PopSeries } from '../model/atlas';
import type { Project, SegResult } from '../model/types';
import type { Action, State } from '../state';
import { CCOL, fmt, hourLabel, pct, pStatus, qLabel, when } from '../ui';

export type Computed = { t: number; tp: number; pop: PopSeries; shown: SegResult[]; base: SegResult[]; withP: SegResult[]; routed: boolean };
type P = { A: Atlas; s: State; c: Computed; dispatch: Dispatch<Action>; select: (id: string | null) => void; extra?: ReactNode };

function Hot({ A, s, c, n, plain }: { A: Atlas; s: State; c: Computed; n: number; plain: boolean }) {
  return <div>{A.hotspots(c.shown, c.base, n).map(h => {
    const lv = A.level(h.vc), d = s.withProjects ? h.delta : 0;
    return <div className="hot" key={h.seg.road.name}><span className="stripe" style={{ background: CCOL[lv.key] }}></span>
      <div><b>{h.seg.road.name}</b><small>near {h.seg.near} · {plain ? 'about ' : ''}{pct(h.vc)} of capacity{d > 0.015 ? ' · projects add ' + Math.round(d * 100) + ' points' : ''}</small></div>
      <span className="lv" style={{ background: CCOL[lv.key], color: lv.key <= 1 ? '#2a2306' : undefined }}>{lv.label}</span></div>;
  })}</div>;
}
function ProjCard({ A, p, c, select }: { A: Atlas; p: Project; c: Computed; select: (id: string) => void }) {
  const st = pStatus(A, p, c.tp);
  return <button className="proj" onClick={() => select(p.id)}><div className="row"><span className="pill" data-s={st.key}>{st.label}</span><small className="num">{when(p, st)}</small></div>
    <h3>{p.name}</h3><p>{p.plain}</p>
    {p.foundBy === 'agent' && <p style={{ fontSize: 12 }}>Found by the agent{p.reviewed ? ' · confirmed by a person' : ' · not yet confirmed'}</p>}
    {st.key === 'construction' && <div className="bar"><i style={{ width: Math.round(st.progress * 100) + '%' }}></i></div>}</button>;
}

export function ResidentPanel({ A, s, c, select, extra }: P) {
  const order = { construction: 0, approved: 1, planned: 2, done: 3 };
  const list = A.PROJECTS.map(p => ({ p, st: pStatus(A, p, c.tp) })).sort((a, b) => order[a.st.key] - order[b.st.key] || a.p.end - b.p.end);
  const gp = A.gaps(c.t, s.prm, c.pop).parking;
  return <>
    {extra || <div><p className="sec">Where it gets slow · {hourLabel(s.hour)}</p><Hot A={A} s={s} c={c} n={3} plain={true} /></div>}
    {gp && <div><p className="sec">Parking near campus</p><div className="hot"><span className="stripe" style={{ background: CCOL[gp.ratio >= 1 ? 0 : 3] }}></span><div><b>
      {gp.ratio >= 1 ? 'Probably enough spaces' : 'Probably fewer spaces than student cars'}</b><small>No official count is published. Mapped lots in the walk district hold very roughly {fmt(gp.supply)} spaces for about {fmt(gp.need)} student cars, and many of those lots are church or business lots.</small></div>
      <span className="lv" style={{ background: CCOL[gp.ratio >= 1 ? 0 : 3] }}>Rough</span></div></div>}
    <div><p className="sec">Projects · tap one to find it</p><div className="list">{list.map(x => <ProjCard key={x.p.id} A={A} p={x.p} c={c} select={select} />)}</div></div>
    <p className="note">Road colors come from a model, not from traffic counters. Use them to compare streets, not as exact delays. Building progress is estimated from published dates.</p>
  </>;
}
export function residentSub(A: Atlas, c: Computed) {
  const sts = A.PROJECTS.map(p => pStatus(A, p, c.tp).key);
  const nA = sts.filter(k => k === 'construction').length, nF = sts.filter(k => k === 'approved' || k === 'planned').length;
  return qLabel(c.t) + ': ' + nA + ' under way, ' + nF + ' not started, ' + (sts.length - nA - nF) + ' finished since 2024.';
}

function Slider({ label, min, max, step, val, show, note, onChange }: { label: string; min: number; max: number; step: number; val: number; show: (v: number) => string; note?: string; onChange: (v: number) => void }) {
  return <div className="slider"><label><span>{label}</span><span className="num">{show(val)}</span></label>
    <input type="range" min={min} max={max} step={step} value={val} onChange={e => onChange(+e.target.value)} />{note && <small>{note}</small>}</div>;
}

export function PlannerPanel({ A, s, c, dispatch, select }: P) {
  const g = A.gaps(c.t, s.prm, c.pop);
  const prm = (key: keyof State['prm'], scale: number) => (v: number) => dispatch({ type: 'prm', key, value: v * scale });
  const sign = (v: number) => (v > 0 ? '+' : '') + (+v).toFixed(1) + '%';
  return <>
    <div><p className="sec">Population in the model</p><div className="row">
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.S)}</div><small style={{ color: 'var(--muted)' }}>students in town</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.R)}</div><small style={{ color: 'var(--muted)' }}>other residents</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.total)}</div><small style={{ color: 'var(--muted)' }}>total</small></div></div></div>
    <div><p className="sec">Assumptions you can change</p>
      <Slider label="Enrollment growth per year" min={-2} max={6} step={0.5} val={s.prm.enroll * 100} show={sign} note="Fall 2025 grew 6.7%. Fall 2026 fell 1.4%." onChange={prm('enroll', 0.01)} />
      <Slider label="Leaving students who stay in town" min={0} max={20} step={1} val={s.prm.stay * 100} show={v => Math.round(v) + '%'} note="No local figure found. Treat as low, medium, high." onChange={prm('stay', 0.01)} />
      <Slider label="New student beds per year" min={0} max={800} step={50} val={s.prm.bedsPerYear} show={fmt} note='Set to 0 for "housing supply stays fixed". Beds cap enrollment.' onChange={prm('bedsPerYear', 1)} />
      {A.CITY.collegeTown && <Slider label="Students who bring a car" min={20} max={90} step={5} val={s.prm.carShare * 100} show={v => Math.round(v) + '%'} note={'Assumed. Spaces are estimated from ' + A.CITY.parkLots + ' mapped lots in the walk district, including church and business lots.'} onChange={prm('carShare', 0.01)} />}
      <Slider label="New homes per year beyond known projects" min={0} max={400} step={20} val={s.prm.unitsPerYear} show={fmt} onChange={prm('unitsPerYear', 1)} />
      <label className="check"><input type="checkbox" checked={s.spring} onChange={e => dispatch({ type: 'spring', on: e.target.checked })} />Spring semester (about 72% of fall students)</label></div>
    <div><p className="sec">Project register</p><div className="tablewrap"><table><thead><tr><th>Project</th><th>Status</th><th>Confidence</th><th>Source</th></tr></thead><tbody>
      {A.PROJECTS.map(p => {
        const st = pStatus(A, p, c.tp);
        return <tr key={p.id}><td><button className="back" onClick={() => select(p.id)}>{p.name}</button><br /><small style={{ color: 'var(--muted)' }}>{p.type}{p.foundBy === 'agent' ? ' · found by agent' + (p.reviewed ? ', confirmed' : ', unconfirmed') : ''}</small></td>
          <td><span className="pill" data-s={st.key}>{st.key === 'construction' ? Math.round(st.progress * 100) + '%' : st.label.split(',')[0]}</span></td>
          <td><span className="conf" data-c={p.confidence}>{p.confidence}</span></td><td><a href={p.source.url} target="_blank" rel="noopener">{p.source.label}</a></td></tr>;
      })}</tbody></table></div>
      {A.UNMAPPED.map(u => <p className="note warn" style={{ margin: '8px 0 0' }} key={u.name}><b>Not mapped: {u.name}.</b> {u.note} <a href={u.source.url} target="_blank" rel="noopener">{u.source.label}</a></p>)}</div>
  </>;
}

export function ProjectDetail({ A, s, c, select }: P) {
  const p = A.byId(s.sel!)!, st = pStatus(A, p, c.tp);
  return <>
    <button className="back" onClick={() => select(null)}>← All projects</button>
    <div className="row"><span className="pill" data-s={st.key}>{st.label}</span><span className="conf" data-c={p.confidence}>{p.confidence} confidence</span></div>
    {st.key === 'construction' && <div><div className="bar"><i style={{ width: Math.round(st.progress * 100) + '%' }}></i></div><small style={{ color: 'var(--muted)' }}>About {Math.round(st.progress * 100)}% of the way from start to target date at {qLabel(c.tp)}. Estimated from dates, not from the site.</small></div>}
    <p style={{ margin: 0 }}>{p.plain}</p>
    <dl><dt>Type</dt><dd>{p.type}</dd><dt>Size</dt><dd>{p.size}</dd><dt>Timing</dt><dd className="num">{qLabel(p.start)} to {qLabel(p.end)}</dd>
      {p.units ? <><dt>Parking</dt><dd><span className="num">{fmt(p.parkRate ? p.units * p.parkRate : p.units * A.CITY.codeRate.perUnit * (1 + A.CITY.codeRate.visitor))}</span> spaces required by city code ({p.parkRate ? 'elderly housing rate, 1 per unit' : '2 per unit plus 10% for visitors, if treated as multi-family'}). Code minimum, not observed supply.</dd></> : null}
      <dt>Traffic</dt><dd>{p.trips ? <><span className="num">{fmt(p.trips)}</span> car trips a day when complete. </> : null}{p.tripBasis}</dd></dl>
    <div><p className="sec">From the source</p><p style={{ margin: '0 0 6px' }}>{p.evidence}</p><a href={p.source.url} target="_blank" rel="noopener">{p.source.label}</a>
      {p.foundBy === 'agent' && <p className="note" style={{ marginTop: 8 }}>Found by the AI agent{p.foundIn ? <> in <a href={p.foundIn.url} target="_blank" rel="noopener">{p.foundIn.label}</a></> : null}. {p.reviewed ? 'Confirmed by a person.' : 'Not yet confirmed by a person; not counted in the model.'}</p>}</div>
    {p.flags.length > 0 && <div><p className="sec">Check before relying on this</p><ul className="flags">{p.flags.map(f => <li key={f}>{f}</li>)}</ul></div>}
  </>;
}
