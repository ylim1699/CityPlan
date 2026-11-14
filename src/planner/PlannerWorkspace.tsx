/* Planner workspace: Now ↔ year toggle with a year slider, a counter strip for the chosen year,
   and ghost projects tied to a year. Ghost traffic comes from the routing worker (scenario.extra). */
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Atlas } from '../model/atlas';
import type { Scenario } from '../model/routing';
import type { XZ } from '../model/types';
import type { Action, State } from '../state';
import type { Computed } from '../components/Panels';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { CCOL, TODAY_I, fmt, hourLabel, pct } from '../ui';
import './planner.css';
import { snapSite, type SuggestState } from './suggest';
import type { Highlight } from './ghostLayer';
import { GHOST_TYPES, KINDS, YEARS, ghostActive, ghostPlans, ghostSupply, newGhost, type Ghost, type GhostKind, type GhostRoad } from './ghosts';

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
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('atlas-yearstrip') !== 'closed'; } catch { return true; } });
  const toggle = () => { const o = !open; setOpen(o); try { localStorage.setItem('atlas-yearstrip', o ? 'open' : 'closed'); } catch { /* storage off */ } };
  return <div className={'card yearstrip' + (open ? '' : ' closed')} role="region" aria-label="Planning year">
    <div className="ys-ctl">
      <div className="seg" role="group" aria-label="Now or a future year">
        <button aria-pressed={now} onClick={() => dispatch({ type: 'view', patch: { ti: TODAY_I } })}>Now</button>
        <button aria-pressed={!now} onClick={() => go(lastYear)}>Year</button>
      </div>
      <input type="range" min={2027} max={2034} step={1} value={now ? lastYear : Math.max(2027, y)} aria-label="Planning year"
        onChange={e => go(+e.target.value)} disabled={now} />
      <strong className="ys-year">{now ? '2026 · today' : 'Fall ' + y}</strong>
      <button className="mini" aria-expanded={open} onClick={toggle} title={open ? 'Hide the numbers' : 'Show the numbers'}>{open ? '▾ Numbers' : '▸ Numbers'}</button>
    </div>
    {!open && <small className="ys-mini">Beds {pct(beds)} · Homes {pct(homes)}{park != null ? ' · Parking ' + pct(park) : ''} · {overNames.length} streets over capacity · {nPlanned} of your projects</small>}
    {open && <div className="ys-counters">
      <Counter k="People" v={(g.pop.total / 1000).toFixed(1) + 'k'} />
      <Counter k="Students" v={fmt(g.pop.S)} />
      <Counter k="Student beds vs need" v={pct(beds)} tone={tone(beds)} />
      <Counter k="Homes vs need" v={pct(homes)} tone={tone(homes)} />
      {park != null && <Counter k="Campus parking vs need" v={pct(park)} tone={tone(park)} rough />}
      <Counter k="Car trips a day" v={trips != null ? fmt(trips) : '…'} />
      <Counter k={'Streets over capacity · ' + hourLabel(s.hour)} v={String(overNames.length)} tone={overNames.length ? 'bad' : 'ok'} title={overNames.join(', ')} />
      <Counter k="Your projects counted" v={String(nPlanned)} />
    </div>}
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
  suggest: (kind: GhostKind, n: number, year: number) => void; suggestSt: SuggestState;
  highlight: (list: Highlight[]) => void;
};
export function GhostTools({ A, s, c, sc, dispatch, ghosts, setGhosts, selId, setSel, pick, flyTo, target, suggest, suggestSt, highlight }: ToolsProps) {
  const [kind, setKind] = useState<GhostKind>(A.CITY.collegeTown ? 'student' : 'homes');
  const [picking, setPicking] = useState(false);
  const shownYear = s.ti === TODAY_I ? 2030 : Math.max(2027, yearOf(c.t));
  const [year, setYear] = useState(shownYear);
  useEffect(() => { setYear(shownYear); }, [shownYear]);
  const kinds = KINDS.filter(k => A.CITY.collegeTown || (k !== 'student' && k !== 'parking'));
  const ty = GHOST_TYPES[kind];
  const patch = (id: string, p: Partial<Ghost>) => setGhosts(ghosts.map(g => g.id === id ? { ...g, ...p } : g));
  const add = (pos: XZ) => {  /* placement rules: snap to the nearest legal spot */
    const pl = snapSite(A, kind, pos, ghosts), g = { ...newGhost(kind, pl.pos, year), place: { moved: pl.moved, ok: pl.ok, lot: pl.lot } };
    setGhosts(ghosts.concat([g])); setSel(g.id);
    if (pl.moved > 200) flyTo(pl.pos);  /* you're already looking here; follow it only if the rules moved it far */
  };
  const startPick = () => {
    if (picking) { pick(null); setPicking(false); return; }
    setPicking(true);
    pick(pos => { setPicking(false); add(pos); });
  };
  useEffect(() => () => pick(null), []);
  const sel = ghosts.find(g => g.id === selId) || null;
  return <div className="ghosttools">
    <div className="zoning-banner" role="status"><b>ZONING DATA NOT LOADED</b> · placements follow generic rules only (no buildings, parks or water; parking lots count as redevelopment; 30 m from your other projects; a street within 400 m). Zoning and ownership are not checked.</div>
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
      <button className="mini act" disabled={!!suggestSt.busy} onClick={() => suggest(kind, 3, year)}>Suggest best spots</button>
    </div>
    {(suggestSt.busy || suggestSt.msg) && <p className="note" style={{ margin: 0 }}>{suggestSt.busy || suggestSt.msg}</p>}
    {ghosts.length > 0 && <div className="list" style={{ marginTop: 8 }}>{ghosts.map(g => {
      const t = GHOST_TYPES[g.kind], act = ghostActive(g, c.t);
      return <div key={g.id} className={'hot ghostrow' + (selId === g.id ? ' on' : '')} onClick={() => setSel(g.id)}>
        <span className="stripe" style={{ background: g.status === 'suggested' ? '#ffcf7a' : '#f0a03a' }}></span>
        <div><b>{t.label} · {t.size}</b>
          <small>{g.status === 'suggested' ? 'Suggested' + (g.why ? ': ' + g.why : '') : act ? 'Counted in this year' : 'Ghost until fall ' + g.year + ', not counted yet'}</small>
          <small className={g.place && !g.place.ok ? 'warnline' : undefined}>{!g.place ? (g.status === 'suggested' ? 'Placement: on open land' : 'Placement: not checked') : !g.place.ok ? 'Placement: no open land within 1 km. Check this site' : (g.place.moved ? 'Placement: moved ' + g.place.moved + ' m to ' : 'Placement: on ') + (g.place.lot ? 'a parking lot (redevelopment)' : 'open land')} · zoning not checked</small></div>
        <span style={{ display: 'grid', gap: 4 }}>
          <select className="mini" value={g.year} aria-label="Opening year" onClick={e => e.stopPropagation()} onChange={e => patch(g.id, { year: +e.target.value })}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
          {g.status === 'suggested' && <button className="mini" onClick={e => { e.stopPropagation(); patch(g.id, { status: 'planned', place: g.place || { moved: 0, ok: true } }); }}>Accept</button>}
          <button className="mini" onClick={e => { e.stopPropagation(); setSel(g.id); flyTo(g.pos); }}>Find</button>
          <button className="mini" onClick={e => { e.stopPropagation(); if (selId === g.id) setSel(null); setGhosts(ghosts.filter(x => x.id !== g.id)); }}>Remove</button>
        </span></div>;
    })}</div>}
    {ghosts.length > 0 && <p className="note" style={{ marginTop: 6 }}>Double-click a ghost on the map to pick it up, then click where it should go.</p>}
    {sel ? <Impact A={A} s={s} c={c} sc={sc} g={sel} ghosts={ghosts} dispatch={dispatch} setGhosts={setGhosts} highlight={highlight} /> : <ClearHl highlight={highlight} />}
  </div>;
}

