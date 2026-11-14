import { LAST_I, TODAY_I, qLabel } from '../ui';

type Props = { ti: number; t: number; total: number; playing: boolean; onPlay: () => void; onChange: (ti: number) => void };

export function Timeline({ ti, t, total, playing, onPlay, onChange }: Props) {
  const ticks: React.ReactNode[] = [];
  for (let y = 2024; y <= 2034; y++) ticks.push(<span key={y} className={y === 2026 ? 'now' : undefined} style={{ left: ((y - 2024) * 4 / LAST_I * 100) + '%' }}>{y === 2024 || y % 2 === 0 ? String(y) : '’' + String(y).slice(2)}</span>);
  return <div className="card timeline">
    <button className="play" aria-label={playing ? 'Pause' : 'Play through time'} onClick={onPlay}>{playing ? '❚❚' : '▶'}</button>
    <div className="tl-top"><strong>{qLabel(t) + (ti === TODAY_I ? ' · today' : '')}</strong>
      <span>{ti === TODAY_I ? 'Drag to look back or ahead' : (ti < TODAY_I ? 'Looking back · today is Q4 2026' : 'Projection · about ' + (total / 1000).toFixed(1) + 'k people in the model')}</span></div>
    <div className="track">
      <input type="range" min={0} max={LAST_I} step={1} value={ti} aria-label="Quarter shown" onChange={e => onChange(+e.target.value)} />
      <div className="ticks">{ticks}</div>
    </div>
  </div>;
}
