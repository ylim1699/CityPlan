import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createAtlas } from './model/atlas';
import type { Meta, OsmCity, Project, ProjectsFile } from './model/types';
import { AgentPanel } from './components/AgentPanel';
import { setExtraProjects } from './hooks/useTraffic';
import type { Scenario, ZonesFile } from './model/routing';
import { initialState, reducer } from './state';
import { LAST_I, TODAY_I, tOf } from './ui';
import { CityScene } from './components/CityScene';
import { LeftControls } from './components/LeftControls';
import { Timeline } from './components/Timeline';
import { AboutDialog } from './components/AboutDialog';
import { PlannerPanel, ProjectDetail, ResidentPanel, residentSub, type Computed } from './components/Panels';
import type { View } from './scene/view';
import { useTraffic } from './hooks/useTraffic';
import { AccuracyPanel, type CalibFile } from './components/AccuracyPanel';
import { ProblemCards } from './components/ProblemCards';
import { DemoViews, Placement } from './components/Placement';
import { GhostTools, YearStrip } from './planner/PlannerWorkspace';
import { GHOST_TYPES, ghostActive, ghostPlans, loadGhosts, saveGhosts, type Ghost } from './planner/ghosts';

type Lay = { ctl: boolean; pan: boolean; left: boolean };
function loadLayout(): Lay {
  const lay = { ctl: true, pan: true, left: false };
  try { const sv = JSON.parse(localStorage.getItem('atlas-layout') || 'null'); if (sv) return { ctl: !!sv.ctl, pan: !!sv.pan, left: !!sv.left }; } catch (e) {}
  if (window.innerWidth < 1180) lay.ctl = false;
  return lay;
}

function loadConfirmed(): Project[] { try { return JSON.parse(localStorage.getItem('atlas-agent-projects') || '[]'); } catch { return []; } }

