/* Planner workspace: Now ↔ year toggle with a year slider, a counter strip for the chosen year,
   and ghost projects tied to a year. Ghost traffic comes from the routing worker (scenario.extra). */
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { createPortal } from 'react-dom';
import type { Atlas } from '../model/atlas';
import type { Scenario } from '../model/routing';
import type { SegResult, XZ } from '../model/types';
import type { Action, State } from '../state';
import type { Computed } from '../components/Panels';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { CCOL, TODAY_I, fmt, hourLabel, pct } from '../ui';
import './planner.css';
import { candidates, screen, snapSite, type SuggestState } from './suggest';
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

/* ---------- Planner flow (right panel): 1 Place → 2 Impact → 3 Better spot or road fix → 4 Decide ---------- */
type ToolsProps = {
  A: Atlas; s: State; c: Computed; sc: Scenario; dispatch: Dispatch<Action>;
  ghosts: Ghost[]; setGhosts: (g: Ghost[]) => void; selId: string | null; setSel: (id: string | null) => void;
  pick: (cb: ((pos: XZ) => void) | null) => void; flyTo: (pos: XZ) => void; target: () => XZ | null;
  flyClose?: (pos: XZ) => void;
  suggest: (kind: GhostKind, n: number, year: number) => void; suggestSt: SuggestState;
  highlight: (list: Highlight[]) => void; mark: (pos: XZ | null, label?: string) => void; select: (id: string) => void;
};
export function GhostTools(p: ToolsProps) {
  const { A, s, c, dispatch, ghosts, setGhosts, selId, setSel, pick, flyTo, target, highlight } = p;
  /* the grocery store is the default: its traffic depends a lot on where it goes, which is what the tool is for */
  const [kind, setKind] = useState<GhostKind>('grocery');
  const [picking, setPicking] = useState(false);
  const shownYear = s.ti === TODAY_I ? 2030 : Math.max(2027, yearOf(c.t));
  const [year, setYear] = useState(shownYear);
  useEffect(() => { setYear(shownYear); }, [shownYear]);
  const kinds = KINDS.filter(k => A.CITY.collegeTown || (k !== 'student' && k !== 'parking'));
  const ty = GHOST_TYPES[kind];
  const patch = (id: string, q: Partial<Ghost>) => setGhosts(ghosts.map(g => g.id === id ? { ...g, ...q } : g));
  const add = (pos: XZ) => {  /* placement rules: snap to the nearest legal spot; it starts as a draft */
    const pl = snapSite(A, kind, pos, ghosts), g: Ghost = { ...newGhost(kind, pl.pos, year), draft: true, place: { moved: pl.moved, ok: pl.ok, lot: pl.lot } };
    setGhosts(ghosts.concat([g])); setSel(g.id);
    if (!s.withNew) dispatch({ type: 'scenario', withNew: true });  /* you're placing one: count new projects again */
    dispatch({ type: 'view', patch: { ti: tiOfYear(year), sel: null } });  /* show the year it opens, so the impact runs right away */
    if (pl.moved > 200) flyTo(pl.pos);  /* you're already looking here; follow it only if the rules moved it far */
  };
  const startPick = () => {
    if (picking) { pick(null); setPicking(false); return; }
    setPicking(true);
    pick(pos => { setPicking(false); add(pos); });
  };
  useEffect(() => () => pick(null), []);
  const sel = ghosts.find(g => g.id === selId) || null;
  const act = !!sel && sel.status === 'planned' && ghostActive(sel, c.t);
  const mine = ghosts.filter(g => g.status === 'planned'), sugg = ghosts.filter(g => g.status === 'suggested');
  const [rec, setRec] = useState<{ kind: GhostKind; year: number; n: number } | null>(null);
  /* the selected project's view: Impact first; Better spot and Roads once the map shows the year it opens */
  const [tab, setTab] = useState<'impact' | 'spot' | 'roads'>('impact');
  useEffect(() => { setTab('impact'); }, [selId]);
  const remove = (id: string) => { if (selId === id) setSel(null); setGhosts(ghosts.filter(x => x.id !== id)); };
  const stOf = (g: Ghost) => g.status === 'suggested' ? 'Suggested' : g.draft ? 'Draft' : 'In plan';
  return <div className="ghosttools build">
    {/* always in reach: the year on the map, and adding a project */}
    <div className="bt-top">
      <YearLine A={A} s={s} c={c} ghosts={ghosts} selId={selId} />
      <div className="bt-add">
        <select aria-label="Project type" value={kind} onChange={e => setKind(e.target.value as GhostKind)}>
          {kinds.map(k => <option key={k} value={k} title={GHOST_TYPES[k].size}>{GHOST_TYPES[k].label}</option>)}</select>
        <select aria-label="Year the project opens" value={year} onChange={e => setYear(+e.target.value)}>{YEARS.map(y => <option key={y} value={y}>Opens fall {y}</option>)}</select>
        <button className="mini act" onClick={startPick} aria-pressed={picking}>{picking ? 'Cancel' : '+ Place on map'}</button>
        <button className="mini" onClick={() => { const q = target(); if (q) add(q); }} title="Put it in the middle of the map view">+ In view</button>
        {kind !== 'parking' && <button className="mini ai" onClick={() => { pick(null); setPicking(false); setRec({ kind, year, n: Date.now() }); }} title="Route the best open sites for this project">✦ Best spots</button>}
      </div>
      {picking && <small className="bt-hint">Click the map where it would go; it snaps to the nearest open land.</small>}
    </div>
    {rec && <AiRec key={rec.n} A={A} c={c} sc={p.sc} kind={rec.kind} year={rec.year} hour={s.hour} ghosts={ghosts} dispatch={dispatch}
      fly={p.flyClose || flyTo} mark={p.mark} onPlace={q => { setRec(null); add(q); }} onClose={() => setRec(null)} />}

    {/* your projects as chips: click one to work on it */}
    <div className="bt-plan">
      <div className="row"><p className="sec" style={{ margin: 0 }}>Your projects · {mine.filter(g => !g.draft).length} in plan, {mine.filter(g => g.draft).length} draft{sugg.length ? ', ' + sugg.length + ' suggested' : ''}</p>
        {ghosts.length > 0 && <button className="linkbtn" onClick={() => { if (window.confirm('Delete all ' + ghosts.length + ' of your projects?')) { setSel(null); setGhosts([]); p.mark(null); } }}>Clear all</button>}</div>
      {ghosts.length === 0 ? <p className="note" style={{ margin: '4px 0 0' }}>None yet. Pick a type above and place it.</p>
        : <div className="bt-chips">{ghosts.map(g => <button key={g.id} className={'bt-chip' + (selId === g.id ? ' on' : '')} data-s={stOf(g)} onClick={() => { setSel(g.id); flyTo(g.pos); }}>
            <i />{GHOST_TYPES[g.kind].label}<small>{g.year}{g.place && !g.place.ok ? ' ⚠' : ''}</small></button>)}</div>}
    </div>

    {!sel ? <p className="note bt-empty">On the map: <b>drag</b> a project to move it, <b>click</b> it to select it, then ✕ Delete (or the Delete key) to remove it.</p>
      : <section className="bt-sel">
        <header><div><b>{GHOST_TYPES[sel.kind].label}</b><small>{GHOST_TYPES[sel.kind].size} · opens fall {sel.year} · <span className="tag" data-s={stOf(sel)}>{stOf(sel)}</span></small></div>
          <button className="mini" onClick={() => setSel(null)} aria-label="Close this project">Done</button></header>
        {sel.place && !sel.place.ok && <p className="note warn" style={{ margin: '0 0 6px' }}>No open land fits here: check the site.</p>}
        <div className="seg bt-tabs" role="tablist" aria-label="About this project">
          <button role="tab" aria-selected={tab === 'impact'} aria-pressed={tab === 'impact'} onClick={() => setTab('impact')}>Impact</button>
          <button role="tab" aria-selected={tab === 'spot'} aria-pressed={tab === 'spot'} onClick={() => setTab('spot')}>Better spot</button>
          {sel.kind !== 'parking' && <button role="tab" aria-selected={tab === 'roads'} aria-pressed={tab === 'roads'} onClick={() => setTab('roads')}>Roads</button>}
        </div>
        <div className="bt-body">
          {tab === 'impact' ? <Impact A={A} s={s} c={c} sc={p.sc} g={sel} ghosts={ghosts} dispatch={dispatch} highlight={highlight} select={p.select} />
            : !act ? <p className="note" style={{ margin: 0 }}>This compares traffic in the year it opens. <button className="mini" onClick={() => dispatch({ type: 'view', patch: { ti: tiOfYear(sel.year), sel: null } })}>Show fall {sel.year}</button></p>
            : tab === 'spot' ? <BetterSpot A={A} sc={p.sc} shown={c.shown} g={sel} ghosts={ghosts} setGhosts={setGhosts} flyTo={flyTo} mark={p.mark} hour={s.hour} />
            : <AccessRoads s={s} sc={p.sc} g={sel} ghosts={ghosts} setGhosts={setGhosts} />}
        </div>
        {/* the decision stays at the bottom of the panel, whatever is open above */}
        <footer className="bt-decide">
          {sel.status === 'suggested' ? <><button className="mini act" onClick={() => patch(sel.id, { status: 'planned', draft: false, place: sel.place || { moved: 0, ok: true } })}>Add to plan</button>
              <button className="mini" onClick={() => remove(sel.id)}>Dismiss</button></>
            : sel.draft ? <><button className="mini act" onClick={() => patch(sel.id, { draft: false })}>Add to plan</button>
              <small>Drafts count only while selected.</small></>
            : <><b className="inplan">✓ In the plan</b><button className="mini" onClick={() => patch(sel.id, { draft: true })}>Take out</button></>}
          <button className="mini danger" onClick={() => remove(sel.id)}>✕ Delete</button>
        </footer>
      </section>}

    <details className="bt-zoning"><summary>Zoning is not checked</summary>Checked: no buildings, parks or water under it (parking lots count as redevelopment), 30 m from your other projects, a street within 400 m. Not checked: zoning, ownership, utilities, cost.</details>
    {!sel && <ClearHl highlight={highlight} />}
  </div>;
}
/* one line for the year on the map: is the city keeping up, and how many main streets are over capacity */
function YearLine({ A, s, c, ghosts, selId }: { A: Atlas; s: State; c: Computed; ghosts: Ghost[]; selId: string | null }) {
  const g = A.gaps(c.t, s.prm, c.pop), sup = ghostSupply(ghosts, c.t, selId);
  const beds = (g.beds.supply + sup.beds) / g.beds.need, homes = (g.homes.supply + sup.units) / g.homes.need;
  const over = useMemo(() => { const n = new Set<string>(); c.shown.forEach((r, i) => { const sg = A.SEGS[i]; if (r.vc >= 1 && sg.road.cls !== 'local' && sg.road.name) n.add(sg.road.name); }); return n.size; }, [A, c.shown]);
  const tone = (r: number) => r >= 1 ? 'ok' : r >= 0.95 ? 'warn' : 'bad';
  return <div className="yearline"><b>{s.ti === TODAY_I ? 'Today' : 'Fall ' + yearOf(c.t)} · {hourLabel(s.hour)}</b>
    <span data-tone={tone(beds)}>Beds {pct(beds)}</span><span data-tone={tone(homes)}>Homes {pct(homes)}</span>
    <span data-tone={over ? 'bad' : 'ok'}>{over} main street{over === 1 ? '' : 's'} over capacity</span></div>;
}

