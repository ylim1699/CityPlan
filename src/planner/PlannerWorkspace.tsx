/* Planner workspace: Now ↔ year toggle with a year slider, a counter strip for the chosen year,
   and ghost projects tied to a year. Ghost traffic comes from the routing worker (scenario.extra). */
import { useEffect, useMemo, useState, type Dispatch } from 'react';
import type { Atlas } from '../model/atlas';
import type { Scenario } from '../model/routing';
import type { XZ } from '../model/types';
import type { Action, State } from '../state';
import type { Computed } from '../components/Panels';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { CCOL, TODAY_I, fmt, hourLabel, pct } from '../ui';
import './planner.css';
import { GHOST_TYPES, KINDS, YEARS, ghostActive, ghostPlans, ghostSupply, newGhost, type Ghost, type GhostKind } from './ghosts';

export const tiOfYear = (y: number) => (y - 2024) * 4 + 3;  /* fall (Q4) of year y */
const yearOf = (t: number) => Math.floor(t);

/* ---------- Year toggle + counters (sits above the timeline in Planner) ---------- */
export function YearStrip({ A, s, c, dispatch, ghosts, trips }: { A: Atlas; s: State; c: Computed; dispatch: Dispatch<Action>; ghosts: Ghost[]; trips: number | null }) {
  const now = s.ti === TODAY_I, y = yearOf(c.t);
  const [lastYear, setLastYear] = useState(2030);
  useEffect(() => { if (!now && y > 2026) setLastYear(y); }, [now, y]);
  const go = (yr: number) => dispatch({ type: 'view', patch: { ti: tiOfYear(yr), withProjects: true } });
  const g = A.gaps(c.t, s.prm, c.pop), sup = ghostSupply(ghosts, c.t);
  const beds = (g.beds.supply + sup.beds) / g.beds.need, homes = (g.homes.supply + sup.units) / g.homes.need;
  const park = g.parking ? (g.parking.supply + sup.spaces) / g.parking.need : null;
  const overNames = useMemo(() => {
    const n = new Set<string>();
    c.shown.forEach((r, i) => { const sg = A.SEGS[i]; if (r.vc >= 1 && sg.road.cls !== 'local' && sg.road.name) n.add(sg.road.name); });
    return [...n];
  }, [A, c.shown]);
  const tone = (r: number) => r >= 1 ? 'ok' : r >= 0.95 ? 'warn' : 'bad';
  const nPlanned = ghosts.filter(gh => gh.status === 'planned' && ghostActive(gh, c.t)).length;
  return <div className="card yearstrip" role="region" aria-label="Planning year">
    <div className="ys-ctl">
      <div className="seg" role="group" aria-label="Now or a future year">
        <button aria-pressed={now} onClick={() => dispatch({ type: 'view', patch: { ti: TODAY_I } })}>Now</button>
        <button aria-pressed={!now} onClick={() => go(lastYear)}>Year</button>
      </div>
      <input type="range" min={2027} max={2034} step={1} value={now ? lastYear : Math.max(2027, y)} aria-label="Planning year"
        onChange={e => go(+e.target.value)} disabled={now} />
      <strong className="ys-year">{now ? '2026 · today' : 'Fall ' + y}</strong>
    </div>
    <div className="ys-counters">
      <Counter k="People" v={(g.pop.total / 1000).toFixed(1) + 'k'} />
      <Counter k="Students" v={fmt(g.pop.S)} />
      <Counter k="Student beds vs need" v={pct(beds)} tone={tone(beds)} />
      <Counter k="Homes vs need" v={pct(homes)} tone={tone(homes)} />
      {park != null && <Counter k="Campus parking vs need" v={pct(park)} tone={tone(park)} rough />}
      <Counter k="Car trips a day" v={trips != null ? fmt(trips) : '…'} />
      <Counter k={'Streets over capacity · ' + hourLabel(s.hour)} v={String(overNames.length)} tone={overNames.length ? 'bad' : 'ok'} title={overNames.join(', ')} />
      <Counter k="Your projects counted" v={String(nPlanned)} />
    </div>
  </div>;
}
function Counter({ k, v, tone, rough, title }: { k: string; v: string; tone?: string; rough?: boolean; title?: string }) {
  return <div className="ys-c" data-tone={tone} title={title}><b className="num">{v}</b><small>{k}{rough && <> <span className="conf" data-c="low">rough</span></>}</small></div>;
}

