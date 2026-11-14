/* Planner mode: upload city minutes, let the AI agent list the projects in them (each with a verbatim quote),
   and have a person confirm each one by placing it on the map. Confirmed projects live in this browser until
   someone downloads projects.json and commits it. Candidates found from the command line (pnpm agent) show up here too. */
import { useEffect, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { Project, ProjectsFile, Source, XZ } from '../model/types';
import { candidateId, toProject, type Candidate } from '../model/candidates';

type Found = Candidate & { foundIn: Source };
type Props = { A: Atlas; base: ProjectsFile; confirmed: Project[]; onConfirm: (p: Project) => void; onRemove: (id: string) => void; pick: (cb: ((pos: XZ) => void) | null) => void };

function fileToPayload(f: File): Promise<{ pdf?: string; text?: string }> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onerror = () => fail(r.error);
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) { r.onload = () => ok({ pdf: String(r.result).split(',')[1] }); r.readAsDataURL(f); }
    else { r.onload = () => ok({ text: String(r.result) }); r.readAsText(f); }
  });
}

export function AgentPanel({ A, base, confirmed, onConfirm, onRemove, pick }: Props) {
  const [file, setFile] = useState<File | null>(null), [label, setLabel] = useState('');
  const [pass, setPass] = useState(() => { try { return sessionStorage.getItem('agent-pass') || ''; } catch { return ''; } });
  const [needPass, setNeedPass] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [used, setUsed] = useState(''), [found, setFound] = useState<Found[]>([]), [placing, setPlacing] = useState<string | null>(null), [dismissed, setDismissed] = useState<string[]>([]);

  /* candidates saved by `pnpm agent` (public/data/projects.candidates.json), if any */
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data/projects.candidates.json').then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.candidates) setFound(f => f.concat(j.candidates.filter((c: Found) => !f.some(x => candidateId(x) === candidateId(c))))); })
      .catch(() => {});
  }, []);

  async function run() {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const lab = label.trim() || file.name;
      const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-agent-token': pass } : {}) },
        body: JSON.stringify({ label: lab, ...(await fileToPayload(file)) }) });
      const j = await r.json().catch(() => ({ error: 'The server did not answer with JSON (is the agent endpoint running? see plan.html section 5)' }));
      if (r.status === 401) setNeedPass(true);
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      const src = (await (file.text ? file.text() : Promise.resolve(''))).match(/^Source: (https?:\/\/\S+)/);
      const foundIn = { label: lab, url: src ? src[1] : '' };
      const list: Found[] = j.projects.map((c: Candidate) => ({ ...c, foundIn }));
      setFound(f => f.filter(x => !list.some(y => candidateId(y) === candidateId(x))).concat(list));
      setUsed(j.model ? 'Read by ' + j.model + (j.tried?.length ? ' (after ' + j.tried.length + ' model' + (j.tried.length > 1 ? 's' : '') + ' failed)' : '') : '');
      if (!list.length) setErr('No development projects found in this record.');
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    setBusy(false);
  }
  function place(c: Found) {
    const id = candidateId(c);
    if (placing === id) { setPlacing(null); pick(null); return; }
    setPlacing(id);
    pick(pos => { setPlacing(null); onConfirm(toProject(c, A.toLL(pos), c.foundIn)); });
  }
  function download() {
    const ids = new Set(confirmed.map(p => p.id));
    const out = { ...base, projects: base.projects.filter(p => !ids.has(p.id)).concat(confirmed.map(p => { const { pos, foot, h, strips, _w, _ws, ...rest } = p; return rest; })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
    a.download = 'projects.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  const done = new Set(confirmed.map(p => p.id));
  const open = found.filter(c => !done.has(candidateId(c)) && !dismissed.includes(candidateId(c)));
  return <div><p className="sec">AI agent · read city records</p>
    <div style={{ display: 'grid', gap: 6 }}>
      <input type="file" accept=".pdf,.txt,application/pdf,text/plain" aria-label="Minutes or agenda file" onChange={e => setFile(e.target.files?.[0] || null)} />
      <input type="text" placeholder="Label, e.g. P&Z minutes, Oct 22 2026" value={label} onChange={e => setLabel(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px' }} />
      {needPass && <input type="password" placeholder="Agent passcode" value={pass} onChange={e => { setPass(e.target.value); try { sessionStorage.setItem('agent-pass', e.target.value); } catch {} }} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px' }} />}
      <button className="mini" disabled={!file || busy} onClick={run}>{busy ? 'Reading… (about a minute)' : 'Find projects in this record'}</button>
      {used && <small style={{ color: 'var(--muted)' }}>{used}</small>}
      {err && <p className="note warn" style={{ margin: 0 }}>{err}</p>}
    </div>
    {open.map(c => {
      const id = candidateId(c);
      return <div key={id} className="hot" style={{ gridTemplateColumns: '10px 1fr' }}><span className="stripe" style={{ background: 'var(--approved)' }}></span><div>
        <div className="row"><b>{c.name}</b><span className="conf" data-c={c.confidence}>{c.confidence}</span></div>
        <small>{c.type} · {c.status} · {c.where}{c.units ? ' · ' + c.units + ' units' : ''}{c.beds ? ' · ' + c.beds + ' beds' : ''}{c.sqft ? ' · ' + c.sqft.toLocaleString('en-US') + ' sq ft' : ''}</small>
        <blockquote style={{ margin: '6px 0', paddingLeft: 8, borderLeft: '3px solid var(--line)', fontSize: 12.5 }}>“{c.quote}”{c.page ? ' (p. ' + c.page + ')' : ''}</blockquote>
        <small>From {c.foundIn.url ? <a href={c.foundIn.url} target="_blank" rel="noopener">{c.foundIn.label}</a> : c.foundIn.label}{c.flags.length ? ' · Check: ' + c.flags.join('; ') : ''}</small>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button className="mini" onClick={() => place(c)}>{placing === id ? 'Click the map where it is… (cancel)' : 'Quote checked: place on map'}</button>
          <button className="mini" onClick={() => setDismissed(d => d.concat(id))}>Not a project</button>
        </div></div></div>;
    })}
    {confirmed.length > 0 && <div style={{ marginTop: 8 }}><p className="sec">Confirmed by you · in the model now</p>
      {confirmed.map(p => <div key={p.id} className="row" style={{ padding: '3px 0' }}><span>{p.name}</span><button className="mini" onClick={() => onRemove(p.id)}>Remove</button></div>)}
      <button className="mini" style={{ marginTop: 6 }} onClick={download}>Download projects.json</button>
      <p className="note" style={{ marginTop: 6 }}>Confirmed projects are saved in this browser only. To keep them for everyone, replace <code>public/data/projects.json</code> with the downloaded file and commit it.</p></div>}
    <p className="note" style={{ marginTop: 6 }}>The agent only lists what the record says, with the exact quote. Nothing goes into the model until a person checks the quote and places it on the map.</p>
  </div>;
}
