import type { Dispatch } from 'react';
import type { Action, State } from '../state';
import type { Atlas } from '../model/atlas';
import { CCOL, hourLabel, pct } from '../ui';

type Props = { A: Atlas; s: State; dispatch: Dispatch<Action>; hours: { mx: number; avg: number }[]; dayPlaying: boolean; onDayPlay: () => void; onStopDay: () => void; onFold: () => void };

export function LeftControls({ A, s, dispatch, hours, dayPlaying, onDayPlay, onStopDay, onFold }: Props) {
  const setHour = (h: number) => { onStopDay(); dispatch({ type: 'hour', hour: h }); };
  return <aside className="card left" id="left" aria-label="Map controls">
    <div><div className="row" style={{ marginBottom: 6 }}><p className="sec" style={{ margin: 0 }}>Hour of day</p><button className="mini" onClick={onFold}>Hide</button></div>
      <div className="row" style={{ marginBottom: 4 }}><strong style={{ font: '700 17px/1 var(--display)' }}>{hourLabel(s.hour)}</strong><button className="mini" onClick={onDayPlay}>{dayPlaying ? 'Pause' : 'Play day'}</button></div>
      <div className="hours" aria-label="Road load by hour">{hours.map(({ mx, avg }, h) =>
        <button key={h} className={h === s.hour ? 'on' : undefined} title={hourLabel(h) + ': busiest street at ' + pct(mx)} aria-label={hourLabel(h)}
          style={{ height: Math.max(8, Math.round(avg / 0.6 * 100)) + '%', background: CCOL[A.level(mx).key] }} onClick={() => setHour(h)} />)}</div>
      <input type="range" min={0} max={23} step={1} value={s.hour} aria-label="Hour of day" style={{ width: '100%', accentColor: 'var(--accent)', margin: '4px 0 8px' }}
        onChange={e => setHour(+e.target.value)} />
      <div className="seg" role="group" aria-label="Jump to">
        {[[8, '8 am'], [12, 'Noon'], [17, '5 pm'], [22, '10 pm']].map(([h, l]) =>
          <button key={h} aria-pressed={s.hour === h} onClick={() => setHour(h as number)}>{l}</button>)}
      </div></div>
    <div><p className="sec">Compare</p>
      <div className="seg" role="group" aria-label="Scenario">
        <button aria-pressed={s.withProjects} onClick={() => dispatch({ type: 'scenario', withProjects: true })}>With projects</button>
        <button aria-pressed={!s.withProjects} onClick={() => dispatch({ type: 'scenario', withProjects: false })}>Growth only</button>
      </div></div>
    <div><p className="sec">Show</p>
      {([['traffic', 'Road load'], ['cars', 'Moving traffic'], ['proj', 'Projects'], ['walk', 'Walk district']] as const).map(([k, l]) =>
        <label className="check" key={k}><input type="checkbox" checked={s.layers[k]} onChange={e => dispatch({ type: 'layer', key: k, on: e.target.checked })} />{l}</label>)}
    </div>
    <div><p className="sec">Share of road capacity used</p>
      <div className="legend">
        <div><span className="sw" style={{ background: 'var(--c0)' }}></span>Light, under 50%</div>
        <div><span className="sw" style={{ background: 'var(--c1)' }}></span>Steady, 50 to 70%</div>
        <div><span className="sw" style={{ background: 'var(--c2)' }}></span>Busy, 70 to 85%</div>
        <div><span className="sw" style={{ background: 'var(--c3)' }}></span>Heavy, 85 to 100%</div>
        <div><span className="sw" style={{ background: 'var(--c4)' }}></span>Over capacity</div>
      </div></div>
    <div><p className="sec">Buildings</p>
      <div className="legend">
        <div><span className="sw box" style={{ background: '#f4f5f1', border: '1px solid #c9d1cc' }}></span>Existing (OpenStreetMap)</div>
        <div><span className="sw box" style={{ background: '#cfd3cf' }}></span>Parking lot</div>
        <div><span className="sw box" style={{ background: 'var(--build)' }}></span>Under construction</div>
        <div><span className="sw box ghost"></span>Approved, not started</div>
        <div><span className="sw box" style={{ background: 'none', border: '2px solid var(--planned)' }}></span>Widening, no date</div>
        <div><span className="sw box" style={{ background: 'var(--new)' }}></span>Finished since 2024</div>
      </div></div>
  </aside>;
}
