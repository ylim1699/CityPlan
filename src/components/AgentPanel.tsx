/* Planner mode: read city records (upload minutes, or paste links from the city's Laserfiche archive), let the AI agent
   list the projects in them, and review them here before anything reaches the map:
   - each quote is checked against the record's own text (by the server, not the agent),
   - the same project found in several records becomes one card, led by its most advanced record,
   - buildings are listed apart from roads, utilities, rezonings and studies,
   - an address on the street grid gets a suggested map spot the reviewer can look at before confirming.
   Confirmed projects live in this browser until saved to projects.json (pnpm dev) or downloaded and committed.
   Candidates found from the command line (pnpm agent) show up here too. */
import { CloseButton } from './CloseButton';
import { useEffect, useMemo, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { Project, ProjectsFile, XZ } from '../model/types';
import { candidateId, toProject, type Candidate } from '../model/candidates';
import { CHECK_LABEL, groupFound, sameProject, type Found, type Group } from '../model/review';
import { createGeocoder, type Spot } from '../model/geocode';
import type { Highlight } from '../planner/ghostLayer';

type Props = { A: Atlas; base: ProjectsFile; confirmed: Project[]; onConfirm: (p: Project) => void; onRemove: (id: string) => void; onSaved: () => void;
  pick: (cb: ((pos: XZ) => void) | null) => void; flyTo: (pos: XZ) => void; highlight: (l: Highlight[]) => void };
type Item = { kind: 'file'; f: File } | { kind: 'url'; u: string };

const keyOf = (c: Found) => candidateId(c) + '|' + c.foundIn.label;
const CHECK_C = { exact: 'high', close: 'medium', missing: 'low', unchecked: 'low' } as const;
function store<T>(k: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } }
function keep(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

function fileToPayload(f: File): Promise<{ pdf?: string; text?: string }> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onerror = () => fail(r.error);
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) { r.onload = () => ok({ pdf: String(r.result).split(',')[1] }); r.readAsDataURL(f); }
    else { r.onload = () => ok({ text: String(r.result) }); r.readAsText(f); }
  });
}
/* the projects file as it should be saved: confirmed projects in, and any "Not mapped" note they now answer taken out */
function projectsFile(base: ProjectsFile, confirmed: Project[]): ProjectsFile {
  const ids = new Set(confirmed.map(p => p.id));
  return { ...base, projects: base.projects.filter(p => !ids.has(p.id)).concat(confirmed.map(p => { const { pos, foot, h, strips, _w, _ws, ...rest } = p; return rest; })),
    unmapped: base.unmapped.filter(u => !confirmed.some(p => sameProject({ name: u.name, where: '' }, { name: p.name, where: '' }))) };
}
const marker = (pos: XZ, label: string): Highlight => ({ segs: [[[pos[0] - 0.35, pos[1]], [pos[0] + 0.35, pos[1]]], [[pos[0], pos[1] - 0.35], [pos[0], pos[1] + 0.35]]], label, at: pos, color: '#f2c14e' });

