/* Right-hand panels, ported from legacy renderResident / renderPlanner / renderDetail. */
import type { Dispatch, ReactNode } from 'react';
import type { Atlas, PopSeries } from '../model/atlas';
import type { Project, SegResult } from '../model/types';
import type { Action, State } from '../state';
import { CCOL, FIXES, fmt, hourLabel, pct, pStatus, qLabel, when } from '../ui';

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

function Spark({ fn, c }: { fn: (t: number) => number; c: Computed }) {
  const ys: number[] = []; let lo = 0.88, hi = 1.06;
  for (let y = 2026; y <= 2034; y++) { const v = fn(y + 0.875); ys.push(v); lo = Math.min(lo, v - 0.02); hi = Math.max(hi, v + 0.02); }
  const X = (i: number) => 4 + i * (192 / 8), Y = (v: number) => 30 - (v - lo) / (hi - lo) * 26;
  const pts = ys.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' '), ci = c.t - 2026.875;
  return <svg className="spark" viewBox="0 0 200 34" preserveAspectRatio="none" role="img" aria-label="Trend from 2026 to 2034">
    <line x1="4" x2="196" y1={Y(1).toFixed(1)} y2={Y(1).toFixed(1)} stroke="#9aa8a3" strokeDasharray="3 3" strokeWidth="1" />
    <polyline points={pts} fill="none" stroke="#0d6767" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    {ci >= 0 && ci <= 8 && <circle cx={X(ci).toFixed(1)} cy={Y(fn(c.t)).toFixed(1)} r="3.2" fill="#1c2a2d" />}</svg>;
}
function GapRow({ title, g, unit, fn, c }: { title: ReactNode; g: { ratio: number; supply: number; need: number; short: number }; unit: string; fn: (t: number) => number; c: Computed }) {
  const col = g.ratio >= 1 ? '#0e8a79' : (g.ratio >= 0.95 ? '#e29a3c' : '#d0532e');
  return <div className="gap"><div className="row"><b>{title}</b><span className="big">{pct(g.ratio)}</span></div>
    <div className="meter"><i style={{ width: (Math.min(g.ratio, 1.2) / 1.2 * 100).toFixed(1) + '%', background: col }}></i><u style={{ left: '83.3%' }}></u></div>
    <small>{fmt(g.supply)} {unit} for a need of {fmt(g.need)}{g.short > 0 ? ' · short by ' + fmt(g.short) : ' · covered'}</small><Spark fn={fn} c={c} /></div>;
}
function Slider({ label, min, max, step, val, show, note, onChange }: { label: string; min: number; max: number; step: number; val: number; show: (v: number) => string; note?: string; onChange: (v: number) => void }) {
  return <div className="slider"><label><span>{label}</span><span className="num">{show(val)}</span></label>
    <input type="range" min={min} max={max} step={step} value={val} onChange={e => onChange(+e.target.value)} />{note && <small>{note}</small>}</div>;
}

