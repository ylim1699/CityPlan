/* Right-hand panels, ported from legacy renderResident / renderPlanner / renderDetail. */
import { useEffect, useState, type Dispatch, type ReactNode } from 'react';
import type { Atlas, PopSeries } from '../model/atlas';
import type { Project, SegResult } from '../model/types';
import type { Action, State } from '../state';
import { CCOL, fmt, hourLabel, pct, pStatus, qLabel, when } from '../ui';
import type { ProjectEdit, ProjectEditsApi } from '../hooks/useProjectEdits';

export type Computed = { t: number; tp: number; pop: PopSeries; shown: SegResult[]; base: SegResult[]; withP: SegResult[]; routed: boolean };
type P = { A: Atlas; s: State; c: Computed; dispatch: Dispatch<Action>; select: (id: string | null) => void; extra?: ReactNode; pe?: ProjectEditsApi };

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

/* projects a person took off the map, each with a way back */
function Removed({ pe }: { pe?: ProjectEditsApi }) {
  if (!pe) return null;
  return <>{Object.keys(pe.edits).filter(id => pe.edits[id].removed).map(id => <p className="note" style={{ margin: '8px 0 0' }} key={id}><b>Removed by you: {pe.edits[id].removedName || id}.</b> Not on the map or in the traffic model. <button className="back" style={{ display: 'inline' }} onClick={() => pe.restore(id)}>Restore</button></p>)}</>;
}

export function ResidentPanel({ A, s, c, select, extra, pe }: P) {
  const order = { construction: 0, approved: 1, planned: 2, done: 3 };
  const list = A.PROJECTS.map(p => ({ p, st: pStatus(A, p, c.tp) })).sort((a, b) => order[a.st.key] - order[b.st.key] || a.p.end - b.p.end);
  const gp = A.gaps(c.t, s.prm, c.pop).parking;
  return <>
    {extra || <div><p className="sec">Where it gets slow · {hourLabel(s.hour)}</p><Hot A={A} s={s} c={c} n={3} plain={true} /></div>}
    {gp && <div><p className="sec">Parking near campus</p><div className="hot"><span className="stripe" style={{ background: CCOL[gp.ratio >= 1 ? 0 : 3] }}></span><div><b>
      {gp.ratio >= 1 ? 'Probably enough spaces' : 'Probably fewer spaces than student cars'}</b><small>No official count is published. Mapped lots in the walk district hold very roughly {fmt(gp.supply)} spaces for about {fmt(gp.need)} student cars, and many of those lots are church or business lots.</small></div>
      <span className="lv" style={{ background: CCOL[gp.ratio >= 1 ? 0 : 3] }}>Rough</span></div></div>}
    <div><p className="sec">Projects · tap one to find it</p><div className="list">{list.map(x => <ProjCard key={x.p.id} A={A} p={x.p} c={c} select={select} />)}</div><Removed pe={pe} /></div>
    <p className="note">Road colors come from a model, not from traffic counters. Use them to compare streets, not as exact delays. Building progress is estimated from published dates.</p>
  </>;
}
export function residentSub(A: Atlas, c: Computed) {
  const sts = A.PROJECTS.map(p => pStatus(A, p, c.tp).key);
  const nA = sts.filter(k => k === 'construction').length, nF = sts.filter(k => k === 'approved' || k === 'planned').length;
  return qLabel(c.t) + ': ' + nA + ' under way, ' + nF + ' not started, ' + (sts.length - nA - nF) + ' finished since 2024.';
}

/* A number the planner types; it takes effect on Enter or leaving the box, so the model reruns once, not per keystroke */
function NumField({ label, val, unit, min, max, step, onChange }: { label: string; val: number; unit?: string; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(val));
  useEffect(() => setTxt(String(val)), [val]);
  const commit = () => { const v = +txt; if (txt.trim() !== '' && isFinite(v)) onChange(Math.min(max, Math.max(min, v))); else setTxt(String(val)); };
  return <label className="numfield"><span>{label}</span><span><input type="number" inputMode="decimal" min={min} max={max} step={step} value={txt}
    onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />{unit && <small>{unit}</small>}</span></label>;
}

