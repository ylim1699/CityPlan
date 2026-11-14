/* Overview: a strip of headline numbers in the top bar that opens into a dashboard of congestion and growth,
   comparing growth only against growth plus planned projects, year by year and hour by hour. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { TODAY, type Atlas } from '../model/atlas';
import { countSeries, FROM, overview, TO, type Overview as OV, type OverviewIn, type Series } from '../model/overview';
import type { Scenario } from '../model/routing';
import type { SegResult, XZ } from '../model/types';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { CCOL, fmt, hourLabel, pct, qLabel } from '../ui';
import './overview.css';

/* two series, validated for color-blind separation on the dark panel: baseline blue (dashed) and scenario amber (solid) */
const BASE = '#4a8ad0', SCEN = '#c4852a';
const k = (n: number) => n >= 9950 ? (n / 1000).toFixed(1) + 'k' : fmt(n);
const mi = (n: number) => n.toFixed(n < 10 ? 1 : 0) + ' mi';
const longer = (tti: number) => '+' + Math.round((tti - 1) * 100) + '%';
const signed = (f: (n: number) => string) => (n: number) => (n >= 0 ? '+' : '−') + f(Math.abs(n));

/* Year and hour series, only while the dashboard is open: routed trips from the worker (a few seconds; the last result
   stays on screen, dimmed, until the new one arrives), or the count-based method, which is instant. */
export function useOverviewSeries(A: Atlas, sc: Scenario, inp: OverviewIn, routed: boolean, open: boolean) {
  const key = 'ov:' + JSON.stringify(sc);
  const [got, setGot] = useState<{ key: string; series: Series } | null>(null);
  useWorkerMessages(m => { if (m.type === 'overview') setGot({ key: m.key, series: m.series }); });
  useEffect(() => { if (open && routed) send({ type: 'overview', key, sc, from: FROM, to: TO }); }, [key, open, routed]);
  const counts = useMemo(() => open && !routed ? countSeries(A, inp) : null, [A, open, routed, inp.t, inp.hour, inp.pop, inp.spring, inp.fixes, inp.widen]);
  if (!routed) return { series: counts, stale: false };
  return { series: got?.series ?? null, stale: !got || got.key !== key };
}
export function useOverview(A: Atlas, inp: OverviewIn, withP: SegResult[], base: SegResult[], series: Series | null) {
  return useMemo(() => overview(A, inp, withP, base, series), [A, inp.t, inp.pop, inp.prm, withP, base, series]);
}

/* top-bar strip: the headline numbers for the selected quarter, as the map shows them; opens the dashboard */
export function OverviewStrip({ o, t, hour, withProjects, open, onOpen }: { o: OV; t: number; hour: number; withProjects: boolean; open: boolean; onOpen: () => void }) {
  const cur = withProjects ? o.plans : o.grow;
  return <button className="ov-strip" aria-pressed={open} onClick={onOpen} aria-label="Overview: open the dashboard" title="Open the overview dashboard">
    <span className="ov-sk">Overview · {qLabel(t)}</span>
    <span><i>People</i><b className="num">{k(o.gaps.pop.total)}</b></span>
    <span><i>Over capacity</i><b className="num">{mi(cur.overMi)}</b></span>
    <span><i>Delay at {hourLabel(hour)}</i><b className="num">{fmt(cur.delay)} h</b></span>
    <span><i>Trips take</i><b className="num">{longer(cur.tti)}</b></span>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3 8.5 7.5M7 13H3V9M3 13l4.5-4.5" /></svg>
  </button>;
}

type Props = { closing: boolean; A: Atlas; o: OV; stale: boolean; t: number; hour: number; onPeak: () => void; withProjects: boolean; setWithProjects: (w: boolean) => void;
  onClose: () => void; routed: boolean; ghosts: boolean; onFly: (p: XZ) => void };

