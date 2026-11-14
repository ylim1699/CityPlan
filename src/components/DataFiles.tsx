/* The data-file bar (Filter > People): which numbers the map and the traffic model use. The default is the
   snapshot of city data taken on `snapshot`; "Edit numbers" turns the block numbers into boxes, Save keeps
   them (naming a new file when the default was open), Cancel drops them, "Reset to default" goes back to the snapshot.
   Also the number box used for editing. */
import { useEffect, useState } from 'react';
import type { DataFiles } from '../hooks/useDataFiles';
import { fmt } from '../ui';

function day(iso: string) { const d = new Date(iso.length === 10 ? iso + 'T12:00' : iso); return isNaN(+d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');

export function DataFileBar({ d, snapshot }: { d: DataFiles; snapshot: string }) {
  const [mode, setMode] = useState<'' | 'rename' | 'delete' | 'copy'>(''), [name, setName] = useState('');
  const done = () => { setMode(''); setName(''); };
  const changed = d.changes ? plural(d.changes, 'number') + ' changed from the default' : 'same as the default';

  if (d.editing) return <div className="datafile editing">
    <div className="df-head"><span className="df-dot" /><b>Edit mode</b><small>{d.file ? d.file.name : 'New file from the default'}</small></div>
    <small>Click a Census block on the map and type new numbers. {d.changes ? changed + '.' : ''}</small>
    {(!d.file || mode === 'copy') && <input className="df-input" autoFocus placeholder="Name this file, e.g. Campus grows 20%" value={name} onChange={e => setName(e.target.value)} aria-label="File name" />}
    <div className="df-acts">
      <button className="mini primary" disabled={!d.file && !name.trim()} onClick={() => { d.save(!d.file || mode === 'copy' ? name : undefined); done(); }}>{d.file && mode !== 'copy' ? 'Save' : 'Save file'}</button>
      {d.file && mode !== 'copy' && <button className="mini" onClick={() => { setName(d.file!.name + ' copy'); setMode('copy'); }}>Save as new file</button>}
      <button className="mini" onClick={() => { if (!d.dirty || window.confirm('Drop the changes you made?')) { d.cancelEdit(); done(); } }}>Cancel</button>
    </div>
  </div>;

  return <div className="datafile">
    <p className="sec">Data file</p>
    <select aria-label="Data file" value={d.file?.id ?? ''} onChange={e => d.openFile(e.target.value || null)}>
      <option value="">Default · city data snapshot{snapshot ? ', ' + day(snapshot) : ''}</option>
      {d.files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
    <small>{d.file ? 'Saved ' + day(d.file.saved) + ' · ' + changed : 'The numbers as pulled from the Census and the traffic model' + (snapshot ? ' on ' + day(snapshot) : '') + '. They never change; edits go into your own file.'}</small>
    {mode === 'rename' && d.file ? <form className="df-acts" onSubmit={e => { e.preventDefault(); d.rename(d.file!.id, name); done(); }}>
      <input className="df-input" autoFocus value={name} onChange={e => setName(e.target.value)} aria-label="File name" />
      <button className="mini" type="submit">Rename</button><button className="mini" type="button" onClick={done}>Cancel</button></form>
    : mode === 'delete' && d.file ? <div className="df-acts"><small>Delete “{d.file.name}”? This can't be undone.</small>
      <button className="mini danger" onClick={() => { d.remove(d.file!.id); done(); }}>Delete</button><button className="mini" onClick={done}>Cancel</button></div>
    : <div className="df-acts">
      <button className="mini primary" onClick={d.startEdit}>Edit numbers</button>
      <button className="mini" disabled={!d.file && !d.changes} onClick={d.reset} title="Show the default snapshot again (your saved files are kept)">Reset to default</button>
      {d.file && <button className="mini" onClick={() => { setName(d.file!.name); setMode('rename'); }}>Rename</button>}
      {d.file && <button className="mini" onClick={() => setMode('delete')}>Delete</button>}
    </div>}
  </div>;
}

/* a number that is saved when you press Enter or leave the box (so traffic is worked out once, not on every key);
   pct shows a 0–1 share as a percent. def is the default value: an edited number shows it, with a button to go back.
   Outside edit mode (readOnly) it is plain text, marked when it differs from the default. */
export function NumField({ value, def, onSet, pct = false, step, label, readOnly = false }: { value: number | null; def: number | null; onSet: (v: number | null) => void; pct?: boolean; step?: number; label: string; readOnly?: boolean }) {
  const show = (v: number | null) => v == null ? '' : pct ? String(Math.round(v * 1000) / 10) : String(Math.round(v * 10) / 10);
  const [txt, setTxt] = useState(show(value));
  useEffect(() => { setTxt(show(value)); }, [value]);
  const edited = value != null && def != null && Math.abs(value - def) > 1e-9;
  if (readOnly) return <span className={'num' + (edited ? ' edited' : '')} title={edited ? 'Changed in this file; default ' + (pct ? Math.round(def! * 100) + '%' : fmt(def!)) : undefined}>
    {value == null ? '—' : pct ? Math.round(value * 100) + '%' : fmt(value)}</span>;
  const commit = () => {
    const n = parseFloat(txt);
    if (txt.trim() === '' || isNaN(n)) { setTxt(show(value)); return; }
    const v = Math.max(0, pct ? Math.min(100, n) / 100 : n);
    onSet(def != null && Math.abs(v - def) < 1e-9 ? null : v);
  };
  return <span className={'numfield' + (edited ? ' edited' : '')}>
    <input type="number" inputMode="decimal" min={0} step={step ?? (pct ? 1 : 'any')} aria-label={label} value={txt}
      onFocus={e => e.target.select()} onChange={e => setTxt(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(show(value)); (e.target as HTMLInputElement).blur(); } }} />
    {pct && <i>%</i>}
    {edited && <button type="button" className="undo" title={'Back to the default: ' + (pct ? Math.round(def! * 100) + '%' : fmt(def!))} aria-label={'Reset ' + label + ' to default'} onClick={() => onSet(null)}>↺</button>}
  </span>;
}
