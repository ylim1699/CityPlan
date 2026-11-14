/* Planner mode: how well the routed model matches the city's counts (calibration.json from scripts/calibrate.ts). */
export type CalibFile = {
  hour: number; calib: { alpha: number; beta: number; studentTrips: number; throughShare: number }; tried: number;
  before: { tune: number; test: number }; after: { tune: number; test: number; tuneGeh: number; testGeh: number };
  points: { seg: number; road: string; year: number; count: number; model: number; geh: number; holdout: boolean }[];
  recent?: { pass: number; n: number; points: { seg: number; road: string; year: number; dir: string; count: number; model: number; geh: number }[] };
};

export function AccuracyPanel({ cal }: { cal: CalibFile }) {
  const p = cal.points, n = p.length, rec = cal.recent?.points || [];
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  p.forEach(q => { sx += q.count; sy += q.model; sxx += q.count * q.count; syy += q.model * q.model; sxy += q.count * q.model; });
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  const mx = Math.max(...p.concat(rec as any).map(q => Math.max(q.count, q.model))) * 1.05, W = 300, H = 200, X = (v: number) => 30 + v / mx * (W - 40), Y = (v: number) => H - 24 - v / mx * (H - 34);
  const pct = (x: number) => Math.round(x * 100) + '%';
  return <div><p className="sec">Accuracy against city counts · 5 pm</p>
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div><div className="num" style={{ fontSize: 18 }}>{pct(cal.after.tune)}</div><small style={{ color: 'var(--muted)' }}>tuning counts under GEH 5</small></div>
      <div><div className="num" style={{ fontSize: 18 }}>{pct(cal.after.test)}</div><small style={{ color: 'var(--muted)' }}>held-out counts under GEH 5</small></div>
      {cal.recent && cal.recent.n > 0 && <div><div className="num" style={{ fontSize: 18 }}>{pct(cal.recent.pass)}</div><small style={{ color: 'var(--muted)' }}>2023 counts under GEH 5</small></div>}
      <div><div className="num" style={{ fontSize: 18 }}>{r.toFixed(2)}</div><small style={{ color: 'var(--muted)' }}>correlation</small></div>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', margin: '8px 0' }} role="img" aria-label="Scatter plot of city counts against model volumes at 5 pm">
      <line x1={X(0)} y1={Y(0)} x2={X(mx)} y2={Y(mx)} stroke="#9aa8a3" strokeDasharray="3 3" />
      <line x1={X(0)} y1={Y(0)} x2={X(mx)} y2={Y(0)} stroke="#c9d1cc" /><line x1={X(0)} y1={Y(0)} x2={X(0)} y2={Y(mx)} stroke="#c9d1cc" />
      {rec.map((q, i) => <rect key={'r' + i} x={X(q.count) - 3} y={Y(q.model) - 3} width={6} height={6} fill="#2e6bc9" fillOpacity={0.8}><title>{q.road} ({q.year} {q.dir} approach, as two-way): count {q.count}, model {q.model}, GEH {q.geh}</title></rect>)}
      {p.map((q, i) => <circle key={i} cx={X(q.count)} cy={Y(q.model)} r={3} fill={q.holdout ? '#d4861c' : '#0d6767'} fillOpacity={0.75}><title>{q.road} ({q.year}): count {q.count}, model {q.model}, GEH {q.geh}</title></circle>)}
      <text x={W - 6} y={H - 6} textAnchor="end" fontSize="10" fill="#5a696c">city count, cars per hour</text>
      <text x={8} y={12} fontSize="10" fill="#5a696c">model</text>
    </svg>
    <div className="legend" style={{ display: 'flex', gap: 14 }}><div><span className="sw box" style={{ background: '#0d6767' }}></span>used for tuning</div><div><span className="sw box" style={{ background: '#d4861c' }}></span>held out (never tuned on)</div>{rec.length > 0 && <div><span className="sw box" style={{ background: '#2e6bc9' }}></span>2023 intersection counts</div>}</div>
    <p className="note" style={{ marginTop: 8 }}>GEH under 5 is the standard "good match" test; agencies aim for about 85%. This model is not there yet: it ranks streets in the right order (correlation {r.toFixed(2)}) but misses many single streets. Counts are 2015–2020, grown 2.5% a year to 2026. Tuned settings: trip scale α {cal.calib.alpha}, distance β {cal.calib.beta}/min, {cal.calib.studentTrips} student trips a day, {pct(cal.calib.throughShare)} of highway traffic passing through ({cal.tried} combinations tried; before tuning {pct(cal.before.tune)} passed).</p>
  </div>;
}