export function OverviewPanel({ closing, A, o, stale, t, hour, onPeak, withProjects, setWithProjects, onClose, routed, ghosts, onFly }: Props) {
  const [table, setTable] = useState(false);
  const cur = withProjects ? o.plans : o.grow, S = o.series, now = S?.now;
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', esc); return () => removeEventListener('keydown', esc);
  }, [onClose]);

  const xs = o.pops.map(r => String(r.y)), selX = Math.max(0, Math.min(xs.length - 1, t - 0.875 - FROM));
  const diff = o.plans.delay - o.grow.delay, D = 'Difference from projects';
  const wait = <p className="ov-wait">{routed ? 'Routing every trip for each year and hour, 2024 to 2034…' : 'Working…'}</p>;
  return <section className={"card ov" + (closing ? " closing" : "")} role="dialog" aria-label="Overview">
    <header className="ov-head">
      <div><p className="ov-k">Overview · {qLabel(t)} · {hourLabel(hour)}</p><h2>Rexburg traffic and growth</h2></div>
      <div className="ov-ctl">
        <Seg label="Scenario" v={withProjects} set={setWithProjects} opts={[[false, 'Growth only'], [true, 'With planned projects']]} />
        {hour !== 17 && <button className="ov-btn" onClick={onPeak}>Show 5 pm peak</button>}
        <Seg label="View" v={table} set={setTable} opts={[[false, 'Charts'], [true, 'Table']]} />
        <button className="ov-x" aria-label="Collapse the overview" onClick={onClose}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9h4v4M3 13l4-4M13 7H9V3M13 3 9 7" /></svg></button>
      </div>
    </header>
    <div className="ov-body">
      <div className="ov-tiles">
        <div className="ov-tile hero">
          <small>Delay on all streets · {hourLabel(hour)}</small>
          <b className="num">{fmt(cur.delay)}<em> vehicle-hours</em></b>
          <Delta now={now?.delay} v={cur.delay} f={fmt} />
          <p>{withProjects ? <>Planned projects change it by <b className="num">{signed(fmt)(diff)}</b> against growth alone.</> : <>Growth alone, with no new projects after today.</>} Time lost to slow traffic, added up over every car on the road in that hour.</p>
        </div>
        <Tile l="People in town" v={k(o.gaps.pop.total)} d={<Delta now={o.gapsNow.pop.total} v={o.gaps.pop.total} f={k} neutral />} />
        <Tile l="Main roads over capacity" v={mi(cur.overMi)} d={<Delta now={now?.overMi} v={cur.overMi} f={mi} />} />
        <Tile l="Main roads heavy (85%+)" v={pct(cur.heavyShare)} d={<Delta now={now?.heavyShare} v={cur.heavyShare} f={pct} />} />
        <Tile l="Trips take longer by" v={longer(cur.tti)} d={<Delta now={now?.tti} v={cur.tti} f={longer} />} />
        <Tile l="Vehicle-miles that hour" v={k(cur.vmt)} d={<Delta now={now?.vmt} v={cur.vmt} f={k} neutral />} />
        <Tile l="Busiest main street" v={o.roads[0] ? pct(o.roads[0].vc) : '—'} d={<span className="ov-d">{o.roads[0]?.name || ''}</span>} />
        <Tile l="Student beds vs need" v={pct(o.gaps.beds.ratio)} d={<span className="ov-d">{o.capYear ? 'Beds cap enrollment from ' + o.capYear : 'Beds keep pace'}</span>} />
        <Tile l="Homes vs need" v={pct(o.gaps.homes.ratio)} d={<span className="ov-d">{o.gaps.homes.short > 0 ? 'Short ' + fmt(o.gaps.homes.short) + ' homes' : 'Covered'}</span>} />
      </div>
      {table ? <Tables o={o} hour={hour} t={t} wait={wait} /> : <>
        <div className={'ov-row' + (stale && S ? ' stale' : '')}>
          {S ? <>
            <Chart title={'Delay on all streets by year · ' + hourLabel(hour)} unit="vehicle-hours" xs={xs} sel={selX}
              a={S.years.map(r => r.grow.delay)} b={S.years.map(r => r.plans.delay)} names={['Growth only', 'With planned projects', D]} f={fmt}
              note={'With planned projects: ' + fmt(S.years[TODAY_Y].plans.delay) + ' vehicle-hours today, ' + fmt(S.years[S.years.length - 1].plans.delay) + ' in fall ' + TO + '. Shading is the difference the projects make.'} />
            <Chart title={'Main roads over capacity by year · ' + hourLabel(hour)} unit="miles" xs={xs} sel={selX}
              a={S.years.map(r => r.grow.overMi)} b={S.years.map(r => r.plans.overMi)} names={['Growth only', 'With planned projects', D]} f={v => v.toFixed(1)}
              note="Miles of main street carrying more traffic than its lanes are built for. Road projects can pull this down." />
            <Chart title={'Delay through the day · today vs ' + qLabel(t)} unit="vehicle-hours" xs={S.day.map(r => r.h % 3 ? '' : hourLabel(r.h).replace(' ', ''))} tip={i => hourLabel(i)}
              sel={hour} a={S.day.map(r => r.now)} b={S.day.map(r => r.then)} names={['Today', qLabel(t), 'Change since today']} f={fmt}
              note="How long the rush lasts, not just how bad it peaks. Both include planned projects." />
          </> : <div className="ov-card wide">{wait}</div>}
        </div>
        <div className="ov-row">
          <div className="ov-card"><h3>Busiest main streets · {qLabel(t)}, {hourLabel(hour)}</h3>
            <div className="ov-leg"><span><i className="sw" style={{ background: CCOL[3] }} />Load in {qLabel(t)}</span>{S && <span><i className="tick" />Today</span>}<span><i className="tick faint" />Capacity</span></div>
            <div className="ov-bars">{o.roads.map(r => {
              const lv = A.level(r.vc), w = (x: number) => Math.min(x, 1.6) / 1.6 * 100;
              return <button key={r.name} className="ov-bar" onClick={() => onFly(r.at)} title={r.name + ' near ' + r.near + ': ' + pct(r.vc) + ' of capacity' + (r.vcNow != null ? ' (today ' + pct(r.vcNow) + ')' : '') + '. Click to find it.'}>
                <span className="nm">{r.name}<small>near {r.near}</small></span>
                <span className="tr"><i style={{ width: w(r.vc) + '%', background: CCOL[lv.key] }} />{r.vcNow != null && <u style={{ left: w(r.vcNow) + '%' }} />}<s style={{ left: w(1) + '%' }} /></span>
                <span className="vl num">{pct(r.vc)}<small>{lv.label}</small></span></button>;
            })}</div>
            <p className="ov-note">Share of capacity used, as the map shows it. Click a street to find it.</p></div>
          <Chart title="Students wanting beds vs beds" unit="people" xs={xs} sel={selX}
            a={o.pops.map(r => r.beds)} b={o.pops.map(r => r.students)} names={['Student beds', 'Students wanting to enroll', 'Gap']} f={k}
            note={o.capYear ? 'Demand passes supply in fall ' + o.capYear + '. Past that, beds cap enrollment, and with it traffic growth.' : 'Beds keep pace with enrollment through ' + TO + '.'} />
          <div className="ov-card"><h3>Projects adding the most trips · by {qLabel(t)}</h3>
            {o.projects.length ? <div className="ov-bars">{o.projects.map(x => {
              const mx = o.projects[0].add;
              return <button key={x.p.id} className="ov-bar" onClick={() => x.p.pos && onFly(x.p.pos)} title={x.p.name + ': ' + fmt(x.add) + ' more car trips a day than today. Click to find it.'}>
                <span className="nm">{x.p.name}<small>{x.p.type}</small></span>
                <span className="tr"><i style={{ width: x.add / mx * 100 + '%', background: SCEN }} /></span>
                <span className="vl num">+{fmt(x.add)}<small>trips/day</small></span></button>;
            })}</div> : <p className="ov-note">No new project trips yet at {qLabel(t)}. Move the year forward.</p>}
            <p className="ov-note">Car trips a day added since today, from each project's published size.</p></div>
        </div>
      </>}
      <p className="ov-foot">{routed ? 'Routed trips: every trip in town is sent through the street network, for each year and hour' + (ghosts ? ', including the ghost projects placed in Planner mode' : '') : 'Count-based estimate (city counts grown with population, plus trips near each project); switch to Routed trips in Planner mode for street-by-street routing'}. Years are fall semester. Delay uses the standard BPR travel-time curve with assumed free-flow speeds; compare scenarios with it rather than reading it as an exact count. Today is {qLabel(TODAY)}.</p>
    </div>
  </section>;
}
const TODAY_Y = Math.floor(TODAY) - FROM;

