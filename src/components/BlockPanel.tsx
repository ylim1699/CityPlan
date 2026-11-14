/* Right-hand panel for a Census block group clicked on the map (Filter > Census blocks): its published Census figures,
   with the margin of error next to every survey estimate, since block groups are small samples. */
import type { BlockGroup, Meta } from '../model/types';
import { density, densityClass, DENSITY } from '../scene/blockLayer';
import { fmt } from '../ui';

const pc = (v: number) => Math.round(v * 100) + '%';
function Est({ v, moe, unit }: { v: number | null; moe: number | null; unit?: string }) {
  if (v == null) return <span className="num">not published</span>;
  return <><span className="num">{fmt(v)}{unit ? ' ' + unit : ''}</span>{moe != null && <small style={{ color: 'var(--muted)' }}> ± {fmt(moe)}</small>}</>;
}
function Share({ label, v }: { label: string; v: number }) {
  return <div style={{ margin: '4px 0' }}><div className="row"><small>{label}</small><small className="num">{pc(v)}</small></div>
    <div className="meter"><i style={{ width: (v * 100).toFixed(1) + '%', background: DENSITY[3].color }}></i></div></div>;
}

export function blockSub(b: BlockGroup) { return 'Census block group ' + b.id + ' · ' + b.landKm2.toLocaleString('en-US') + ' km² of land'; }

export function BlockDetail({ b, meta, onClose }: { b: BlockGroup; meta: Meta; onClose: () => void }) {
  const d = density(b), k = densityClass(b), lo = b.pop != null && b.popMoe != null ? Math.max(0, b.pop - b.popMoe) : null;
  const college = b.college != null && b.pop ? b.college / b.pop : null, perHome = b.pop != null && b.homes ? b.pop / b.homes : null;
  return <>
    <button className="back" onClick={onClose}>← Back</button>
    <div><p className="sec">People</p>
      <div className="row"><b>Estimate, 2020–2024</b><Est v={b.pop} moe={b.popMoe} /></div>
      {lo != null && <small style={{ color: 'var(--muted)' }}>A survey estimate: 90% likely between {fmt(lo)} and {fmt(b.pop! + b.popMoe!)}.</small>}
      <div className="row" style={{ marginTop: 6 }}><b>2020 Census count</b><span className="num">{b.pop2020 == null ? 'not published' : fmt(b.pop2020)}</span></div>
      <small style={{ color: 'var(--muted)' }}>A full count of everyone living here on April 1, 2020, not a sample.</small>
      {d != null && <div className="row" style={{ marginTop: 6 }}><b><span className="sw" style={{ background: DENSITY[k].color, display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }}></span>People per km²</b><span className="num">{fmt(d)}</span></div>}
    </div>
    <div><p className="sec">Who lives here</p>
      <div className="row"><b>In college</b><span><Est v={b.college} moe={b.collegeMoe} />{college != null && <small style={{ color: 'var(--muted)' }}> · {pc(Math.min(1, college))} of residents</small>}</span></div>
      <div className="row"><b>Median age</b><Est v={b.medAge} moe={b.medAgeMoe} unit="years" /></div>
      <div className="row"><b>Homes</b><span><Est v={b.homes} moe={b.homesMoe} />{perHome != null && <small style={{ color: 'var(--muted)' }}> · {perHome.toFixed(1)} people per home</small>}</span></div>
    </div>
    {b.commute && <div><p className="sec">Getting to work · {fmt(b.commute.workers)} workers</p>
      <Share label="Drive" v={b.commute.drive} /><Share label="Walk" v={b.commute.walk} /><Share label="Bike" v={b.commute.bike} />
      <Share label="Bus or transit" v={b.commute.transit} /><Share label="Work from home" v={b.commute.wfh} /></div>}
    {b.cars && <div><p className="sec">Cars · {fmt(b.cars.households)} households</p>
      <div className="row"><b>Cars per household</b><span className="num">{b.cars.perHH.toFixed(1)}</span></div>
      <div className="row"><b>Households with no car</b><span className="num">{pc(b.cars.zeroCar)}</span></div></div>}
    <p className="note">Estimates come from the Census Bureau's American Community Survey: five years of samples, so small areas carry a wide margin (the ± is a 90% range). The 2020 count is exact for its date. Shading uses the estimate. <a href={meta.url} target="_blank" rel="noopener">Census data</a></p>
  </>;
}
