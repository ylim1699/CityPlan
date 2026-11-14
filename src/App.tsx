import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createAtlas } from './model/atlas';
import type { BlockGroupsFile, OsmCity, Project, ProjectsFile } from './model/types';
import { CloseButton } from './components/CloseButton';
import { BlockDetail, blockSub } from './components/BlockPanel';
import { AgentPanel } from './components/AgentPanel';
import { setExtraProjects } from './hooks/useTraffic';
import type { Scenario, ZonesFile } from './model/routing';
import { initialState, reducer } from './state';
import { LAST_I, TODAY_I, tOf } from './ui';
import { PlanMix } from './planner/PlanMix';
import { CityScene } from './components/CityScene';
import { LeftControls } from './components/LeftControls';
import { TimeDock } from './components/TimeDock';
import { PlannerPanel, ProjectDetail, ResidentPanel, residentSub, type Computed } from './components/Panels';
import type { View } from './scene/view';
import { useTraffic } from './hooks/useTraffic';
import { AccuracyPanel, type CalibFile } from './components/AccuracyPanel';
import { ProblemCards } from './components/ProblemCards';
import { DemoViews, Placement } from './components/Placement';
import { GhostTools } from './planner/PlannerWorkspace';
import { GHOST_TYPES, ghostActive, ghostCounts, ghostPlans, ghostRoads, ghostSupply, loadGhosts, saveGhosts, type Ghost } from './planner/ghosts';
import { snapSite, useSuggest } from './planner/suggest';
import { OverviewPanel, OverviewStrip, useOverview, useOverviewSeries } from './components/Overview';
import { RecordPill, StartScreen } from './components/StartScreen';
import { useRecords } from './hooks/useRecords';
import { MapSearch } from './components/MapSearch';
import { flowsTo, walmartId } from './model/flows';

type Lay = { ctl: boolean; pan: boolean; left: boolean };
function loadLayout(): Lay {
  const lay = { ctl: true, pan: true, left: false };
  try { const sv = JSON.parse(localStorage.getItem('atlas-layout') || 'null'); if (sv) { lay.ctl = !!sv.ctl; lay.pan = !!sv.pan; } } catch (e) {}
  if (window.innerWidth < 1180) lay.ctl = false;
  if (lay.ctl && lay.pan) lay.ctl = false;  /* Filter and Details share the left side: one at a time */
  return lay;
}

function loadConfirmed(): Project[] { try { return JSON.parse(localStorage.getItem('atlas-agent-projects') || '[]'); } catch { return []; } }