/* the trade-off under each site: the worst main street near it and the biggest jump any one main street takes */
function Trade({ r }: { r: { worst?: { vc: number; name: string } | null; jump?: { pts: number; name: string; vc: number } | null } }) {
  const j = r.jump && r.jump.pts >= 0.01 ? r.jump : null;
  return <>{r.worst && r.worst.name && <small>Worst street nearby: {pct(r.worst.vc)}, {r.worst.name}</small>}
    {j && <small className={j.pts >= 0.2 ? 'warnline' : undefined}>Biggest jump: +{Math.round(j.pts * 100)} pts on {j.name}{j.vc >= 1 ? ' (over capacity)' : ''}</small>}</>;
}

/* ---------- Step 3: your spot against the best open sites, all routed for the same year and hour ---------- */
/* ---------- AI recommendation: screen open land, route the year with each site, then walk the planner through the best ones ---------- */
function AiRec({ A, c, sc, kind, year, hour, ghosts, dispatch, fly, mark, onPlace, onClose }: { A: Atlas; c: Computed; sc: Scenario; kind: GhostKind; year: number; hour: number; ghosts: Ghost[]; dispatch: Dispatch<Action>; fly: (p: XZ) => void; mark: (p: XZ | null, l?: string) => void; onPlace: (p: XZ) => void; onClose: () => void }) {
  type Row = { pos: XZ; km: number; dv: number; worst?: { vc: number; name: string } | null; jump?: { pts: number; name: string; vc: number } | null };
  const [rows, setRows] = useState<Row[] | null>(null), [i, setI] = useState(0), [msg, setMsg] = useState('Switching the map to fall ' + year + '…');
  const job = useRef<{ key: string; picks: { pos: XZ; km: number }[] } | null>(null), started = useRef(false);
  const ty = GHOST_TYPES[kind], ready = yearOf(c.t) === year;
  useEffect(() => { if (!ready) dispatch({ type: 'view', patch: { ti: tiOfYear(year), sel: null } }); }, []);
  useEffect(() => { document.body.classList.add('rec-open'); return () => { document.body.classList.remove('rec-open'); mark(null); }; }, []);
  useWorkerMessages(m => {
    const j = job.current; if (m.type !== 'judge' || !j || m.key !== j.key) return;
    job.current = null;
    const r = m.options.map(o => ({ pos: j.picks[+o.id].pos, km: j.picks[+o.id].km, dv: o.vht - m.base, worst: o.worst, jump: o.jump })).sort((a, b) => a.dv - b.dv).slice(0, 5);
    setRows(r); setI(0);
  });
  useEffect(() => {  /* run once the map shows the year it opens, so the screen and the routing use that year's traffic */
    if (!ready || started.current) return; started.current = true;
    setMsg('Screening open land…');
    setTimeout(() => {
      const avoid = ghosts.map(g => g.pos);
      const scored = candidates(A, kind).filter(q => !avoid.some(v => Math.hypot(v[0] - q[0], v[1] - q[1]) < 3))
        .map(q => ({ pos: q, s: screen(A, kind, q, c.shown) })).filter(x => x.s).sort((a, b) => a.s!.score - b.s!.score);
      const picks: { pos: XZ; km: number }[] = [];
      for (const x of scored) { if (picks.length >= 8) break; if (!picks.some(v => Math.hypot(v.pos[0] - x.pos[0], v.pos[1] - x.pos[1]) < 4)) picks.push({ pos: x.pos, km: x.s!.km }); }
      if (!picks.length) { setRows([]); return; }
      const base: Scenario = { ...sc }, rest = ghostPlans(ghosts, sc.t);  /* your plan without drafts */
      if (rest.length) base.plans = rest; else delete base.plans;
      const key = 'judge:airec:' + Date.now(); job.current = { key, picks };
      setMsg('Routing every trip in town with each of ' + picks.length + ' open sites…');
      send({ type: 'judge', key, sc: base, options: picks.map((q, k) => ({ id: String(k), pos: q.pos, sc: { ...base, plans: (base.plans || []).concat([{ id: 'cand', pos: q.pos, beds: ty.beds || 0, units: ty.units || 0, attract: ty.trips || 0 }]) } })) });
    }, 30);
  }, [ready]);
  const r = rows && rows[i];
  useEffect(() => { if (r) { fly(r.pos); mark(r.pos, 'AI pick ' + (i + 1)); } }, [r]);
  const best = rows && rows.length ? rows[0].dv : 0, worstDv = rows && rows.length ? rows[rows.length - 1].dv : 0;
  return createPortal(<div className="airec" role="dialog" aria-label="AI recommendation">
    <div className="airec-head"><b>✦ AI recommendation</b><small>{ty.label} · opens fall {year}</small>
      <button className="airec-x" aria-label="Close" onClick={onClose}>✕</button></div>
    {!rows ? <p className="note" style={{ margin: 0 }}>{msg}</p>
      : !r ? <p className="note" style={{ margin: 0 }}>No open site near a main street was found for this project type.</p>
      : <>
        <div className="airec-pick"><b>Spot {i + 1} of {rows.length}</b><small>{i === 0 ? 'least added delay of the sites tested' : 'ranked by added delay'}</small></div>
        <div className="airec-nums">
          <div><small>Added delay, {hourLabel(hour)}</small><b>+{r.dv.toFixed(1)} veh-h</b>{i > 0 && <small>+{(r.dv - best).toFixed(1)} vs spot 1</small>}{i === 0 && rows.length > 1 && <small>{(worstDv - best).toFixed(1)} less than spot {rows.length}</small>}</div>
          {r.worst && <div><small>Worst street nearby</small><b style={{ color: CCOL[A.level(r.worst.vc).key] }}>{pct(r.worst.vc)}</b>{r.worst.name && <small>{r.worst.name}</small>}</div>}
          {r.jump && <div><small>Biggest jump</small><b className={r.jump.pts >= 0.2 ? 'warn' : ''}>+{Math.round(r.jump.pts * 100)} pts</b><small>{r.jump.name}</small></div>}
          <div><small>To campus</small><b>{r.km.toFixed(1)} km</b></div>
        </div>
        <div className="airec-btns">
          <button className="mini" disabled={i === 0} onClick={() => setI(i - 1)}>‹ Back</button>
          <button className="mini" disabled={i >= rows.length - 1} onClick={() => setI(i + 1)}>Next ›</button>
          <button className="mini act" onClick={() => onPlace(r.pos)}>Place it here</button>
        </div>
        <p className="note" style={{ margin: '6px 0 0' }}>Traffic only: zoning, ownership and cost are not checked. You decide.</p>
      </>}
  </div>, document.body);
}

