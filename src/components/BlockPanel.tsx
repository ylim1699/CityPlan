/* Right-hand panel for a Census block group clicked on the map (Filter > Census blocks): its Census figures, each one
   editable into the open data file (DataFiles.tsx). People, college students and the drive-to-work share feed the
   traffic model; the rest are shown as typed. */
import type { BlockGroup, Meta } from '../model/types';
import { blockValue, type BlockField } from '../model/datafile';
import type { DataFiles } from '../hooks/useDataFiles';
import { density, densityClass, DENSITY } from '../scene/blockLayer';
import { NumField } from './DataFiles';
import { fmt } from '../ui';

const pc = (v: number) => Math.round(v * 100) + '%';
function Share({ label, v }: { label: string; v: number }) {
  return <div style={{ margin: '4px 0' }}><div className="row"><small>{label}</small><small className="num">{pc(v)}</small></div>
    <div className="meter"><i style={{ width: (v * 100).toFixed(1) + '%', background: DENSITY[3].color }}></i></div></div>;
}

export function blockSub(b: BlockGroup) { return 'Census block group ' + b.id + ' · ' + b.landKm2.toLocaleString('en-US') + ' km² of land'; }

/* b: the block as the open file has it; def: the city default */
export function BlockDetail({ b, def, meta, data, onClose }: { b: BlockGroup; def: BlockGroup; meta: Meta; data: DataFiles; onClose: () => void }) {
  const d = density(b), k = densityClass(b);
  const college = b.college != null && b.pop ? b.college / b.pop : null, perHome = b.pop != null && b.homes ? b.pop / b.homes : null;
  const field = (f: BlockField, label: string, opt: { pct?: boolean; step?: number } = {}) => blockValue(b, f) == null && blockValue(def, f) == null
    ? <span className="num">not published</span>
    : <NumField label={label} value={blockValue(b, f)} def={blockValue(def, f)} onSet={v => data.setBlock(b.id, f, v)} readOnly={!data.editing} {...opt} />;
  return <>
    <button className="back" onClick={onClose}>← Back</button>
    {data.editing
      ? <p className="note" style={{ margin: 0 }}>Edit mode · <b>{data.file ? data.file.name : 'new file'}</b>. Type a number and press Enter; ↺ puts it back. Save in Filter → People.</p>
      : <p className="note" style={{ margin: 0 }}>Showing <b>{data.file ? data.file.name : 'the default snapshot'}</b>. <button className="mini" onClick={data.startEdit}>Edit numbers</button></p>}
    <div><p className="sec">People</p>
      <div className="row"><b>Population</b>{field('pop', 'Population')}</div>
      <div className="row" style={{ marginTop: 6 }}><b>2020 Census count</b><span className="num">{b.pop2020 == null ? 'not published' : fmt(b.pop2020)}</span></div>
      {d != null && <div className="row" style={{ marginTop: 6 }}><b><span className="sw" style={{ background: DENSITY[k].color, display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }}></span>People per km²</b><span className="num">{fmt(d)}</span></div>}
    </div>
    <div><p className="sec">Who lives here</p>
      <div className="row"><b>In college</b>{field('college', 'In college')}</div>
      {college != null && <small style={{ color: 'var(--muted)' }}>{pc(Math.min(1, college))} of residents</small>}
      <div className="row"><b>Median age</b>{field('medAge', 'Median age', { step: 0.1 })}</div>
      <div className="row"><b>Homes</b>{field('homes', 'Homes')}</div>
      {perHome != null && <small style={{ color: 'var(--muted)' }}>{perHome.toFixed(1)} people per home</small>}
    </div>
    {b.commute && <div><p className="sec">Getting to work · {fmt(b.commute.workers)} workers</p>
      <div className="row"><b>Drive</b>{field('drive', 'Drive to work', { pct: true })}</div>
      <Share label="Walk" v={b.commute.walk} /><Share label="Bike" v={b.commute.bike} />
      <Share label="Bus or transit" v={b.commute.transit} /><Share label="Work from home" v={b.commute.wfh} /></div>}
    {b.cars && <div><p className="sec">Cars · {fmt(b.cars.households)} households</p>
      <div className="row"><b>Cars per household</b>{field('perHH', 'Cars per household', { step: 0.1 })}</div>
      <div className="row"><b>Households with no car</b><span className="num">{pc(b.cars.zeroCar)}</span></div></div>}
    <p className="note">Population, college students and the drive share change the routed traffic (the zones inside this block scale with them). Homes, age and cars are kept with the file but don't change traffic. Default numbers: <a href={meta.url} target="_blank" rel="noopener">Census data</a> (American Community Survey, 2020–2024).</p>
  </>;
}