function Seg<T>({ label, v, set, opts }: { label: string; v: T; set: (v: T) => void; opts: [T, string][] }) {
  return <div className="seg" role="group" aria-label={label}>{opts.map(([x, l]) => <button key={l} aria-pressed={v === x} onClick={() => set(x)}>{l}</button>)}</div>;
}
function Tile({ l, v, d }: { l: string; v: string; d: ReactNode }) {
  return <div className="ov-tile"><small>{l}</small><b className="num">{v}</b>{d}</div>;
}
/* change since today: up is worse for congestion, so it gets the warning arrow; neutral for counts like people */
function Delta({ now, v, f, neutral }: { now: number | undefined; v: number; f: (n: number) => string; neutral?: boolean }) {
  if (now == null) return <span className="ov-d">today: working…</span>;
  const up = v > now * 1.005, dn = v < now * 0.995;
  return <span className="ov-d">{up || dn ? <i className={neutral ? '' : up ? 'bad' : 'good'} aria-hidden="true">{up ? '▲' : '▼'}</i> : null}{up || dn ? 'today ' + f(now) : 'same as today'}</span>;
}

/* line chart of two series with the gap between them shaded; crosshair and tooltip on hover and arrow keys */
function Chart({ title, unit, xs, a, b, names, f, sel, note, tip }: { title: string; unit: string; xs: string[]; a: number[]; b: number[]; names: string[];
  f: (n: number) => string; sel: number; note: string; tip?: (i: number) => string }) {
  const box = useRef<HTMLDivElement>(null), [w, setW] = useState(420), [hi, setHi] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 170, L = 52, R = 14, T = 10, B = 22, n = xs.length;
  let lo = Math.min(...a, ...b), top = Math.max(...a, ...b);
  lo = Math.max(0, lo - (top - lo) * 0.15); if (top === lo) top = lo + 1;
  const X = (i: number) => L + (w - L - R) * i / (n - 1), Y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (top - lo));
  const line = (s: number[]) => s.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  const band = line(a) + b.map((_, i) => 'L' + X(n - 1 - i).toFixed(1) + ',' + Y(b[n - 1 - i]).toFixed(1)).join('') + 'Z';
  const ticks = [lo, (lo + top) / 2, top];
  const move = (e: PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); setHi(Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - L) / (w - L - R) * (n - 1))))); };
  const key = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setHi(h => Math.max(0, Math.min(n - 1, (h ?? Math.round(sel)) + (e.key === 'ArrowRight' ? 1 : -1)))); } };
  const si = Math.max(0, Math.min(n - 1, sel)), i0 = Math.min(n - 2, Math.floor(si)), sv = b[i0] + (b[i0 + 1] - b[i0]) * (si - i0);
  return <div className="ov-card"><h3>{title}</h3>
    <div className="ov-leg"><span><i className="ln dash" style={{ borderColor: BASE }} />{names[0]}</span><span><i className="ln" style={{ borderColor: SCEN }} />{names[1]}</span><span><i className="sw" style={{ background: SCEN, opacity: .35 }} />{names[2]}</span></div>
    <div className="ov-plot" ref={box}>
      <svg width={w} height={H} role="img" aria-label={title + '. ' + names[1] + ' goes from ' + f(b[0]) + ' to ' + f(b[n - 1]) + ' ' + unit + '.'} tabIndex={0}
        onPointerMove={move} onPointerLeave={() => setHi(null)} onKeyDown={key} onBlur={() => setHi(null)}>
        {ticks.map((v, i) => <g key={i}><line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} className="ov-grid" /><text x={L - 6} y={Y(v) + 3.5} textAnchor="end" className="ov-ax">{f(v)}</text></g>)}
        {xs.map((x, i) => x && <text key={i} x={X(i)} y={H - 6} textAnchor="middle" className="ov-ax">{x}</text>)}
        <path d={band} fill={SCEN} opacity={0.22} />
        <path d={line(a)} fill="none" stroke={BASE} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={line(b)} fill="none" stroke={SCEN} strokeWidth={2} strokeLinejoin="round" />
        <line x1={X(si)} x2={X(si)} y1={T} y2={H - B} className="ov-sel" />
        <circle cx={X(si)} cy={Y(sv)} r={4.5} fill={SCEN} stroke="var(--ov-surface)" strokeWidth={2} />
        {hi != null && <line x1={X(hi)} x2={X(hi)} y1={T} y2={H - B} className="ov-cross" />}
        {hi != null && <><circle cx={X(hi)} cy={Y(a[hi])} r={4} fill={BASE} stroke="var(--ov-surface)" strokeWidth={2} /><circle cx={X(hi)} cy={Y(b[hi])} r={4} fill={SCEN} stroke="var(--ov-surface)" strokeWidth={2} /></>}
      </svg>
      {hi != null && <div className="ov-tip" style={X(hi) > w * 0.55 ? { right: w - X(hi) + 10 } : { left: X(hi) + 10 }}>
        <small>{tip ? tip(hi) : xs[hi]}</small>
        <div><i style={{ borderColor: SCEN }} /><b className="num">{f(b[hi])}</b> {names[1]}</div>
        <div><i className="dash" style={{ borderColor: BASE }} /><b className="num">{f(a[hi])}</b> {names[0]}</div>
        <div><i className="sw" /><b className="num">{signed(f)(b[hi] - a[hi])}</b> {names[2]}</div></div>}
    </div>
    <p className="ov-note">{note}</p></div>;
}