/* ---------- Ghost tools (right panel, Planner) ---------- */
type ToolsProps = {
  A: Atlas; s: State; c: Computed; sc: Scenario; dispatch: Dispatch<Action>;
  ghosts: Ghost[]; setGhosts: (g: Ghost[]) => void; selId: string | null; setSel: (id: string | null) => void;
  pick: (cb: ((pos: XZ) => void) | null) => void; flyTo: (pos: XZ) => void; target: () => XZ | null;
};
export function GhostTools({ A, s, c, sc, dispatch, ghosts, setGhosts, selId, setSel, pick, flyTo, target }: ToolsProps) {
  const [kind, setKind] = useState<GhostKind>(A.CITY.collegeTown ? 'student' : 'homes');
  const [picking, setPicking] = useState(false);
  const shownYear = s.ti === TODAY_I ? 2030 : Math.max(2027, yearOf(c.t));
  const [year, setYear] = useState(shownYear);
  useEffect(() => { setYear(shownYear); }, [shownYear]);
  const kinds = KINDS.filter(k => A.CITY.collegeTown || (k !== 'student' && k !== 'parking'));
  const ty = GHOST_TYPES[kind];
  const patch = (id: string, p: Partial<Ghost>) => setGhosts(ghosts.map(g => g.id === id ? { ...g, ...p } : g));
  const add = (pos: XZ) => { const g = newGhost(kind, pos, year); setGhosts(ghosts.concat([g])); setSel(g.id); };
  const startPick = () => {
    if (picking) { pick(null); setPicking(false); return; }
    setPicking(true);
    pick(pos => { setPicking(false); add(pos); });
  };
  useEffect(() => () => pick(null), []);
  const sel = ghosts.find(g => g.id === selId) || null;
  return <div className="ghosttools">
    <div className="zoning-banner" role="status"><b>ZONING DATA NOT LOADED</b> · placements are not checked against zoning or ownership yet.</div>
    <p className="sec">Plan a project for a year</p>
    <div className="seg wrap" role="group" aria-label="Project type">
      {kinds.map(k => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{GHOST_TYPES[k].label}</button>)}
    </div>
    <p className="note" style={{ margin: '6px 0' }}>{ty.size}. {ty.note}.</p>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <label className="mini" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>For
        <select value={year} onChange={e => setYear(+e.target.value)} aria-label="Year the project opens">{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <button className="mini act" onClick={startPick} aria-pressed={picking}>{picking ? 'Click the map… (cancel)' : '+ Place on map'}</button>
      <button className="mini" onClick={() => { const p = target(); if (p) add(p); }}>+ Place in view</button>
    </div>
    {ghosts.length > 0 && <div className="list" style={{ marginTop: 8 }}>{ghosts.map(g => {
      const t = GHOST_TYPES[g.kind], act = ghostActive(g, c.t);
      return <div key={g.id} className={'hot ghostrow' + (selId === g.id ? ' on' : '')} onClick={() => setSel(g.id)}>
        <span className="stripe" style={{ background: g.status === 'suggested' ? '#ffcf7a' : '#f0a03a' }}></span>
        <div><b>{t.label} · {t.size}</b>
          <small>{g.status === 'suggested' ? 'Suggested' + (g.why ? ': ' + g.why : '') : act ? 'Counted in this year' : 'Ghost until fall ' + g.year + ', not counted yet'}</small>
          <small>Zoning: not checked (no data)</small></div>
        <span style={{ display: 'grid', gap: 4 }}>
          <select className="mini" value={g.year} aria-label="Opening year" onClick={e => e.stopPropagation()} onChange={e => patch(g.id, { year: +e.target.value })}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
          {g.status === 'suggested' && <button className="mini" onClick={e => { e.stopPropagation(); patch(g.id, { status: 'planned' }); }}>Accept</button>}
          <button className="mini" onClick={e => { e.stopPropagation(); setSel(g.id); flyTo(g.pos); }}>Find</button>
          <button className="mini" onClick={e => { e.stopPropagation(); if (selId === g.id) setSel(null); setGhosts(ghosts.filter(x => x.id !== g.id)); }}>Remove</button>
        </span></div>;
    })}</div>}
    {ghosts.length > 0 && <p className="note" style={{ marginTop: 6 }}>Double-click a ghost on the map to pick it up, then click where it should go.</p>}
    {sel && <Impact A={A} s={s} c={c} sc={sc} g={sel} ghosts={ghosts} dispatch={dispatch} />}
  </div>;
}

/* ---------- Before → after for one ghost: route the year with and without it ---------- */
function Impact({ A, s, c, sc, g, ghosts, dispatch }: { A: Atlas; s: State; c: Computed; sc: Scenario; g: Ghost; ghosts: Ghost[]; dispatch: Dispatch<Action> }) {
  const act = g.status === 'planned' && ghostActive(g, c.t);
  const without = useMemo<Scenario>(() => { const rest = ghostPlans(ghosts.filter(x => x.id !== g.id), sc.t), o: Scenario = { ...sc }; if (rest.length) o.plans = rest; else delete o.plans; return o; }, [sc, ghosts, g.id]);
  const key = JSON.stringify({ k: 'ghost-impact', sc, without: without.plans || [] });
  type Opt = { vht: number; vol: Float64Array; worst?: { vc: number; name: string } | null; planTrips?: number[] };
  const [res, setRes] = useState<{ key: string; w: Opt; wo: Opt } | null>(null);
  useWorkerMessages(m => {
    if (m.type !== 'compare' || m.key !== key) return;
    const w = m.options.find(o => o.id === 'with'), wo = m.options.find(o => o.id === 'without');
    if (w && wo) setRes({ key, w, wo });
  });
  useEffect(() => { if (act) send({ type: 'compare', key, sc, pos: g.pos, options: [{ id: 'with', sc }, { id: 'without', sc: without }] }); }, [key, act]);
  const t = GHOST_TYPES[g.kind];
  if (g.status === 'suggested') return <p className="note" style={{ marginTop: 8 }}>Suggested projects are not counted. Accept it to see its effect.</p>;
  if (!act) return <div className="impact"><p className="sec">Before → after</p>
    <p className="note" style={{ margin: 0 }}>This {t.label.toLowerCase()} counts from fall {g.year}. <button className="mini" onClick={() => dispatch({ type: 'view', patch: { ti: tiOfYear(g.year), withProjects: true } })}>Show {g.year}</button></p></div>;
  const cur = res && res.key === key ? res : null;
  if (!cur) return <div className="impact"><p className="sec">Before → after</p><small>Routing the year with and without it…</small></div>;
  /* per street: biggest load change on main streets near enough to matter */
  const best: Record<string, { n: string; b: number; a: number }> = {};
  c.shown.forEach((r, i) => {
    const sg = A.SEGS[i]; if (sg.road.cls === 'local' || !sg.road.name) return;
    const b = cur.wo.vol[i] / r.cap, a = cur.w.vol[i] / r.cap;
    if (a - b < 0.01) return;
    if (!best[sg.road.name] || a - b > best[sg.road.name].a - best[sg.road.name].b) best[sg.road.name] = { n: sg.road.name + ' near ' + sg.near, b, a };
  });
  const rows = Object.values(best).sort((x, y) => (y.a - y.b) - (x.a - x.b)).slice(0, 5);
  const dv = cur.w.vht - cur.wo.vht;
  return <div className="impact"><p className="sec">Before → after · fall {yearOf(c.t)}, {hourLabel(s.hour)}</p>
    <div className="tiles">
      <div className="tile"><small>Delay on the network</small><b>{dv >= 0 ? '+' : ''}{fmt(dv)} veh-h</b><small>{cur.wo.vht ? (dv >= 0 ? '+' : '') + (dv / cur.wo.vht * 100).toFixed(1) + '%' : ''} in this hour</small></div>
      {cur.w.worst && cur.wo.worst && <div className="tile"><small>Worst main street within 2 km</small><b style={{ color: CCOL[A.level(cur.w.worst.vc).key] }}>{pct(cur.wo.worst.vc)} → {pct(cur.w.worst.vc)}</b><small>{cur.w.worst.name}</small></div>}
      {(() => { const i = ghostPlans(ghosts, sc.t).findIndex(p => p.id === g.id), n = i >= 0 && cur.w.planTrips ? cur.w.planTrips[i] : null;
        return n != null ? <div className="tile"><small>Car trips to and from it</small><b>{fmt(n)} a day</b><small>routed from its own site</small></div> : null; })()}
    </div>
    {rows.length ? <><p className="sec" style={{ marginTop: 8 }}>Streets it loads up</p>{rows.map(x =>
      <div className="chg" key={x.n}><span>{x.n}</span><span className="num">{pct(x.b)} → <b style={{ color: CCOL[A.level(x.a).key] }}>{pct(x.a)}</b> <small>+{Math.round((x.a - x.b) * 100)} pts</small></span></div>)}</>
      : <p className="note">No main street gains a full point at {hourLabel(s.hour)}.{s.hour === 17 ? ' Try 8 am.' : s.hour === 8 ? ' Try 5 pm.' : ' Try 8 am or 5 pm.'}</p>}
    <p className="note" style={{ marginTop: 6 }}>Both runs route every trip in town through the street network for this hour; only this project differs. Its trips start at the site and reach the nearest street by a driveway. Screening, not a site study.</p>
  </div>;
}