/* ---------- Before → after for one ghost: route the year with and without it ---------- */
function ClearHl({ highlight }: { highlight: (l: Highlight[]) => void }) { useEffect(() => { highlight([]); }, []); return null; }
function Impact({ A, s, c, sc, g, ghosts, dispatch, setGhosts, highlight }: { A: Atlas; s: State; c: Computed; sc: Scenario; g: Ghost; ghosts: Ghost[]; dispatch: Dispatch<Action>; setGhosts: (g: Ghost[]) => void; highlight: (l: Highlight[]) => void }) {
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
  /* glow the streets it loads up on the map: main streets within 2 km gaining 2+ points, one "+N pts" label per street */
  useEffect(() => {
    const r = act && res && res.key === key ? res : null;
    if (!r) { highlight([]); return; }
    const by: Record<string, { segs: [XZ, XZ][]; at: XZ; gain: number }> = {};
    c.shown.forEach((x, i) => {
      const sg = A.SEGS[i]; if (sg.road.cls === 'local' || !sg.road.name || Math.hypot(sg.mid[0] - g.pos[0], sg.mid[1] - g.pos[1]) > 10) return;
      const gain = (r.w.vol[i] - r.wo.vol[i]) / x.cap; if (gain < 0.02) return;
      const h = by[sg.road.name] || (by[sg.road.name] = { segs: [], at: sg.mid, gain: 0 });
      h.segs.push([sg.a, sg.b]); if (gain > h.gain) { h.gain = gain; h.at = sg.mid; }
    });
    highlight(Object.values(by).sort((p, q) => q.gain - p.gain).slice(0, 6)
      .map(h => ({ segs: h.segs, at: h.at, color: h.gain >= 0.1 ? '#e8231a' : '#ff5a1f', label: '+' + Math.round(h.gain * 100) + ' pts' })));
  }, [res, key, act, c.shown]);
  useEffect(() => () => highlight([]), []);
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
    {g.kind !== 'parking' && <AccessRoads s={s} sc={sc} g={g} ghosts={ghosts} setGhosts={setGhosts} trips={(() => { const i = ghostPlans(ghosts, sc.t).findIndex(p => p.id === g.id); return i >= 0 && cur.w.planTrips ? cur.w.planTrips[i] : null; })()} />}
    <p className="note" style={{ marginTop: 6 }}>Both runs route every trip in town through the street network for this hour; only this project differs. Its trips start at the site and reach the nearest street by a driveway. Screening, not a site study.</p>
  </div>;
}