function BetterSpot({ A, sc, shown, g, ghosts, setGhosts, flyTo, mark, hour }: { A: Atlas; sc: Scenario; shown: SegResult[]; g: Ghost; ghosts: Ghost[]; setGhosts: (g: Ghost[]) => void; flyTo: (p: XZ) => void; mark: (p: XZ | null, l?: string) => void; hour: number }) {
  type Row = { id: string; pos: XZ; km: number; dv: number; worst?: { vc: number; name: string } | null; jump?: { pts: number; name: string; vc: number } | null };
  const [now, setNow] = useState<{ where: string; dv: Record<string, number> } | null>(null);
  const where = g.pos[0].toFixed(2) + ',' + g.pos[1].toFixed(2) + ':' + g.kind + ':' + sc.t + ':' + hour;
  const [res, setRes] = useState<{ where: string; mine: Row; opts: Row[]; n: number } | null>(null), [busy, setBusy] = useState<string | null>(null);
  const job = useRef<{ key: string; where: string; picks: { pos: XZ; km: number }[] } | null>(null), nowJob = useRef<{ key: string; where: string } | null>(null);
  useWorkerMessages(m => {
    const nj = nowJob.current;
    if (m.type === 'judge' && nj && m.key === nj.key) { nowJob.current = null; const dv: Record<string, number> = {}; m.options.forEach(o => { dv[o.id] = o.vht - m.base; }); setNow({ where: nj.where, dv }); return; }
    const j = job.current; if (m.type !== 'judge' || !j || m.key !== j.key) return;
    job.current = null; setBusy(null);
    const rows: Row[] = m.options.map(o => ({ id: o.id, pos: j.picks[+o.id].pos, km: j.picks[+o.id].km, dv: o.vht - m.base, worst: o.worst, jump: o.jump }));
    const me = rows[0], opts = rows.slice(1).sort((a, b) => a.dv - b.dv).slice(0, 3);  /* the 3 best other sites, better or not, so you can see where yours ranks */
    setRes({ where: j.where, mine: me, opts, n: rows.length - 1 });
  });
  useEffect(() => () => mark(null), []);
  const camp = A.M(A.OSM.places.campus), kmOf = (q: XZ) => Math.hypot(q[0] - camp[0], q[1] - camp[1]) * 0.2;
  const run = () => {
    setBusy('Screening open land…'); setRes(null); mark(null);
    setTimeout(() => {
      const others = ghosts.filter(x => x.id !== g.id), avoid = others.map(x => x.pos);
      const scored = candidates(A, g.kind).filter(q => !avoid.some(v => Math.hypot(v[0] - q[0], v[1] - q[1]) < 3) && Math.hypot(g.pos[0] - q[0], g.pos[1] - q[1]) > 2)
        .map(q => ({ pos: q, s: screen(A, g.kind, q, shown) })).filter(x => x.s).sort((a, b) => a.s!.score - b.s!.score);
      const picks: { pos: XZ; km: number }[] = [{ pos: g.pos, km: kmOf(g.pos) }];
      for (const x of scored) { if (picks.length >= 9) break; if (!picks.slice(1).some(v => Math.hypot(v.pos[0] - x.pos[0], v.pos[1] - x.pos[1]) < 4)) picks.push({ pos: x.pos, km: x.s!.km }); }
      if (picks.length < 2) { setBusy(null); setRes({ where, mine: { id: '0', pos: g.pos, km: kmOf(g.pos), dv: 0, worst: null, jump: null }, opts: [], n: 0 }); return; }
      const base: Scenario = { ...sc }, rest = ghostPlans(others, sc.t);
      if (rest.length) base.plans = rest; else delete base.plans;
      const ty = GHOST_TYPES[g.kind], key = 'judge:spot:' + Date.now();
      job.current = { key, where, picks };
      setBusy('Routing every trip in town with your spot and ' + (picks.length - 1) + ' open sites…');
      send({ type: 'judge', key, sc: base, options: picks.map((q, i) => ({ id: String(i), pos: q.pos, sc: { ...base, plans: (base.plans || []).concat([{ id: 'cand', pos: q.pos, beds: ty.beds || 0, units: ty.units || 0, attract: ty.trips || 0 }]) } })) });
      /* the same sites on today's streets, alone: what it would do if it opened now */
      const today: Scenario = { ...sc, t: A.TODAY }; delete today.plans; delete today.roads;
      const nk = 'judge:spotnow:' + Date.now(); nowJob.current = { key: nk, where }; setNow(null);
      send({ type: 'judge', key: nk, sc: today, options: picks.map((q, i) => ({ id: String(i), sc: { ...today, plans: [{ id: 'cand', pos: q.pos, beds: ty.beds || 0, units: ty.units || 0, attract: ty.trips || 0 }] } })) });
    }, 30);
  };
  const use = (r: Row) => { mark(null); setGhosts(ghosts.map(x => x.id === g.id ? { ...x, pos: r.pos, place: { moved: 0, ok: true }, roads: undefined } : x)); flyTo(r.pos); };
  const cur = res && res.where === where ? res : null;
  const L = 'ABC';
  const nw = now && now.where === where ? now.dv : null;
  const nowOf = (r: Row) => nw && nw[r.id] != null ? <small className="now">today alone +{nw[r.id].toFixed(1)}</small> : <small className="now">today: routing…</small>;
  const best = !cur ? -1 : cur.opts.reduce((b, r, i) => r.dv < (b < 0 ? cur.mine.dv : cur.opts[b].dv) ? i : b, -1);  /* -1 = your spot */
  /* cycle the map through the options (and back to your spot); -1 = your spot */
  const [at, setAt] = useState(-1);
  const go = (i: number) => { if (!cur) return; setAt(i); const r = i < 0 ? cur.mine : cur.opts[i]; flyTo(r.pos); mark(r.pos, i < 0 ? 'Your spot' : 'Site ' + L[i]); };
  useEffect(() => { if (cur && cur.opts.length) go(0); else setAt(-1); }, [res]);
  const step = (d: number) => { if (!cur) return; const n = cur.opts.length + 1; go(((at + 1 + d) % n + n) % n - 1); };
  if (g.kind === 'parking') return <p className="note" style={{ margin: 0 }}>Parking adds no trips of its own, so the router can't rank parking sites. Judge it by walking distance to campus.</p>;
  return <div className="better">
    {!cur && !busy && <button className="mini act" onClick={run}>Compare your spot with other sites</button>}
    {busy && <small>{busy}</small>}
    {cur && <>
      {cur.opts.length > 0 && <div className="cycle">
        <button className="mini" aria-label="Previous" onClick={() => step(-1)}>‹</button>
        <span><b>{at < 0 ? 'Your spot' : 'Site ' + L[at]}{best === at && ' ★'}</b><small>{at < 0 ? 'where you placed it' : (cur.opts[at].dv < cur.mine.dv ? 'saves ' + Math.round((1 - cur.opts[at].dv / Math.max(cur.mine.dv, 0.01)) * 100) + '%' : 'adds more than yours') + ' · ' + (at + 1) + ' of ' + cur.opts.length}</small></span>
        <button className="mini" aria-label="Next" onClick={() => step(1)}>›</button>
        {at >= 0 && <button className="mini act" onClick={() => use(cur.opts[at])}>Place here</button>}
      </div>}
      <div className="cmp head"><span>Site</span><span>Added delay, {hourLabel(hour)}<small>fall {Math.floor(sc.t)} with other plans · today alone</small></span><span></span></div>
      <div className={'cmp mine' + (at < 0 ? ' on' : '')} onClick={() => go(-1)}><span><b>Your spot</b><small>{cur.mine.km.toFixed(1)} km to campus</small><Trade r={cur.mine} /></span><span className="num">+{cur.mine.dv.toFixed(1)} veh-h{nowOf(cur.mine)}{best === -1 && <small className="best">★ best</small>}</span><span></span></div>
      {cur.opts.map((r, i) => <div className={'cmp' + (at === i ? ' on' : '')} key={r.id} onClick={() => go(i)}>
        <span><b>Site {L[i]}</b><small>{r.km.toFixed(1)} km to campus · open land</small><Trade r={r} /></span>
        <span className="num">+{r.dv.toFixed(1)} veh-h{nowOf(r)}{r.dv < cur.mine.dv ? <small className="save">saves {(cur.mine.dv - r.dv).toFixed(1)} ({Math.round((1 - r.dv / Math.max(cur.mine.dv, 0.01)) * 100)}%)</small> : <small className="more">+{(r.dv - cur.mine.dv).toFixed(1)} more than yours</small>}{best === i && <small className="best">★ best</small>}</span>
        <span><button className="mini act" onClick={e => { e.stopPropagation(); use(r); }}>Place here</button></span></div>)}
      <p className="note" style={{ margin: '6px 0 0' }}>{!cur.n ? 'No other open site near a main street was found.'
        : best === -1 ? 'Your spot adds the least delay of ' + (cur.n + 1) + ' sites tested.' + (cur.mine.jump && cur.mine.jump.pts >= 0.2 ? ' It still pushes ' + cur.mine.jump.name + ' up ' + Math.round(cur.mine.jump.pts * 100) + ' points: try a road fix below.' : '')
        : 'Site ' + L[best] + ' adds the least delay of ' + (cur.n + 1) + ' sites tested. Less total delay can still overload one street: check the biggest jump.'}
        {' '}Ranked by fall {Math.floor(sc.t)}, with everything else planned by then.{' '}
        <button className="linkbtn" onClick={run}>Run again</button></p>
    </>}
  </div>;
}