export function App({ city, projects, cal, zones, blocks = null }: { city: OsmCity; projects: ProjectsFile; cal: CalibFile | null; zones: ZonesFile | null; blocks?: BlockGroupsFile | null }) {
  const [s, dispatch] = useReducer(reducer, initialState);
  /* the start screen over the loading city, and the live check for new city records it starts */
  const rec = useRecords(projects), [start, setStart] = useState(true);
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
  const appRef = useRef<HTMLDivElement>(null), view = useRef<View | null>(null), body = useRef<HTMLDivElement>(null);
  const [lay, setLay] = useState(loadLayout);
  const setLayout = (l: Lay) => { setLay(l); try { localStorage.setItem('atlas-layout', JSON.stringify(l)); } catch (e) {} };
  /* Filter and Details open in the same place on the left: opening one closes the other */
  const showFilter = (on: boolean) => setLayout({ ...lay, ctl: on, pan: on ? false : lay.pan });
  const showDetails = (on: boolean) => setLayout({ ...lay, pan: on, ctl: on ? false : lay.ctl });

  /* Routed volumes from the worker (with and without projects); the count-based method fills in until they arrive. */
  const t = tOf(s.ti);
  /* your new projects: always computed (the Filter readout needs them), counted on the map only while "New projects" is on */
  const allPlans = useMemo(() => s.mode === 'planner' ? ghostPlans(ghosts, t, ghostSel) : [], [s.mode, ghosts, t, ghostSel]);
  const allRoads = useMemo(() => s.mode === 'planner' ? ghostRoads(ghosts, t, ghostSel) : [], [s.mode, ghosts, t, ghostSel]);
  const plans = s.withNew ? allPlans : [], roads = s.withNew ? allRoads : [];
  const sc: Scenario = useMemo(() => ({ t, hour: s.hour, withProjects: true, prm: s.prm, spring: s.spring, widen: s.widen, fixes: s.fixes, rev, ...(plans.length ? { plans } : {}), ...(roads.length ? { roads } : {}) }), [t, s.hour, s.prm, s.spring, s.widen, s.fixes, rev, plans, roads]);
  /* the Details analyses always count your new projects, whatever the map shows */
  const scAll: Scenario = useMemo(() => s.withNew ? sc : { ...sc, ...(allPlans.length ? { plans: allPlans } : {}), ...(allRoads.length ? { roads: allRoads } : {}) }, [sc, s.withNew, allPlans, allRoads]);
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
  /* AI suggestions: open land screened, then judged by the router; they arrive as Suggested ghosts */
  const { suggest, st: suggestSt } = useSuggest(A, sc, c.shown, ghosts, setGhosts, p => view.current?.flyTo(p));
  /* Overview: headline strip in the top bar (the selected quarter and hour, as the map shows them), opening into the dashboard */
  const [ovOpen, setOvOpen] = useState(false), [ovShown, setOvShown] = useState(false);
  useEffect(() => {  /* stay on screen for the closing animation */
    if (ovOpen) { setOvShown(true); return; }
    const id = setTimeout(() => setOvShown(false), 200); return () => clearTimeout(id);
  }, [ovOpen]);
  const ovIn = { t: c.t, hour: s.hour, pop: c.pop, prm: s.prm, spring: s.spring, fixes: s.fixes, widen: s.widen };
  const ovS = useOverviewSeries(A, sc, ovIn, routing, ovOpen);
  const ov = useOverview(A, ovIn, c.withP, c.base, ovS.series);
  const closeOv = useCallback(() => setOvOpen(false), []);
  const suggestYear = s.ti === TODAY_I ? 2030 : Math.max(2027, Math.floor(c.t));

  useEffect(() => { view.current?.apply(c.shown, c.tp); }, [c, s.layers, s.sel, s.cong, s.block]);
  /* Shopping filter: arcs from the 40 areas sending the most car trips to the chosen store */
  const shopFlows = run?.with.flows ?? null;
  useEffect(() => {
    const id = zones && (s.flow || walmartId(zones));
    const f = s.layers.flows && zones && shopFlows && id ? flowsTo(zones, shopFlows, id, blocks?.groups ?? null, A.S) : null;
    view.current?.setFlows(f ? f.rows.slice(0, 40).map(r => ({ a: r.pos, b: f.pos, n: r.n })) : null);
  }, [A, zones, blocks, shopFlows, s.flow, s.layers.flows]);
  /* ghosts on the map: planner mode only; double-click one to move it */
  useEffect(() => {
    const list = s.mode !== 'planner' || !s.withNew ? [] : ghosts.map(g => { const ty = GHOST_TYPES[g.kind], open = ghostActive(g, c.t), act = ghostCounts(g, c.t, ghostSel);
      return { id: g.id, pos: g.pos, w: ty.w, d: ty.d, h: ty.h, n: ty.n, status: g.status, active: act,
        label: (g.status === 'suggested' ? 'Suggested · ' : g.draft ? 'Draft · ' : '') + ty.label + (open || g.status === 'suggested' ? '' : ' · from ' + g.year),
        roads: (g.roads || []).map((r, i) => ({ pts: r.pts, status: r.status, label: r.status === 'suggested' ? 'Road option ' + (i + 1) : '' })) }; });
    view.current?.setGhosts(list, ghostSel);
  }, [A, ghosts, ghostSel, s.mode, s.withNew, c.t]);
  const ghostsRef = useRef(ghosts); ghostsRef.current = ghosts;
  useEffect(() => {
    view.current?.onGhost(e => {
      setGhostSel(e.id);
      if (e.type !== 'move') return;
      const list = ghostsRef.current, me = list.find(g => g.id === e.id); if (!me) return;
      const pl = snapSite(A, me.kind, e.pos, list.filter(g => g.id !== e.id));  /* placement rules */
      /* a moved project loses its access roads: they were drawn from the old site */
      setGhosts(list.map(g => g.id === e.id ? { ...g, pos: pl.pos, place: { moved: pl.moved, ok: pl.ok, lot: pl.lot }, roads: undefined } : g));
    });
  }, [A]);

  const select = (id: string | null) => {
    dispatch({ type: 'select', id });
    if (id && !lay.pan) showDetails(true);
    if (id) { const p = A.byId(id); if (p?.pos) view.current?.flyTo(p.pos); }
  };
  /* a Census block group clicked on the map (blocks layer) opens in the panel */
  const block = s.block && blocks ? blocks.groups.find(b => b.id === s.block) ?? null : null;
  const pickBlock = (id: string | null) => { dispatch({ type: 'block', id }); if (id && !lay.pan) showDetails(true); };
  const panelKey = s.sel ? 'd:' + s.sel : block ? 'b:' + block.id : s.mode;
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [panelKey]);

  /* Play the day (hour by hour) and play through time (quarter by quarter) */
  const [dayPlaying, setDayPlaying] = useState(false), [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!dayPlaying) return;
    /* one hour per 3 s at 1x, so the light can glide between hours (Demo speed scales it) */
    const id = setInterval(() => dispatch({ type: 'hour', hour: sRef.current.hour + 1 }), 3000 / (s.speed || 1));
    return () => clearInterval(id);
  }, [dayPlaying, s.speed]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (sRef.current.ti >= LAST_I) { setPlaying(false); return; }
      dispatch({ type: 'ti', ti: sRef.current.ti + 1 });
    }, 1500 / (s.speed || 1));
    return () => clearInterval(id);
  }, [playing, s.speed]);
  const onPlay = () => { if (playing) { setPlaying(false); return; } if (s.ti >= LAST_I) dispatch({ type: 'ti', ti: TODAY_I }); setPlaying(true); };

  const g = A.gaps(c.t, s.prm, c.pop);
  const title = s.sel ? A.byId(s.sel)!.name : block ? block.name : s.mode === 'resident' ? 'What is changing in Rexburg' : 'Planner view';
  const sub = s.sel ? A.byId(s.sel)!.where : block ? blockSub(block) : s.mode === 'resident' ? residentSub(A, c) : qLabel2(c, s.withProjects);
  const props = { A, s, c, dispatch, select };
  const fly = (pos: [number, number]) => view.current?.flyTo(pos);
  const methodNote = <p className="note" style={{ margin: 0 }}>{routing ? (tr.status === 'ready' ? 'Street loads come from routing every trip in town through the street network.' : tr.status === 'error' ? 'Routing failed to start; showing the count-based estimate.' : 'Routing trips… showing the count-based estimate until it finishes.') : 'Showing the count-based estimate (city counts plus nearby project trips), not routed trips.'}</p>;
  const residentExtra = routing ? <><ProblemCards A={A} s={s} c={c} sc={sc} tti={tti} cal={cal} n={3} onFly={fly} />{methodNote}</> : undefined;
  /* Planner: the 4-step flow first; everything else is evidence and settings, folded away until wanted */
  const plannerExtra = <>
    <More title="City records · what the city has approved" sub="The AI agent reads council and P&Z records; a person confirms each project">
      <AgentPanel A={A} base={projects} confirmed={confirmed} pick={cb => view.current?.pick(cb)} flyTo={fly} highlight={l => view.current?.setHighlight(l)}
        onSaved={() => { saveConfirmed([]); location.reload(); }}
        onConfirm={p => { saveConfirmed(confirmed.filter(x => x.id !== p.id).concat([p])); setTimeout(() => select(p.id), 300); }}
        onRemove={id => { if (s.sel === id) dispatch({ type: 'select', id: null }); saveConfirmed(confirmed.filter(x => x.id !== id)); }} /></More>
    {routing && <More title="Problems the city already has" sub="Overloaded streets and housing gaps, with fixes to test">
      <ProblemCards A={A} s={s} c={c} sc={sc} tti={tti} cal={cal} n={5} onFly={fly} planner added={ghostSupply(ghosts, c.t, ghostSel)}
        onApply={o => dispatch({ type: 'view', patch: { fixes: o.fixes, widen: o.widen } })}
        onSuggest={(k, n, why) => { suggest(k, n, suggestYear, why); setLay(l => ({ ...l, pan: true, ctl: false })); }} /></More>}
    <More title="Numbers and assumptions" sub="Population, supply against need, growth settings, pressure points">
      <PlannerPanel {...props} /></More>
    <More title="How the numbers are made" sub="Traffic method, accuracy against city counts, demo views">
      <div><p className="sec">Traffic method</p><div className="seg" role="group" aria-label="Traffic method" style={{ marginBottom: 6 }}>
        <button aria-pressed={s.method === 'routed'} onClick={() => dispatch({ type: 'view', patch: { method: 'routed' } })} disabled={!zones}>Routed trips</button>
        <button aria-pressed={s.method === 'counts'} onClick={() => dispatch({ type: 'view', patch: { method: 'counts' } })}>Count-based</button></div>{methodNote}</div>
      {routing && cal && <AccuracyPanel cal={cal} />}
      {routing && zones && <Placement A={A} sc={sc} zones={zones} />}
      <DemoViews dispatch={dispatch} /></More>
  </>;
  const ghostTools = routing ? <GhostTools A={A} s={s} c={c} sc={scAll} dispatch={dispatch} ghosts={ghosts} setGhosts={setGhosts} selId={ghostSel} setSel={setGhostSel}
    pick={cb => view.current?.pick(cb)} flyTo={fly} flyClose={pos => view.current?.flyTo(pos, 4)} target={() => view.current ? view.current.target() : null}
    suggest={suggest} suggestSt={suggestSt} highlight={l => view.current?.setHighlight(l)}
    mark={(pos, label) => view.current?.mark(pos, label)} select={select} />
    : <div className="zoning-banner err" role="status"><b>Ghost projects need routed trips.</b> Switch the traffic method to Routed trips (zones.json must load).</div>;
  const cls = [!lay.ctl && 'ctl-folded', !lay.pan && 'pan-folded'].filter(Boolean).join(' ');

  return <div id="app" ref={appRef} className={cls}>
    <CityScene ref={view} A={A} getState={getState} onSelect={id => select(id)} appRef={appRef} blocks={blocks?.groups ?? null} onBlock={pickBlock}
      zones={zones} zoneStats={run ? (s.withProjects ? run.with.zone : run.without.zone) ?? null : null} />
    <div className="topbar">
      <div className="card topcard">
        <div className="brand" title="Rexburg Growth Atlas: what is built, what is coming, and where traffic builds up">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" /><path d="M8 24h16M11 24V15h4v9M18 24V9h4v15" /></svg>
          <h1><small>Rexburg</small>Growth Atlas</h1></div>
        <i className="bar-div" />
        <div className="seg" role="group" aria-label="View for">
          <button aria-pressed={s.mode === 'resident'} onClick={() => dispatch({ type: 'mode', mode: 'resident' })}>Resident</button>
          <button aria-pressed={s.mode === 'planner'} onClick={() => dispatch({ type: 'mode', mode: 'planner' })}>Planner</button>
        </div>
        <i className="bar-div" />
        <OverviewStrip o={ov} t={c.t} hour={s.hour} withProjects={s.withProjects} open={ovOpen} onOpen={() => setOvOpen(!ovOpen)} />
      </div>
      <MapSearch A={A} zones={zones} onPick={(pos, label) => { view.current?.mark(pos, label); if (pos) view.current?.flyTo(pos); }} />
      {/* panel toggles, in their own card at the top right */}
      <div className="card topcard panels">
        <button className="tog" aria-pressed={lay.ctl} onClick={() => showFilter(!lay.ctl)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" /></svg>Filter</button>
        <button className="tog" aria-pressed={lay.pan} onClick={() => showDetails(!lay.pan)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M10 2.5v11" /></svg>Details</button>
      </div>
    </div>
    <LeftControls s={s} dispatch={dispatch} onFold={() => showFilter(false)} hasBlocks={!!blocks} hasZones={!!zones && !!blocks}
      zones={zones} blocks={blocks?.groups ?? null} flows={routing ? shopFlows : null} S={A.S}
      mix={routing && s.mode === 'planner' ? <PlanMix sc={sc} plans={allPlans} roads={allRoads} today={A.TODAY} open={lay.ctl} /> : null} />
    <section className="card right" aria-live="polite">
      <div className="right-head"><div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
        <CloseButton label="Hide details" onClick={() => showDetails(false)} /></div>
        <h2 key={title}>{title}</h2><p key={sub}>{sub}</p></div>
      <div className="scroll" ref={body}>
        {s.sel ? <ProjectDetail {...props} /> : block && blocks ? <BlockDetail b={block} meta={blocks.meta} onClose={() => pickBlock(null)} /> : s.mode === 'resident' ? <ResidentPanel {...props} extra={residentExtra} /> : <>{ghostTools}{plannerExtra}</>}
      </div>
    </section>
    {ovShown && <OverviewPanel closing={!ovOpen} A={A} o={ov} stale={ovS.stale} t={c.t} hour={s.hour} onPeak={() => { setDayPlaying(false); dispatch({ type: 'hour', hour: 17 }); }}
      routed={routing} ghosts={plans.length + roads.length > 0} withProjects={s.withProjects} setWithProjects={w => dispatch({ type: 'scenario', withProjects: w })} onClose={closeOv} onFly={fly} />}
    <div className="hint" aria-hidden="true"><span>Drag to move</span><span>Scroll or pinch to zoom</span><span>Right-drag to tilt and turn</span></div>
    <div className="osm-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></div>
    <TimeDock A={A} ti={s.ti} t={c.t} total={g.pop.total} playing={playing} onPlay={onPlay} onChange={ti => dispatch({ type: 'ti', ti })}
      hour={s.hour} hours={hours} dayPlaying={dayPlaying} onDayPlay={() => setDayPlaying(!dayPlaying)} onHour={h => { setDayPlaying(false); dispatch({ type: 'hour', hour: h }); }}
      speed={s.speed} onSpeed={v => dispatch({ type: 'view', patch: { speed: v } })} />
    {!start && <RecordPill rec={rec} onOpen={() => setStart(true)} />}
    {start && <StartScreen rec={rec} onEnter={() => setStart(false)}
      onReview={() => { setStart(false); dispatch({ type: 'mode', mode: 'planner' }); showDetails(true); }} />}
  </div>;
}
function qLabel2(c: Computed, withProjects: boolean) {
  const y = Math.floor(c.t);
  return 'Q' + (Math.floor((c.t - y) * 4) + 1) + ' ' + y + ' · ' + (withProjects ? 'growth plus planned projects' : 'growth only, no new projects');
}

/* a folded section in the planner panel */
function More({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return <details className="more"><summary><b>{title}</b><small>{sub}</small></summary><div className="more-body">{children}</div></details>;
}