export function AgentPanel({ A, base, confirmed, onConfirm, onRemove, onSaved, pick, flyTo, highlight }: Props) {
  const [files, setFiles] = useState<File[]>([]), [links, setLinks] = useState(''), [label, setLabel] = useState('');
  const [pass, setPass] = useState(() => { try { return sessionStorage.getItem('agent-pass') || ''; } catch { return ''; } });
  const [needPass, setNeedPass] = useState(false), [busy, setBusy] = useState(''), [log, setLog] = useState<string[]>([]);
  const [found, setFoundRaw] = useState<Found[]>(() => store('atlas-agent-found', [])), [fileCands, setFileCands] = useState<Found[]>([]);
  const [dismissed, setDismissedRaw] = useState<string[]>(() => store('atlas-agent-dismissed', []));
  const [tab, setTab] = useState<'buildings' | 'other'>('buildings'), [placing, setPlacing] = useState<string | null>(null), [shown, setShown] = useState<string | null>(null);
  const [override, setOverride] = useState<string[]>([]), [saveMsg, setSaveMsg] = useState('');
  const setFound = (f: Found[]) => { setFoundRaw(f); keep('atlas-agent-found', f); };
  const setDismissed = (d: string[]) => { setDismissedRaw(d); keep('atlas-agent-dismissed', d); };

  /* candidates saved by `pnpm agent` (public/data/projects.candidates.json), if any */
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data/projects.candidates.json').then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.candidates) setFileCands(j.candidates); }).catch(() => {});
  }, []);
  useEffect(() => () => { pick(null); highlight([]); }, []);
  /* records read from the start screen's "Check for new records" arrive while this panel is open */
  useEffect(() => {
    const reload = () => setFoundRaw(store('atlas-agent-found', []));
    window.addEventListener('atlas-found', reload); return () => window.removeEventListener('atlas-found', reload);
  }, []);

  const geo = useMemo(() => createGeocoder(A), [A]);
  const all = useMemo(() => { const m = new Map<string, Found>(); fileCands.concat(found).forEach(c => m.set(keyOf(c), c)); return [...m.values()]; }, [fileCands, found]);
  const groups = useMemo(() => groupFound(all.filter(c => !dismissed.includes(keyOf(c))), candidateId), [all, dismissed]);
  const onMap = (g: Group) => A.PROJECTS.find(p => p.id === g.id || g.members.some(m => candidateId(m) === p.id || sameProject(p, m)));
  const open = groups.filter(g => !onMap(g)), already = groups.filter(g => onMap(g));
  const list = open.filter(g => g.building === (tab === 'buildings'));
  const spotOf = (g: Group): Spot | null => geo.locate(g.c.where) || g.members.map(m => geo.locate(m.where)).find(Boolean) || null;

  async function run() {
    const items: Item[] = [...files.map(f => ({ kind: 'file' as const, f })), ...links.split(/\s+/).filter(u => /^https:\/\//.test(u)).map(u => ({ kind: 'url' as const, u }))];
    if (!items.length) return;
    setLog([]);
    let acc = found;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], name = it.kind === 'file' ? it.f.name : it.u;
      setBusy('Reading ' + (i + 1) + ' of ' + items.length + '… (about a minute each)');
      try {
        const payload = it.kind === 'file' ? await fileToPayload(it.f) : { url: it.u };
        const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-agent-token': pass } : {}) },
          body: JSON.stringify({ label: items.length === 1 ? label.trim() : '', name: it.kind === 'file' ? it.f.name.replace(/\.[a-z]+$/i, '') : '', ...payload }) });
        const j = await r.json().catch(() => ({ error: 'The server did not answer with JSON (is the agent endpoint running? see plan.html section 5)' }));
        if (r.status === 401) { setNeedPass(true); setLog(l => l.concat(j.error)); break; }
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        const got: Found[] = j.projects.map((c: Candidate) => ({ ...c, foundIn: j.source }));
        acc = acc.filter(x => !got.some(y => keyOf(y) === keyOf(x))).concat(got);
        setFound(acc);
        const n = got.filter(c => c.check === 'missing').length;
        setLog(l => l.concat(j.source.label + ': ' + got.length + ' item' + (got.length === 1 ? '' : 's') + (n ? ', ' + n + ' with a quote not in the record' : '') + ' · ' + j.model));
      } catch (e) { setLog(l => l.concat(name + ': ' + String(e instanceof Error ? e.message : e))); }
    }
    setBusy(''); setFiles([]); setLinks('');
  }

  function show(g: Group, spot: Spot) { setShown(g.id); flyTo(spot.pos); highlight([marker(spot.pos, 'Suggested: ' + g.c.name)]); }
  function confirm(g: Group, pos: XZ) {
    const others = g.members.slice(1).map(m => m.foundIn.label).filter((l, i, a) => l !== g.c.foundIn.label && a.indexOf(l) === i);
    const c = { ...g.c, flags: g.c.flags.concat(g.conflicts, others.length ? ['Also in: ' + others.join('; ')] : []) };
    highlight([]); setShown(null);
    onConfirm(toProject(c, A.toLL(pos), g.c.foundIn));
  }
  function place(g: Group) {
    if (placing === g.id) { setPlacing(null); pick(null); return; }
    setPlacing(g.id);
    pick(pos => { setPlacing(null); confirm(g, pos); });
  }
  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(projectsFile(base, confirmed), null, 1)], { type: 'application/json' }));
    a.download = 'projects.json'; a.click(); URL.revokeObjectURL(a.href);
  }
  async function save() {
    setSaveMsg('Saving…');
    try {
      const r = await fetch('/api/save-projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(projectsFile(base, confirmed)) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
      onSaved();
    } catch (e) { setSaveMsg('Could not save: ' + String(e instanceof Error ? e.message : e)); }
  }

  const nB = open.filter(g => g.building).length, nO = open.length - nB, count = files.length + links.split(/\s+/).filter(u => /^https:\/\//.test(u)).length;
  return <div><p className="sec">AI agent · read city records</p>
    <div style={{ display: 'grid', gap: 6 }}>
      <input type="file" multiple accept=".pdf,.txt,application/pdf,text/plain" aria-label="Minutes or agenda files" onChange={e => setFiles([...(e.target.files || [])])} />
      <textarea rows={2} placeholder="Or paste links from the city's archive (laserfiche.rexburg.org), one per line" value={links} onChange={e => setLinks(e.target.value)}
        style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', font: 'inherit', fontSize: 12.5, resize: 'vertical' }} />
      {count === 1 && <input type="text" placeholder="Label (optional; read from the record if left empty)" value={label} onChange={e => setLabel(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px' }} />}
      {needPass && <input type="password" placeholder="Agent passcode" value={pass} onChange={e => { setPass(e.target.value); try { sessionStorage.setItem('agent-pass', e.target.value); } catch {} }} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px' }} />}
      <button className="mini" disabled={!count || !!busy} onClick={run}>{busy || (count > 1 ? 'Find projects in these ' + count + ' records' : 'Find projects in this record')}</button>
      {log.map((l, i) => <small key={i} style={{ color: 'var(--muted)' }}>{l}</small>)}
    </div>

    {open.length > 0 && <div style={{ marginTop: 10 }}>
      <div className="seg" role="group" aria-label="Show" style={{ marginBottom: 6 }}>
        <button aria-pressed={tab === 'buildings'} onClick={() => setTab('buildings')}>Buildings to review ({nB})</button>
        <button aria-pressed={tab === 'other'} onClick={() => setTab('other')}>Roads, zoning, other ({nO})</button></div>
      {tab === 'other' && <p className="note" style={{ margin: '0 0 6px' }}>Roads, utilities, rezonings with no building named, and studies. They are real items in the records, but they don't add a building to the map.</p>}
      {list.map(g => {
        const c = g.c, spot = spotOf(g), ok = g.check !== 'missing' || override.includes(g.id);
        return <div key={g.id} className="hot" style={{ gridTemplateColumns: '10px 1fr' }}><span className="stripe" style={{ background: 'var(--approved)' }}></span><div>
          <div className="row"><b>{c.name}</b><span className="conf" data-c={CHECK_C[g.check]} title={CHECK_LABEL[g.check]}>{g.check === 'exact' || g.check === 'close' ? 'quote checked' : g.check === 'missing' ? 'quote not found' : 'not checked'}</span>
            {!g.building && <CloseButton label="Hide this item" onClick={() => setDismissed(dismissed.concat(g.members.map(keyOf)))} />}</div>
          <small>{g.category} · {c.status} · {c.where}{c.units ? ' · ' + c.units + ' units' : ''}{c.beds ? ' · ' + c.beds + ' beds' : ''}{c.sqft ? ' · ' + c.sqft.toLocaleString('en-US') + ' sq ft' : ''}{c.acres ? ' · ' + c.acres + ' acres' : ''}</small>
          <blockquote style={{ margin: '6px 0', paddingLeft: 8, borderLeft: '3px solid var(--line)', fontSize: 12.5 }}>“{c.quote}”{c.page ? ' (p. ' + c.page + ')' : ''}</blockquote>
          <small>From {c.foundIn.url ? <a href={c.foundIn.url} target="_blank" rel="noopener">{c.foundIn.label}</a> : c.foundIn.label} · {CHECK_LABEL[c.check || 'unchecked']}</small>
          {g.members.length > 1 && <details style={{ fontSize: 12 }}><summary>Also in {g.members.length - 1} other record{g.members.length > 2 ? 's' : ''}</summary>
            {g.members.slice(1).map(m => <div key={keyOf(m)} style={{ margin: '4px 0' }}>{m.foundIn.url ? <a href={m.foundIn.url} target="_blank" rel="noopener">{m.foundIn.label}</a> : m.foundIn.label} · {m.status} · {CHECK_LABEL[m.check || 'unchecked']}
              <blockquote style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--line)' }}>“{m.quote}”</blockquote></div>)}</details>}
          {g.conflicts.concat(c.flags).length > 0 && <p className="note warn" style={{ margin: '6px 0 0', fontSize: 12 }}>Check: {g.conflicts.concat(c.flags).join('; ')}</p>}
          {g.building && <>
            <small style={{ display: 'block', marginTop: 6 }}>{spot ? 'Suggested spot: ' + spot.how + '. Look at it before confirming.' : 'No map spot from this address: click the map where it is.'}</small>
            {!ok && <p className="note warn" style={{ margin: '6px 0 0', fontSize: 12 }}>The quote is not in the record's text. Open the record and check it before using this. <button className="mini" onClick={() => setOverride(o => o.concat(g.id))}>I checked the record myself</button></p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {spot && <button className="mini" onClick={() => show(g, spot)}>Show suggested spot</button>}
              {spot && shown === g.id && <button className="mini" disabled={!ok} onClick={() => confirm(g, spot.pos)}>Confirm at this spot</button>}
              <button className="mini" disabled={!ok} onClick={() => place(g)}>{placing === g.id ? 'Click the map where it is… (cancel)' : spot ? 'Pick the spot myself' : 'Quote checked: place on map'}</button>
              <button className="mini" onClick={() => { if (shown === g.id) { highlight([]); setShown(null); } setDismissed(dismissed.concat(g.members.map(keyOf))); }}>Not a project</button>
            </div></>}
        </div></div>;
      })}
      {!list.length && <p className="note">Nothing here to review.</p>}
    </div>}
    {already.length > 0 && <p className="note" style={{ marginTop: 6 }}>Already on the map: {already.map(g => onMap(g)!.name).filter((n, i, a) => a.indexOf(n) === i).join(', ')}.</p>}
    {dismissed.length > 0 && <p style={{ margin: '4px 0 0', fontSize: 12 }}><button className="back" onClick={() => setDismissed([])}>Show {dismissed.length} hidden record entr{dismissed.length === 1 ? 'y' : 'ies'} again</button></p>}

    {confirmed.length > 0 && <div style={{ marginTop: 8 }}><p className="sec">Confirmed by you · in the model now</p>
      {confirmed.map(p => <div key={p.id} className="row" style={{ padding: '3px 0' }}><span>{p.name}</span><button className="mini" onClick={() => onRemove(p.id)}>Remove</button></div>)}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {import.meta.env.DEV && <button className="mini" onClick={save}>Save to projects.json</button>}
        <button className="mini" onClick={download}>Download projects.json</button></div>
      {saveMsg && <small>{saveMsg}</small>}
      <p className="note" style={{ marginTop: 6 }}>{import.meta.env.DEV ? 'Save writes public/data/projects.json in this copy of the app; commit it to share.' : 'Confirmed projects are saved in this browser only. To keep them for everyone, replace public/data/projects.json with the downloaded file and commit it.'}</p></div>}
    <p className="note" style={{ marginTop: 6 }}>The agent only lists what the record says, with the exact quote, and the quote is checked against the record's text. Nothing goes into the model until a person looks at it and places it on the map.</p>
  </div>;
}