export function PlannerPanel({ A, s, c, dispatch, select, extra }: P) {
  const g = A.gaps(c.t, s.prm, c.pop), over = A.roadShareOver(c.shown, 0.85);
  const prm = (key: keyof State['prm'], scale: number) => (v: number) => dispatch({ type: 'prm', key, value: v * scale });
  const sign = (v: number) => (v > 0 ? '+' : '') + (+v).toFixed(1) + '%';
  const hs = A.hotspots(c.shown, c.base, 5);
  return <>
    <div><p className="sec">Population in the model</p><div className="row">
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.S)}</div><small style={{ color: 'var(--muted)' }}>students in town</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.R)}</div><small style={{ color: 'var(--muted)' }}>other residents</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{fmt(g.pop.total)}</div><small style={{ color: 'var(--muted)' }}>total</small></div></div></div>
    {extra}
    <div><p className="sec">Supply against need</p>
      <GapRow title="Student beds" g={g.beds} unit="beds" fn={t => A.gaps(t, s.prm, c.pop).beds.ratio} c={c} />
      <GapRow title="Homes for residents" g={g.homes} unit="homes" fn={t => A.gaps(t, s.prm, c.pop).homes.ratio} c={c} />
      {g.parking && <><GapRow title={<>Campus-area parking <span className="conf" data-c="low">rough</span></>} g={g.parking} unit="spaces" fn={t => A.gaps(t, s.prm, c.pop).parking!.ratio} c={c} />
        <div className="note" style={{ margin: '-2px 0 6px' }}>Three parking numbers, kept apart: <b>official</b> per-lot counts from BYU-Idaho Parking Services (not published; ask Parking Services), <b>counted</b> stalls from aerial photos (none yet), and the <b>rough</b> lot-area estimate above. New housing shows its code-minimum parking in each project's details.</div></>}
      <div className="gap"><div className="row"><b>Main streets at 85% of capacity or more</b><span className="big">{pct(over)}</span></div><small>Share of modeled street length, {hourLabel(s.hour)}</small></div>
      {c.pop.capYear ? <p className="note warn">With these settings, student beds run out and cap enrollment from fall {c.pop.capYear}. Growth past that point depends on new beds, not demand.</p>
        : <p className="note">With these settings, beds keep pace with enrollment through 2035.</p>}
    </div>
    <div><p className="sec">Assumptions you can change</p>
      <Slider label="Enrollment growth per year" min={-2} max={6} step={0.5} val={s.prm.enroll * 100} show={sign} note="Fall 2025 grew 6.7%. Fall 2026 fell 1.4%." onChange={prm('enroll', 0.01)} />
      <Slider label="Leaving students who stay in town" min={0} max={20} step={1} val={s.prm.stay * 100} show={v => Math.round(v) + '%'} note="No local figure found. Treat as low, medium, high." onChange={prm('stay', 0.01)} />
      <Slider label="New student beds per year" min={0} max={800} step={50} val={s.prm.bedsPerYear} show={fmt} note='Set to 0 for "housing supply stays fixed". Beds cap enrollment.' onChange={prm('bedsPerYear', 1)} />
      {A.CITY.collegeTown && <Slider label="Students who bring a car" min={20} max={90} step={5} val={s.prm.carShare * 100} show={v => Math.round(v) + '%'} note={'Assumed. Spaces are estimated from ' + A.CITY.parkLots + ' mapped lots in the walk district, including church and business lots.'} onChange={prm('carShare', 0.01)} />}
      <Slider label="New homes per year beyond known projects" min={0} max={400} step={20} val={s.prm.unitsPerYear} show={fmt} onChange={prm('unitsPerYear', 1)} />
      <label className="check"><input type="checkbox" checked={s.spring} onChange={e => dispatch({ type: 'spring', on: e.target.checked })} />Spring semester (about 72% of fall students)</label></div>
    <div><p className="sec">Pressure points · {hourLabel(s.hour)}</p><div className="tablewrap"><table><thead><tr><th>Street</th><th>Load</th><th>Basis</th><th>Test a fix</th></tr></thead><tbody>
      {hs.map(h => {
        const lv = A.level(h.vc), d = s.withProjects ? h.delta : 0, name = h.seg.road.name + ' near ' + h.seg.near;
        const cur = s.fixes.find(f => f.road === h.seg.road.name);
        return <tr key={h.seg.road.name}><td><b>{h.seg.road.name}</b><br /><small style={{ color: 'var(--muted)' }}>near {h.seg.near}</small></td>
          <td><span className="num">{pct(h.vc)}</span><br /><small style={{ color: CCOL[Math.max(lv.key, 2)], fontWeight: 600 }}>{lv.label}</small>{d > 0.004 && <><br /><small>projects +{Math.round(d * 100)} pts</small></>}</td>
          <td><small title={h.seg.adtBasis}>{c.routed ? 'Routed trips' : h.seg.counted ? 'City count ' + ((h.seg.adtBasis.match(/\d{4}/) || [''])[0]) : 'Assumed traffic'}<br />{h.seg.road.lanes}{h.seg.road.oneway ? ' lanes one way' : ' lanes'}</small></td>
          <td><select aria-label={'Test a fix on ' + h.seg.road.name} value={cur ? FIXES.find(f => cur.label.startsWith(f.l))?.k ?? '' : ''} onChange={e => {
            const f = FIXES.find(x => x.k === e.target.value); if (!f) return;
            dispatch({ type: 'fix', fix: { road: h.seg.road.name, at: h.seg.mid, factor: f.f, label: f.l + ', ' + name } });
          }}><option value="">Choose</option>{FIXES.map(f => <option key={f.k} value={f.k}>{f.l}</option>)}</select></td></tr>;
      })}</tbody></table></div>
      {s.fixes.length > 0 && <p style={{ margin: '8px 0 4px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>{s.fixes.map((f, i) =>
        <span className="fixchip" key={i}>{f.label}<button aria-label="Remove test" onClick={() => dispatch({ type: 'unfix', index: i })}>×</button></span>)}</p>}
      <p className="note">Fixes are preset capacity changes, so results are relative. Cost, land, utilities and safety standards are outside the model.</p></div>
    <div><p className="sec">Developer-led widenings the city lists with no date</p>
      <p className="note" style={{ margin: '0 0 6px' }}>Tick one to assume it is built (+80% capacity on those streets) and see the effect at {hourLabel(s.hour)}, {qLabel(c.t)}.</p>
      {A.WIDEN.filter(w => w.segs.length).map(w => {
        let mx = 0; w.segs.forEach(i => { mx = Math.max(mx, c.shown[i].vc); });
        return <label className="check" style={{ alignItems: 'flex-start' }} key={w.id}><input type="checkbox" checked={s.widen.includes(w.id)} onChange={e => dispatch({ type: 'widen', id: w.id, on: e.target.checked })} />
          <span>{w.name}<br /><small style={{ color: 'var(--muted)' }}>{w.desc} · busiest part now at {pct(mx)} of capacity</small></span></label>;
      })}
      <p style={{ margin: '4px 0 0', fontSize: 12 }}><a href={A.WIDEN_SRC.url} target="_blank" rel="noopener">{A.WIDEN_SRC.label}</a></p></div>
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