/* ---------- Access roads for one project: slime-mold search proposes, the router judges ---------- */
function AccessRoads({ s, sc, g, ghosts, setGhosts, trips }: { s: State; sc: Scenario; g: Ghost; ghosts: Ghost[]; setGhosts: (g: Ghost[]) => void; trips: number | null }) {
  const [busy, setBusy] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  const job = useRef<{ slime?: string; judge?: string; cands: { to: number; toName: string; pts: XZ[]; lenM: number }[] } | null>(null);
  const roads = g.roads || [];
  const setRoads = (list: GhostRoad[]) => setGhosts(ghosts.map(x => x.id === g.id ? { ...x, roads: list } : x));
  useWorkerMessages(m => {
    const j = job.current; if (!j) return;
    if (m.type === 'slime' && m.key === j.slime) {
      if (!m.cands.length) { job.current = null; setBusy(null); setMsg(m.sinks ? 'Every route to a nearby street crosses buildings or water. Move the project closer to open land.' : 'No street within 2.8 km to connect to.'); return; }
      j.cands = m.cands; j.judge = 'judge:roads:' + Date.now();
      setBusy('Found ' + m.cands.length + ' candidate roads in ' + m.ms + ' ms. The router is testing each one…');
      send({ type: 'judge', key: j.judge, sc, options: m.cands.map((cd, i) => ({ id: String(i), sc: { ...sc, roads: (sc.roads || []).concat([{ id: 'cand', plan: g.id, to: cd.to, lenM: Math.round(cd.lenM), cls: 'collector' as const }]) } })) });
    }
    if (m.type === 'judge' && m.key === j.judge) {
      job.current = null; setBusy(null);
      const tested = m.options.map(o => { const cd = j.cands[+o.id]; return { ...cd, dvht: o.vht - m.base, vol: o.roadVol?.cand?.vol ?? 0 }; });
      const good = tested.filter(x => x.dvht < -0.05).sort((a, b) => a.dvht / a.lenM - b.dvht / b.lenM).slice(0, 3);
      const keep = (g.roads || []).filter(r => r.status === 'planned');
      setRoads(keep.concat(good.map((x, i) => ({ id: 'road-' + g.id + '-' + Date.now().toString(36) + i, to: x.to, toName: x.toName, pts: x.pts, lenM: x.lenM, status: 'suggested' as const, dvht: x.dvht, vol: x.vol }))));
      setMsg(good.length ? good.length + ' of ' + tested.length + ' candidate roads save driving time. They are dashed on the map; accept the one you want.'
        : 'The router tested ' + tested.length + ' candidate roads and none saves driving time at ' + hourLabel(sc.hour) + '. The single driveway is enough.');
    }
  });
  const run = () => {
    setMsg(null); setBusy('Slime-mold search: growing paths from the site to nearby streets, around buildings and water…');
    const k = 'slime:' + Date.now(); job.current = { slime: k, cands: [] };
    send({ type: 'slime', key: k, site: g.pos, rad: 14 });
  };
  const sug = roads.filter(r => r.status === 'suggested'), mine = roads.filter(r => r.status === 'planned');
  const line = (r: GhostRoad) => 'to ' + (r.toName || 'a local street') + ', ' + fmt(r.lenM) + ' m' + (r.dvht != null ? ' · Router: ' + (r.dvht < 0 ? '−' : '+') + Math.abs(r.dvht).toFixed(1) + ' veh-h at ' + hourLabel(s.hour) : '') + (r.vol ? ' · ' + fmt(r.vol) + ' cars an hour' : '');
  return <div style={{ marginTop: 8 }}><p className="sec">Access roads</p>
    {trips != null && !mine.length && <small style={{ display: 'block', color: 'var(--muted)' }}>{trips >= 1200 ? 'One driveway carries ' : 'Its driveway carries '}{fmt(trips)} car trips a day.</small>}
    {mine.map(r => <div className="chg" key={r.id}><span><b>Your road</b> {line(r)}</span><button className="mini" onClick={() => setRoads(roads.filter(x => x.id !== r.id))}>Remove</button></div>)}
    {sug.map(r => <div className="chg" key={r.id}><span><b>Option {roads.indexOf(r) + 1}</b> {line(r)}{Math.abs(r.dvht || 0) > 20 ? <><br /><small className="warnline">Large saving: it probably becomes a shortcut for through traffic. Check before accepting.</small></> : null}</span>
      <span style={{ display: 'grid', gap: 4 }}><button className="mini act" onClick={() => setRoads(roads.filter(x => x.status === 'planned' || x.id === r.id).map(x => x.id === r.id ? { ...x, status: 'planned' as const } : x))}>Accept</button>
        <button className="mini" onClick={() => setRoads(roads.filter(x => x.id !== r.id))}>Dismiss</button></span></div>)}
    {busy ? <small>{busy}</small> : <button className="mini act" style={{ marginTop: 4 }} onClick={run}>{sug.length || mine.length ? 'Search again' : 'Suggest access roads'}</button>}
    {msg && !busy && <p className="note" style={{ margin: '6px 0 0' }}>{msg}</p>}
    <p className="note" style={{ margin: '6px 0 0' }}>The slime-mold search only proposes roads; the router keeps the ones that cut total driving time in this hour. New roads are modeled as two-lane collectors. Cost, right-of-way and grades are not checked.</p>
  </div>;
}