/* ---------- Before → after for one ghost: route the year with and without it ---------- */
function ClearHl({ highlight }: { highlight: (l: Highlight[]) => void }) { useEffect(() => { highlight([]); }, []); return null; }
function Impact({ A, s, c, sc, g, ghosts, dispatch, highlight, select }: { A: Atlas; s: State; c: Computed; sc: Scenario; g: Ghost; ghosts: Ghost[]; dispatch: Dispatch<Action>; highlight: (l: Highlight[]) => void; select: (id: string) => void }) {
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
  if (g.status === 'suggested') return <p className="note" style={{ margin: 0 }}>Suggested projects are not counted. Add it to the plan (step 4) to see its effect.</p>;
  if (!act) return <div className="impact"><p className="note" style={{ margin: 0 }}>This {t.label.toLowerCase()} opens in fall {g.year}; the map shows an earlier time. <button className="mini act" onClick={() => dispatch({ type: 'view', patch: { ti: tiOfYear(g.year) } })}>Show fall {g.year}</button></p></div>;
  const cur = res && res.key === key ? res : null;
  if (!cur) return <div className="impact"><small>Routing every trip in town for fall {yearOf(c.t)}, with and without it…</small></div>;
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
  return <div className="impact"><p className="sec" style={{ marginTop: 0 }}>Before → after · fall {yearOf(c.t)}, {hourLabel(s.hour)}</p>
    <div className="tiles">
      <div className="tile"><small>Delay on the network</small><b>{dv >= 0 ? '+' : ''}{fmt(dv)} veh-h</b><small>{cur.wo.vht ? (dv >= 0 ? '+' : '') + (dv / cur.wo.vht * 100).toFixed(1) + '%' : ''} in this hour</small></div>
      {cur.w.worst && cur.wo.worst && <div className="tile"><small>Worst main street within 2 km</small><b style={{ color: CCOL[A.level(cur.w.worst.vc).key] }}>{pct(cur.wo.worst.vc)} → {pct(cur.w.worst.vc)}</b><small>{cur.w.worst.name}</small></div>}
      {(() => { const i = ghostPlans(ghosts, sc.t, g.id).findIndex(p => p.id === g.id), n = i >= 0 && cur.w.planTrips ? cur.w.planTrips[i] : null;
        return n != null ? <div className="tile"><small>Car trips to and from it</small><b>{fmt(n)} a day</b><small>routed from its own site</small></div> : null; })()}
    </div>
    {rows.length ? <><p className="sec" style={{ marginTop: 8 }}>Streets it loads up</p>{rows.map(x =>
      <div className="chg" key={x.n}><span>{x.n}</span><span className="num">{pct(x.b)} → <b style={{ color: CCOL[A.level(x.a).key] }}>{pct(x.a)}</b> <small>+{Math.round((x.a - x.b) * 100)} pts</small></span></div>)}</>
      : <p className="note">No main street gains a full point at {hourLabel(s.hour)}.{s.hour === 17 ? ' Try 8 am.' : s.hour === 8 ? ' Try 5 pm.' : ' Try 8 am or 5 pm.'}</p>}
    <Coming A={A} g={g} t={c.t} select={select} />
    <p className="note" style={{ marginTop: 6 }}>Both runs route every trip in town through the street network for this hour; only this project differs. Its trips start at the site and reach the nearest street by a driveway. Screening, not a site study.</p>
  </div>;
}