export function App({ city, projects, metas, cal, zones }: { city: OsmCity; projects: ProjectsFile; metas: Meta[]; cal: CalibFile | null; zones: ZonesFile | null }) {
  const [s, dispatch] = useReducer(reducer, initialState);
  /* Projects a person confirmed from the AI agent's findings (this browser), on top of projects.json */
  const [confirmed, setConfirmed] = useState<Project[]>(loadConfirmed);
  const saveConfirmed = (list: Project[]) => { setConfirmed(list); try { localStorage.setItem('atlas-agent-projects', JSON.stringify(list)); } catch (e) {} };
  const A = useMemo(() => {
    const ids = new Set(confirmed.map(p => p.id));
    return createAtlas(city, { ...projects, projects: projects.projects.filter(p => !ids.has(p.id)).concat(confirmed) });
  }, [city, projects, confirmed]);
  const rev = confirmed.map(p => p.id).join(',');
  /* Planner ghosts: projects a planner places for a year (this browser). Only counted in Planner mode. */
  const [ghosts, setGhostsRaw] = useState<Ghost[]>(loadGhosts), [ghostSel, setGhostSel] = useState<string | null>(null);
  const setGhosts = (g: Ghost[]) => { setGhostsRaw(g); saveGhosts(g); };
  useEffect(() => { setExtraProjects(confirmed); }, [rev]);
  const sRef = useRef(s); sRef.current = s;
  const getState = useCallback(() => sRef.current, []);
  const appRef = useRef<HTMLDivElement>(null), view = useRef<View | null>(null), about = useRef<HTMLDialogElement>(null), body = useRef<HTMLDivElement>(null);
  const [lay, setLay] = useState(loadLayout);
  const setLayout = (l: Lay) => { setLay(l); try { localStorage.setItem('atlas-layout', JSON.stringify(l)); } catch (e) {} };

  /* Routed volumes from the worker (with and without projects); the count-based method fills in until they arrive. */
  const t = tOf(s.ti);
  const plans = useMemo(() => s.mode === 'planner' ? ghostPlans(ghosts, t) : [], [s.mode, ghosts, t]);
  const sc: Scenario = useMemo(() => ({ t, hour: s.hour, withProjects: true, prm: s.prm, spring: s.spring, widen: s.widen, fixes: s.fixes, rev, ...(plans.length ? { plans } : {}) }), [t, s.hour, s.prm, s.spring, s.widen, s.fixes, rev, plans]);
  const routing = s.method === 'routed' && !!zones;
  const tr = useTraffic(sc, routing);
  const run = routing ? tr.stale : null;
  const c: Computed = useMemo(() => {
    const pop = A.popSeries(s.prm), o = { pop, spring: s.spring, fixes: s.fixes, widen: s.widen };
    const withP = A.traffic(t, s.hour, { ...o, withProjects: true, volumes: run ? run.with.vol : null });
    const base = A.traffic(t, s.hour, { ...o, withProjects: false, volumes: run ? run.without.vol : null });
    return { t, tp: s.withProjects ? t : Math.min(t, A.TODAY), pop, withP, base, shown: s.withProjects ? withP : base, routed: !!tr.run && routing };
  }, [A, t, s.hour, s.prm, s.spring, s.fixes, s.widen, s.withProjects, run, routing]);
  const tti = run ? (s.withProjects ? run.with.tti : run.without.tti) : null;
  const countHours = useMemo(() => {
    if (routing && tr.hours) return null;
    const out: { mx: number; avg: number }[] = [];
    for (let h = 0; h < 24; h++) {
      let mx = 0, sum = 0, len = 0;
      A.traffic(c.t, h, { pop: c.pop, spring: s.spring, fixes: s.fixes, widen: s.widen, withProjects: s.withProjects })
        .forEach((x, k) => { mx = Math.max(mx, x.vc); sum += x.vc * A.SEGS[k].len; len += A.SEGS[k].len; });
      out.push({ mx, avg: sum / len });
    }
    return out;
  }, [A, c.t, c.pop, s.spring, s.fixes, s.widen, s.withProjects, routing, !!tr.hours]);
  const hours = (routing && s.withProjects && tr.hours) || countHours || [];

  useEffect(() => { view.current?.apply(c.shown, c.tp); }, [c, s.layers, s.sel]);
  /* ghosts on the map: planner mode only; double-click one to move it */
  useEffect(() => {
    const list = s.mode !== 'planner' ? [] : ghosts.map(g => { const ty = GHOST_TYPES[g.kind], act = ghostActive(g, c.t);
      return { id: g.id, pos: g.pos, w: ty.w, d: ty.d, h: ty.h, n: ty.n, status: g.status, active: act,
        label: (g.status === 'suggested' ? 'Suggested · ' : '') + ty.label + (act || g.status === 'suggested' ? '' : ' · from ' + g.year) }; });
    view.current?.setGhosts(list, ghostSel);
  }, [A, ghosts, ghostSel, s.mode, c.t]);
  const ghostsRef = useRef(ghosts); ghostsRef.current = ghosts;
  useEffect(() => {
    view.current?.onGhost(e => {
      setGhostSel(e.id);
      if (e.type === 'move') setGhosts(ghostsRef.current.map(g => g.id === e.id ? { ...g, pos: e.pos } : g));
    });
  }, [A]);

  const select = (id: string | null) => {
    dispatch({ type: 'select', id });
    if (id && !lay.pan) setLayout({ ...lay, pan: true });
    if (id) { const p = A.byId(id); if (p?.pos) view.current?.flyTo(p.pos); }
  };
  const panelKey = s.sel ? 'd:' + s.sel : s.mode;
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [panelKey]);

  /* Play the day (hour by hour) and play through time (quarter by quarter) */
  const [dayPlaying, setDayPlaying] = useState(false), [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!dayPlaying) return;
    const id = setInterval(() => dispatch({ type: 'hour', hour: sRef.current.hour + 1 }), 650);
    return () => clearInterval(id);
  }, [dayPlaying]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (sRef.current.ti >= LAST_I) { setPlaying(false); return; }
      dispatch({ type: 'ti', ti: sRef.current.ti + 1 });
    }, 750);
    return () => clearInterval(id);
  }, [playing]);
  const onPlay = () => { if (playing) { setPlaying(false); return; } if (s.ti >= LAST_I) dispatch({ type: 'ti', ti: TODAY_I }); setPlaying(true); };

  const g = A.gaps(c.t, s.prm, c.pop);
  const title = s.sel ? A.byId(s.sel)!.name : s.mode === 'resident' ? 'What is changing in Rexburg' : 'Planner view';
  const sub = s.sel ? A.byId(s.sel)!.where : s.mode === 'resident' ? residentSub(A, c) : qLabel2(c, s.withProjects);
  const props = { A, s, c, dispatch, select };
  const fly = (pos: [number, number]) => view.current?.flyTo(pos);
  const methodNote = <p className="note" style={{ margin: 0 }}>{routing ? (tr.status === 'ready' ? 'Street loads come from routing every trip in town through the street network.' : tr.status === 'error' ? 'Routing failed to start; showing the count-based estimate.' : 'Routing trips… showing the count-based estimate until it finishes.') : 'Showing the count-based estimate (city counts plus nearby project trips), not routed trips.'}</p>;
  const residentExtra = routing ? <><ProblemCards A={A} s={s} c={c} sc={sc} tti={tti} cal={cal} n={3} onFly={fly} />{methodNote}</> : undefined;
  const plannerExtra = <>
    <DemoViews dispatch={dispatch} />
    <AgentPanel A={A} base={projects} confirmed={confirmed} pick={cb => view.current?.pick(cb)}
      onConfirm={p => { saveConfirmed(confirmed.filter(x => x.id !== p.id).concat([p])); setTimeout(() => select(p.id), 300); }}
      onRemove={id => { if (s.sel === id) dispatch({ type: 'select', id: null }); saveConfirmed(confirmed.filter(x => x.id !== id)); }} />
    <div><p className="sec">Traffic method</p><div className="seg" role="group" aria-label="Traffic method" style={{ marginBottom: 6 }}>
      <button aria-pressed={s.method === 'routed'} onClick={() => dispatch({ type: 'view', patch: { method: 'routed' } })} disabled={!zones}>Routed trips</button>
      <button aria-pressed={s.method === 'counts'} onClick={() => dispatch({ type: 'view', patch: { method: 'counts' } })}>Count-based</button></div>{methodNote}</div>
    {routing && <ProblemCards A={A} s={s} c={c} sc={sc} tti={tti} cal={cal} n={5} onFly={fly} planner />}
    {routing && cal && <AccuracyPanel cal={cal} />}
    {routing && zones && <Placement A={A} sc={sc} zones={zones} />}
  </>;
  const ghostTools = routing ? <GhostTools A={A} s={s} c={c} sc={sc} dispatch={dispatch} ghosts={ghosts} setGhosts={setGhosts} selId={ghostSel} setSel={setGhostSel}
    pick={cb => view.current?.pick(cb)} flyTo={fly} target={() => view.current ? view.current.target() : null} />
    : <div className="zoning-banner err" role="status"><b>Ghost projects need routed trips.</b> Switch the traffic method to Routed trips (zones.json must load).</div>;
  const cls = [!lay.ctl && 'ctl-folded', !lay.pan && 'pan-folded', lay.left && 'dock-left'].filter(Boolean).join(' ');

  return <div id="app" ref={appRef} className={cls}>
    <CityScene ref={view} A={A} getState={getState} onSelect={id => select(id)} appRef={appRef} />
    <div className="topbar">
      <div className="card brand"><h1>Rexburg Growth Atlas</h1><small>What is built, what is coming, and where traffic builds up</small></div>
      <div className="card mode"><div className="seg" role="group" aria-label="View for">
        <button aria-pressed={s.mode === 'resident'} onClick={() => dispatch({ type: 'mode', mode: 'resident' })}>Resident</button>
        <button aria-pressed={s.mode === 'planner'} onClick={() => dispatch({ type: 'mode', mode: 'planner' })}>Planner</button>
      </div></div>
      <button className="tog" aria-pressed={lay.ctl} onClick={() => setLayout({ ...lay, ctl: !lay.ctl })}>Controls</button>
      <button className="tog" aria-pressed={lay.pan} onClick={() => setLayout({ ...lay, pan: !lay.pan })}>Details</button>
      <button className="chip" onClick={() => about.current?.showModal()}><b></b>Model, not measurement</button>
    </div>
    <LeftControls A={A} s={s} dispatch={dispatch} hours={hours} dayPlaying={dayPlaying} onDayPlay={() => setDayPlaying(!dayPlaying)} onStopDay={() => setDayPlaying(false)} onFold={() => setLayout({ ...lay, ctl: false })} />
    <section className="card right" aria-live="polite">
      <div className="right-head"><div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
        <button className="mini" onClick={() => setLayout({ ...lay, left: !lay.left })}>{lay.left ? 'Move right →' : '← Move left'}</button>
        <button className="mini" onClick={() => setLayout({ ...lay, pan: false })}>Hide</button></div>
        <h2>{title}</h2><p>{sub}</p></div>
      <div className="scroll" ref={body}>
        {s.sel ? <ProjectDetail {...props} /> : s.mode === 'resident' ? <ResidentPanel {...props} extra={residentExtra} /> : <PlannerPanel {...props} extra={<>{ghostTools}{plannerExtra}</>} />}
      </div>
    </section>
    <div className="hint" aria-hidden="true">Drag to turn · scroll to zoom · right-drag to move</div>
    <div className="osm-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></div>
    {s.mode === 'planner' && <YearStrip A={A} s={s} c={c} dispatch={dispatch} ghosts={ghosts} trips={tr.run ? tr.run.with.trips ?? null : null} />}
    <Timeline ti={s.ti} t={c.t} total={g.pop.total} playing={playing} onPlay={onPlay} onChange={ti => dispatch({ type: 'ti', ti })} />
    <AboutDialog ref={about} A={A} metas={metas} />
  </div>;
}
function qLabel2(c: Computed, withProjects: boolean) {
  const y = Math.floor(c.t);
  return 'Q' + (Math.floor((c.t - y) * 4) + 1) + ' ' + y + ' · ' + (withProjects ? 'growth plus planned projects' : 'growth only, no new projects');
}
