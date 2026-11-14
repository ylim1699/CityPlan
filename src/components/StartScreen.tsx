/* The front door: what the atlas is, how current its city records are, and a live check of the city's archive for newer
   council and P&Z records. The city loads behind it, so "Enter the city" never waits on the check. */
import { useEffect } from 'react';
import type { Kind, Records, Row } from '../hooks/useRecords';
import './start.css';

const KINDS: [Kind, string][] = [['council', 'City Council minutes'], ['pz', 'P&Z minutes'], ['pz-agenda', 'P&Z agendas']];
function day(iso: string) { const d = new Date(iso.length === 10 ? iso + 'T12:00' : iso); return isNaN(+d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

function RowLine({ row }: { row: Row }) {
  const what = row.st === 'waiting' ? 'Waiting' : row.st === 'reading' ? 'Reading… about a minute' : row.st === 'failed' ? row.err || 'Could not read it'
    : row.n ? row.n + ' project' + (row.n === 1 ? '' : 's') + (row.buildings ? ' · ' + row.buildings + ' building' + (row.buildings === 1 ? '' : 's') : '') : 'No projects in it';
  return <li className={'st-' + row.st}><i /><div><a href={row.r.url} target="_blank" rel="noopener">{row.r.label}</a><small>{what}</small></div></li>;
}

export function StartScreen({ rec, onEnter, onReview }: { rec: Records; onEnter: () => void; onReview: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onEnter(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onEnter]);
  const busy = rec.phase === 'listing' || rec.phase === 'reading';
  const doneRows = rec.rows.filter(r => r.st === 'done').length;
  return <div className="start" role="dialog" aria-modal="true" aria-labelledby="start-title">
    <div className="start-card">
      <div className="start-brand">
        <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" /><path d="M8 24h16M11 24V15h4v9M18 24V9h4v15" /></svg>
        <span><small>Rexburg</small>Growth Atlas</span>
      </div>
      <h1 id="start-title">What is being built in Rexburg, and what it does to traffic.</h1>
      <p className="start-lede">Approved projects from city council and planning records, placed on a 3D model of the city with routed traffic for every hour and year.</p>

      <section className="start-rec" aria-label="City records">
        <div className="start-rec-head"><b>City records</b><small>{rec.checked ? 'Last checked ' + day(rec.checked) : 'Not checked from this browser yet'}</small></div>
        <ul className="start-kinds">{KINDS.map(([k, l]) => <li key={k}><span>{l}</span><b>{rec.latest[k] ? 'through ' + day(rec.latest[k]!.date) : 'none read yet'}</b></li>)}</ul>
        {rec.phase === 'listing' && <p className="start-status"><i className="spin" />Looking in the city's archive…</p>}
        {rec.phase !== 'idle' && rec.phase !== 'listing' && !rec.rows.length && rec.phase !== 'error' && <p className="start-status ok">Up to date: no newer records in the archive.</p>}
        {rec.rows.length > 0 && <>
          <p className="start-status">{rec.phase === 'reading' ? <><i className="spin" />Reading {Math.min(doneRows + 1, rec.rows.length)} of {rec.rows.length} new records</> : rec.rows.length + ' new record' + (rec.rows.length === 1 ? '' : 's') + ' read'}</p>
          <ul className="start-rows">{rec.rows.map(r => <RowLine key={r.r.id} row={r} />)}</ul>
        </>}
        {(rec.phase === 'error' || rec.msg) && <p className="start-status err">{rec.msg}</p>}
      </section>

      <div className="start-actions">
        {rec.phase === 'done' && rec.foundCount > 0
          ? <button className="start-btn ghost" onClick={onReview}>Review {rec.foundCount} new in Planner</button>
          : <button className="start-btn ghost" onClick={rec.check} disabled={busy}>{busy ? 'Checking…' : rec.phase === 'idle' ? 'Check for new records' : 'Check again'}</button>}
        <button className="start-btn" onClick={onEnter} autoFocus>Enter the city <span aria-hidden="true">→</span></button>
      </div>
      <p className="start-foot">Reads the public archive at laserfiche.rexburg.org. {busy ? 'You can enter the city now; reading continues. ' : ''}Nothing reaches the map until a person confirms it.</p>
    </div>
  </div>;
}

/* While a check runs (or has news) after the start screen closes: a small pill that reopens it */
export function RecordPill({ rec, onOpen }: { rec: Records; onOpen: () => void }) {
  const busy = rec.phase === 'listing' || rec.phase === 'reading';
  if (!busy && !(rec.phase === 'done' && rec.foundCount > 0)) return null;
  const done = rec.rows.filter(r => r.st === 'done' || r.st === 'failed').length;
  return <button className="card recpill" onClick={onOpen}>
    {busy ? <><i className="spin" />{rec.phase === 'listing' ? 'Checking city records…' : 'Reading city records ' + Math.min(done + 1, rec.rows.length) + ' of ' + rec.rows.length}</>
      : <><i className="dot" />{rec.foundCount} new project{rec.foundCount === 1 ? '' : 's'} to review</>}
  </button>;
}