export function PlannerPanel({ A, s, c, dispatch, select, pe }: P) {
  const g = A.gaps(c.t, s.prm, c.pop);
  const set = (key: keyof State['prm'], scale: number) => (v: number) => dispatch({ type: 'prm', key, value: v * scale });
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const changed = (['S0', 'enroll', 'R0', 'resGrowth'] as const).filter(k => s.prm[k] !== A.DEFAULTS[k]);
  return <>
    <div><p className="sec">Population in the model</p><div className="row">
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.S)}</div><small style={{ color: 'var(--muted)' }}>students in town</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.R)}</div><small style={{ color: 'var(--muted)' }}>other residents</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.total)}</div><small style={{ color: 'var(--muted)' }}>total</small></div></div></div>
    <div><p className="sec">Assumptions you can change</p>
      <p className="note" style={{ margin: '0 0 6px' }}>Fall 2026 starting point and yearly growth. Every number, street load and housing gap in the app follows these.</p>
      <NumField label="Students in town" val={Math.round(s.prm.S0)} min={0} max={200000} step={100} onChange={set('S0', 1)} />
      <NumField label="Student growth per year" val={r2(s.prm.enroll * 100)} unit="%" min={-20} max={30} step={0.1} onChange={set('enroll', 0.01)} />
      <NumField label="Other residents" val={Math.round(s.prm.R0)} min={0} max={500000} step={100} onChange={set('R0', 1)} />
      <NumField label="Resident growth per year" val={r2(s.prm.resGrowth * 100)} unit="%" min={-20} max={30} step={0.1} onChange={set('resGrowth', 0.01)} />
      <button className="mini" style={{ marginTop: 6 }} disabled={changed.length === 0}
        onClick={() => changed.forEach(k => dispatch({ type: 'prm', key: k, value: A.DEFAULTS[k] }))}>Reset to defaults</button></div>
    <div><p className="sec">Project register</p><div className="tablewrap"><table><thead><tr><th>Project</th><th>Status</th><th>Confidence</th><th>Source</th></tr></thead><tbody>
      {A.PROJECTS.map(p => {
        const st = pStatus(A, p, c.tp);
        return <tr key={p.id}><td><button className="back" onClick={() => select(p.id)}>{p.name}</button><br /><small style={{ color: 'var(--muted)' }}>{p.type}{p.foundBy === 'agent' ? ' · found by agent' + (p.reviewed ? ', confirmed' : ', unconfirmed') : ''}</small></td>
          <td><span className="pill" data-s={st.key}>{st.key === 'construction' ? Math.round(st.progress * 100) + '%' : st.label.split(',')[0]}</span></td>
          <td><span className="conf" data-c={p.confidence}>{p.confidence}</span></td><td><a href={p.source.url} target="_blank" rel="noopener">{p.source.label}</a></td></tr>;
      })}</tbody></table></div>
      <Removed pe={pe} />
      {A.UNMAPPED.map(u => <p className="note warn" style={{ margin: '8px 0 0' }} key={u.name}><b>Not mapped: {u.name}.</b> {u.note} <a href={u.source.url} target="_blank" rel="noopener">{u.source.label}</a></p>)}</div>
  </>;
}

