import { useState, type Dispatch, type ReactNode } from 'react';
import type { Action, Layers, State } from '../state';
import { DENSITY } from '../scene/blockLayer';
import { CloseButton } from './CloseButton';
import { ZONE_EMPTY, ZONE_PEOPLE } from '../scene/zoneLayer';
import type { ZonesFile } from '../model/routing';
import type { BlockGroup } from '../model/types';
import { flowsTo, storeList, walmartId, type ShopFlows } from '../model/flows';
import { fmt } from '../ui';

type Tab = 'traffic' | 'places' | 'people' | 'shopping';
type Props = { s: State; dispatch: Dispatch<Action>; onFold: () => void; hasBlocks?: boolean; hasZones?: boolean;
  zones?: ZonesFile | null; blocks?: BlockGroup[] | null; flows?: ShopFlows | null; S?: number; mix?: ReactNode };
const TABS: [Tab, string][] = [['traffic', 'Traffic'], ['places', 'Places'], ['people', 'People'], ['shopping', 'Shopping']];
function loadTab(): Tab { try { const t = localStorage.getItem('atlas-filter-tab'); if (t && TABS.some(x => x[0] === t)) return t as Tab; } catch (e) {} return 'traffic'; }

/* Filter panel: what the map shows and how, in tabs of related settings. Time (year and hour) lives in the bottom dock. */
export function LeftControls({ s, dispatch, onFold, hasBlocks = false, hasZones = false, zones = null, blocks = null, flows = null, S = 1, mix = null }: Props) {
  const [tab, setTabRaw] = useState<Tab>(loadTab);
  const setTab = (t: Tab) => { setTabRaw(t); try { localStorage.setItem('atlas-filter-tab', t); } catch (e) {} };
  const check = (k: keyof Layers, l: string, on = !!s.layers[k]) =>
    <label className="check" key={k}><input type="checkbox" checked={on} onChange={e => dispatch({ type: 'layer', key: k, on: e.target.checked })} />{l}</label>;
  return <aside className="card left" id="left" aria-label="Filter">
    <div className="left-head"><h2>Filter</h2><CloseButton label="Hide filter" onClick={onFold} /></div>
    <div className="seg ftabs" role="tablist" aria-label="Filter groups">
      {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
    </div>

    {tab === 'traffic' && <>
      <div><p className="sec">Projects counted</p>
        <label className="switch"><input type="checkbox" checked={s.withProjects} onChange={e => dispatch({ type: 'scenario', withProjects: e.target.checked })} />
          <span><b>Already planned</b><small>Approved city projects (council and P&amp;Z records)</small></span></label>
        {s.mode === 'planner' && <label className="switch"><input type="checkbox" checked={s.withNew} onChange={e => dispatch({ type: 'scenario', withNew: e.target.checked })} />
          <span><b>New projects</b><small>The ones you place: on the map, in view or by AI</small></span></label>}
        <small style={{ color: 'var(--muted)' }}>{s.withProjects && (s.withNew || s.mode !== 'planner') ? 'Showing everything.' : !s.withProjects && !(s.withNew && s.mode === 'planner') ? 'Showing growth only: no projects.' : s.withProjects ? 'Showing already planned only.' : 'Showing your new projects only.'}</small>
        {mix}</div>
      <div><p className="sec">Show on map</p>
        {check('traffic', 'Road load')}{check('cars', 'Moving traffic')}{check('signals', 'Traffic signals', s.layers.signals !== false)}</div>
      <div><p className="sec">Traffic congestion</p>
        <div className="cong" role="group" aria-label="Show streets by congestion">
          {([['green', 'Flowing', '<70%', 'var(--c0)'], ['yellow', 'Busy', '70–85%', 'var(--c2)'], ['red', 'Heavy', '85%+', 'var(--c3)']] as const).map(([k, l, r, col]) =>
            <button key={k} aria-pressed={s.cong[k]} style={{ '--cc': col } as React.CSSProperties} disabled={!s.layers.traffic}
              onClick={() => dispatch({ type: 'view', patch: { cong: { ...s.cong, [k]: !s.cong[k] } } })}><i /><b>{l}</b><small>{r}</small></button>)}
        </div>
        <small style={{ color: 'var(--muted)' }}>{!s.layers.traffic ? 'Turn on Road load to color streets' : s.cong.green && s.cong.yellow && s.cong.red ? 'Tap a color to hide those streets' : 'Hidden colors show as plain asphalt'}</small></div>
      <details className="legendbox"><summary className="sec">Legend</summary>
        <p className="sub">Share of road capacity used</p>
        <div className="legend">
          <div><span className="sw" style={{ background: 'var(--c0)' }}></span>Flowing, under 70%</div>
          <div><span className="sw" style={{ background: 'var(--c2)' }}></span>Busy, 70 to 85%</div>
          <div><span className="sw" style={{ background: 'var(--c3)' }}></span>Heavy, 85% and up</div>
          <div><span className="sw" style={{ background: 'var(--c4)' }}></span>Over capacity (deeper red)</div>
        </div>
      </details>
    </>}

    {tab === 'places' && <>
      <div><p className="sec">Show on map</p>
        {check('proj', 'Projects')}{check('shops', 'Stores and restaurants', s.layers.shops !== false)}{check('walk', 'Walk district')}</div>
      <div><p className="sec">City lights at night</p>
        <input type="range" min={0} max={1.5} step={0.05} value={s.lights} aria-label="City lights at night" style={{ width: '100%' }}
          onChange={e => dispatch({ type: 'view', patch: { lights: +e.target.value } })} />
        <small style={{ color: 'var(--muted)' }}>Windows and streetlights after dark · {Math.round(s.lights * 100)}%</small></div>
      <details className="legendbox"><summary className="sec">Legend</summary>
        <p className="sub">Buildings</p>
        <div className="legend">
          <div><span className="sw box" style={{ background: '#d8c8a8', border: '1px solid #7b7b79' }}></span>Existing (OpenStreetMap)</div>
          <div><span className="sw box" style={{ background: '#6f6a60' }}></span>Parking lot</div>
          <div><span className="sw box" style={{ background: 'var(--build)' }}></span>Under construction</div>
          <div><span className="sw box ghost"></span>Approved, not started</div>
          <div><span className="sw box" style={{ background: 'none', border: '2px solid var(--planned)' }}></span>Widening, no date</div>
          <div><span className="sw box" style={{ background: 'var(--new)' }}></span>Finished since 2024</div>
        </div>
      </details>
    </>}

    {tab === 'people' && <div><p className="sec">Show on map</p>
      {!hasBlocks && !hasZones && <small style={{ color: 'var(--muted)' }}>Census data did not load.</small>}
      {hasBlocks && check('blocks', 'Census blocks (people)')}
      {hasBlocks && s.layers.blocks && <div style={{ margin: '4px 0 8px 24px' }}>
        <small style={{ color: 'var(--muted)' }}>People per km², Census estimate 2020–2024</small>
        <div className="legend">{DENSITY.map(c => <div key={c.label}><span className="sw box" style={{ background: c.color }}></span>{c.label}</div>)}</div>
        <small style={{ color: 'var(--muted)' }}>Hover a block for its count; click it for details</small></div>}
      {hasZones && check('zones', 'Trip zones (people, trips)')}
      {hasZones && s.layers.zones && <div style={{ margin: '4px 0 0 24px' }}>
        <small style={{ color: 'var(--muted)' }}>People living in each traffic-model zone, for the year shown</small>
        <div className="legend">{ZONE_PEOPLE.map(c => <div key={c.label}><span className="sw box" style={{ background: c.color }}></span>{c.label}</div>)}
          <div><span className="sw box" style={{ background: ZONE_EMPTY }}></span>No one lives here (campus, roads into town)</div></div>
        <small style={{ color: 'var(--muted)' }}>Hover a zone for its people, jobs and car trips</small></div>}
    </div>}

    {tab === 'shopping' && <ShoppingTab s={s} dispatch={dispatch} zones={zones} blocks={blocks} flows={flows} S={S} />}
  </aside>;
}

/* Shopping: arcs on the map from where a store's shoppers live, with the top areas listed */
function ShoppingTab({ s, dispatch, zones, blocks, flows, S }: { s: State; dispatch: Dispatch<Action>; zones: ZonesFile | null; blocks: BlockGroup[] | null; flows: ShopFlows | null; S: number }) {
  if (!zones) return <small style={{ color: 'var(--muted)' }}>Trip zones did not load, so shopping trips can't be shown.</small>;
  if (!flows) return <small style={{ color: 'var(--muted)' }}>Routing trips… shopping trips appear when it finishes. (Needs the Routed trips method.)</small>;
  const stores = storeList(zones, flows), id = s.flow && stores.some(x => x.id === s.flow) ? s.flow : walmartId(zones) ?? stores[0]?.id;
  const f = id ? flowsTo(zones, flows, id, blocks, S) : null;
  return <>
    <div><p className="sec">Show on map</p>{<label className="check"><input type="checkbox" checked={!!s.layers.flows} onChange={e => dispatch({ type: 'layer', key: 'flows', on: e.target.checked })} />Trips to a store</label>}</div>
    <div><p className="sec">Store</p>
      <select aria-label="Store" value={id ?? ''} style={{ width: '100%' }} onChange={e => dispatch({ type: 'view', patch: { flow: e.target.value, layers: { ...s.layers, flows: true } } })}>
        {stores.map(x => <option key={x.id} value={x.id}>{x.name} · {fmt(x.n)} a day</option>)}
      </select></div>
    {f && <div><p className="sec">Where its shoppers come from</p>
      <p className="sub" style={{ margin: '0 0 6px' }}><b>{fmt(f.total)}</b> car trips a day arrive at {f.name}.</p>
      <ol className="flowlist">{f.rows.slice(0, 8).map(r => <li key={r.i}><span>{r.name}</span><b>{fmt(r.n)}</b><i style={{ width: Math.round(100 * r.n / f.rows[0].n) + '%' }} /></li>)}</ol>
      <small style={{ color: 'var(--muted)' }}>Model estimate, not tracked trips: shoppers go to closer, bigger stores, and 60% of shopping trips go to Walmart (assumed). Includes the store's workers.</small></div>}
  </>;
}