function Tables({ o, hour, t, wait }: { o: OV; hour: number; t: number; wait: ReactNode }) {
  const S = o.series;
  return <div className="ov-row">
    <div className="ov-card wide"><h3>By year, fall semester · {hourLabel(hour)}</h3>{S ? <div className="tablewrap"><table><thead><tr><th>Year</th><th>People</th><th>Delay, growth only</th><th>Delay, with projects</th><th>Over capacity, growth only</th><th>Over capacity, with projects</th><th>Trips take longer, with projects</th></tr></thead>
      <tbody>{S.years.map((r, i) => <tr key={r.y}><td className="num">{r.y}</td><td className="num">{fmt(o.pops[i].pop)}</td><td className="num">{fmt(r.grow.delay)} h</td><td className="num">{fmt(r.plans.delay)} h</td><td className="num">{mi(r.grow.overMi)}</td><td className="num">{mi(r.plans.overMi)}</td><td className="num">{longer(r.plans.tti)}</td></tr>)}</tbody></table></div> : wait}</div>
    <div className="ov-card"><h3>Busiest main streets · {qLabel(t)}</h3><div className="tablewrap"><table><thead><tr><th>Street</th><th>Today</th><th>Growth only</th><th>With projects</th></tr></thead>
      <tbody>{o.roads.map(r => <tr key={r.name}><td>{r.name}<br /><small>near {r.near}</small></td><td className="num">{r.vcNow != null ? pct(r.vcNow) : '…'}</td><td className="num">{pct(r.vcGrow)}</td><td className="num">{pct(r.vc)}</td></tr>)}</tbody></table></div></div>
    <div className="ov-card"><h3>Delay by hour, with projects</h3>{S ? <div className="tablewrap"><table><thead><tr><th>Hour</th><th>Today</th><th>{qLabel(t)}</th></tr></thead>
      <tbody>{S.day.map(r => <tr key={r.h}><td>{hourLabel(r.h)}</td><td className="num">{fmt(r.now)} h</td><td className="num">{fmt(r.then)} h</td></tr>)}</tbody></table></div> : wait}</div>
    <div className="ov-card"><h3>Students and beds, fall</h3><div className="tablewrap"><table><thead><tr><th>Year</th><th>Students wanting to enroll</th><th>Beds</th></tr></thead>
      <tbody>{o.pops.map(r => <tr key={r.y}><td className="num">{r.y}</td><td className="num">{fmt(r.students)}</td><td className="num">{fmt(r.beds)}</td></tr>)}</tbody></table></div></div>
  </div>;
}
