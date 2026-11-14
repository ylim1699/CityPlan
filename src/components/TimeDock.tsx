import type { Atlas } from '../model/atlas';
import { CCOL, LAST_I, TODAY_I, hourLabel, pct, qLabel } from '../ui';

type Props = {
  A: Atlas; ti: number; t: number; total: number; playing: boolean; onPlay: () => void; onChange: (ti: number) => void;
  hour: number; hours: { mx: number; avg: number }[]; dayPlaying: boolean; onDayPlay: () => void; onHour: (h: number) => void; speed: number; onSpeed: (v: number) => void;
};

const YEARS = Array.from({ length: (LAST_I + 1) / 4 }, (_, i) => 2024 + i);
const TODAY_Y = 2024 + Math.floor(TODAY_I / 4);
const SPEEDS: [number, string, string][] = [[0.25, '¼×', 'An hour every 12 seconds'], [0.5, '½×', 'An hour every 6 seconds'], [1, '1×', 'An hour every 3 seconds'], [2, '2×', 'An hour every 1.5 seconds'], [4, '4×', 'An hour every 0.75 seconds']];

/* Bottom dock: pick a year (and quarter) and an hour of day side by side, instead of one long drag. */
export function TimeDock({ A, ti, t, total, playing, onPlay, onChange, hour, hours, dayPlaying, onDayPlay, onHour, speed, onSpeed }: Props) {
  const yi = Math.floor(ti / 4), q = ti % 4, sp = SPEEDS.find(x => x[0] === speed) || SPEEDS[2];
  const go = (i: number) => onChange(Math.max(0, Math.min(LAST_I, i)));
  const status = ti === TODAY_I ? 'Today' : ti < TODAY_I ? 'Looking back' : 'Projection · ' + (total / 1000).toFixed(1) + 'k people';
  return <div className="card dock" role="region" aria-label="Time">
    <section className="dk" aria-label="Year">
      <div className="dk-head">
        <span className="dk-k">Year</span>
        <strong key={ti} className="tick">{qLabel(t)}</strong>
        <small>{status}</small>
        <div className="dk-btns">
          {ti !== TODAY_I && <button className="dk-b txt" onClick={() => go(TODAY_I)}>Today</button>}
          <button className="dk-b" aria-label="Previous quarter" onClick={() => go(ti - 1)} disabled={ti <= 0}>‹</button>
          <button className="dk-b play" aria-label={playing ? 'Pause' : 'Play through time'} onClick={onPlay}>{playing ? '❚❚' : '▶'}</button>
          <button className="dk-b" aria-label="Next quarter" onClick={() => go(ti + 1)} disabled={ti >= LAST_I}>›</button>
        </div>
      </div>
      <div className="years">{YEARS.map((y, i) =>
        <div key={y} className={'yr' + (i === yi ? ' on' : '') + (y === TODAY_Y ? ' today' : '') + (y > TODAY_Y ? ' future' : '')}>
          <button className="yr-b" aria-pressed={i === yi} aria-label={String(y)} onClick={() => go(i * 4 + (i === yi ? q : 0))}>{'’' + String(y).slice(2)}</button>
          <div className="qs">{[0, 1, 2, 3].map(k => {
            const j = i * 4 + k;
            return <button key={k} tabIndex={-1} className={(j <= ti ? 'past' : '') + (j === ti ? ' cur' : '') + (j === TODAY_I ? ' now' : '')}
              title={'Q' + (k + 1) + ' ' + y} aria-label={'Q' + (k + 1) + ' ' + y} onClick={() => go(j)} />;
          })}</div>
        </div>)}</div>
    </section>
    <section className="dk" aria-label="Hour of day">
      <div className="dk-head">
        <span className="dk-k">Hour</span>
        <strong key={hour} className="tick">{hourLabel(hour)}</strong>
        <small>{hours[hour] ? 'Busiest ' + pct(hours[hour].mx) : ''}</small>
        <div className="dk-btns">
          <button className="dk-b txt spd" title={'Play speed: ' + sp[2] + ' (click for the next speed)'} aria-label={'Play speed ' + sp[1]}
            onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(sp) + 1) % SPEEDS.length][0])}>{sp[1]}</button>
          <button className="dk-b" aria-label="Previous hour" onClick={() => onHour(hour - 1)}>‹</button>
          <button className="dk-b play" aria-label={dayPlaying ? 'Pause the day' : 'Play the day'} onClick={onDayPlay}>{dayPlaying ? '❚❚' : '▶'}</button>
          <button className="dk-b" aria-label="Next hour" onClick={() => onHour(hour + 1)}>›</button>
        </div>
      </div>
      <div className="hours" aria-label="Road load by hour">{hours.map(({ mx, avg }, h) =>
        <button key={h} tabIndex={-1} className={h === hour ? 'on' : undefined} title={hourLabel(h) + ': busiest street at ' + pct(mx)} aria-label={hourLabel(h)}
          onClick={() => onHour(h)}><i style={{ height: Math.max(10, Math.round(avg / 0.6 * 100)) + '%', background: CCOL[A.level(mx).key] }} /></button>)}</div>
      <div className="hticks"><span>12a</span><span>6a</span><span>noon</span><span>6p</span><span>11p</span></div>
    </section>
  </div>;
}