/* Review a pulled record: change what the source got wrong, or take the project off the map (this browser) */
function EditProject({ p, pe, done }: { p: Project; pe: ProjectEditsApi; done: () => void }) {
  const [f, setF] = useState({ name: p.name, status: p.status, start: String(p.start), end: String(p.end), size: p.size, plain: p.plain,
    evidence: p.evidence, flags: p.flags.join('\n'), trips: String(p.trips ?? 0) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const start = parseFloat(f.start), end = parseFloat(f.end), trips = parseFloat(f.trips);
  const bad = !f.name.trim() ? 'Give it a name' : !(start > 1990 && start < 2100) || !(end > 1990 && end < 2100) ? 'Dates are years, like 2027 or 2027.5'
    : end <= start ? 'The end must come after the start' : !(trips >= 0) ? 'Car trips must be 0 or more' : '';
  const save = () => {
    const next: ProjectEdit = { name: f.name.trim(), status: f.status, start, end, size: f.size, plain: f.plain, evidence: f.evidence,
      flags: f.flags.split('\n').map(x => x.trim()).filter(Boolean), trips };
    const diff: ProjectEdit = {};
    (Object.keys(next) as (keyof ProjectEdit)[]).forEach(k => { if (JSON.stringify(next[k]) !== JSON.stringify(p[k as keyof Project] ?? (k === 'trips' ? 0 : undefined))) (diff as any)[k] = next[k]; });
    if (Object.keys(diff).length) pe.edit(p.id, diff);
    done();
  };
  const field = (label: string, el: ReactNode) => <label className="edit-f"><span>{label}</span>{el}</label>;
  return <div className="edit-proj">
    {field('Name', <input type="text" value={f.name} onChange={set('name')} />)}
    {field('Status', <select value={f.status} onChange={set('status')}><option value="construction">Under construction</option><option value="approved">Approved</option><option value="planned">Planned</option></select>)}
    <div className="edit-row">{field('Start (year)', <input type="number" step="0.25" value={f.start} onChange={set('start')} />)}{field('End (year)', <input type="number" step="0.25" value={f.end} onChange={set('end')} />)}</div>
    <small className="note">2027.5 is mid 2027. The time slider uses these dates to show it under way or done.</small>
    {field('Size', <input type="text" value={f.size} onChange={set('size')} />)}
    {field('Summary', <textarea rows={2} value={f.plain} onChange={set('plain')} />)}
    {field('From the source', <textarea rows={4} value={f.evidence} onChange={set('evidence')} />)}
    {field('Check before relying on this (one per line)', <textarea rows={3} value={f.flags} onChange={set('flags')} />)}
    {field('Car trips a day when complete', <input type="number" min="0" step="10" value={f.trips} onChange={set('trips')} />)}
    {bad && <p className="note warn" style={{ margin: 0 }}>{bad}</p>}
    <div className="row" style={{ gap: 6, justifyContent: 'flex-start' }}><button className="mini" disabled={!!bad} onClick={save}>Save</button><button className="mini" onClick={done}>Cancel</button></div>
  </div>;
}

export function ProjectDetail({ A, s, c, select, pe }: P) {
  const p = A.byId(s.sel!), [editing, setEditing] = useState(false);
  useEffect(() => { setEditing(false); }, [s.sel]);
  if (!p) return <button className="back" onClick={() => select(null)}>← All projects</button>;
  const st = pStatus(A, p, c.tp), mine = pe?.edits[p.id];
  return <>
    <button className="back" onClick={() => select(null)}>← All projects</button>
    {pe && <div className="row" style={{ gap: 6, justifyContent: 'flex-start' }}>
      {!editing && <button className="mini" onClick={() => setEditing(true)}>Edit details</button>}
      <button className="mini danger" onClick={() => { if (confirm('Remove "' + p.name + '" from the map and the traffic model? You can restore it from the projects list.')) { pe.remove(p.id, p.name); select(null); } }}>Remove</button></div>}
    {mine && !editing && <p className="note" style={{ margin: 0 }}>You edited this record ({Object.keys(mine).join(', ')}). <button className="back" style={{ display: 'inline' }} onClick={() => pe!.reset(p.id)}>Undo my edits</button></p>}
    {editing && pe ? <EditProject p={p} pe={pe} done={() => setEditing(false)} /> : null}
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