/* ---------- Access roads for one project: slime-mold search proposes, the router judges ---------- */
function AccessRoads({ s, sc, g, ghosts, setGhosts, trips = null }: { s: State; sc: Scenario; g: Ghost; ghosts: Ghost[]; setGhosts: (g: Ghost[]) => void; trips?: number | null }) {
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
  return <div style={{ marginTop: 10 }}><p className="sec">Or a road fix: new access road</p>
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

/* ---------- City records as evidence: approved and planned projects already coming near this site by its year ---------- */
function Coming({ A, g, t, select }: { A: Atlas; g: Ghost; t: number; select: (id: string) => void }) {
  const list = useMemo(() => A.PROJECTS.filter(p => p.pos && !/road|utility|sewer|water/i.test(p.type) && p.end > A.TODAY && p.end <= t + 0.01 && Math.hypot(p.pos[0] - g.pos[0], p.pos[1] - g.pos[1]) <= 10)
    .map(p => ({ p, d: Math.hypot(p.pos![0] - g.pos[0], p.pos![1] - g.pos[1]) * 0.2 })).sort((a, b) => a.d - b.d), [A, g.pos, t]);
  return <div className="coming"><p className="sec">Already coming nearby by fall {Math.floor(t)} · city records</p>
    {list.length ? <>{list.slice(0, 3).map(({ p, d }) => <div className="chg" key={p.id}>
      <button className="back" onClick={() => select(p.id)}>{p.name}</button><small>{p.status} · {d.toFixed(1)} km · {p.source?.label || 'city records'}</small></div>)}
      <p className="note" style={{ margin: '4px 0 0' }}>{list.length > 3 ? '+' + (list.length - 3) + ' more. ' : ''}These are in both runs above, so the change shown is this project on top of what the city has approved.</p></>
      : <p className="note" style={{ margin: 0 }}>No approved or planned projects from city records within 2 km open by then.</p>}
  </div>;
}
