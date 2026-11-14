/* Planner mode: read city records (upload minutes, or paste links from the city's Laserfiche archive), let the AI agent
   list the projects in them, and review them here before anything reaches the map:
   - each quote is checked against the record's own text (by the server, not the agent),
   - the same project found in several records becomes one card, led by its most advanced record,
   - buildings are listed apart from roads and rezonings; votes that build nothing, studies, utilities and things already
     built are screened out (the agent's verdict, or a word screen for older candidates) but can be brought back,
   - work the record says has started is marked so the reviewer checks it before counting it as new,
   - an address on the street grid gets a suggested map spot the reviewer can look at before confirming.
   Confirmed projects live in this browser only: this is a simulation, nothing is written back to projects.json.
   Candidates found from the command line (pnpm agent) show up here too. */
import { useEffect, useMemo, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { Project, XZ } from '../model/types';
import { PLACE_TYPES, candidateId, placeDefaults, toProject, type Candidate, type PlaceKind, type Placed } from '../model/candidates';
import { CHECK_LABEL, groupFound, sameProject, type Found, type Group } from '../model/review';
import { REVIEW_EVENT } from '../hooks/useRecords';
import { createGeocoder, type Spot } from '../model/geocode';
import type { Highlight } from '../planner/ghostLayer';
import { snapSite } from '../planner/suggest';
import type { GhostKind } from '../planner/ghosts';

type Props = { A: Atlas; confirmed: Project[]; onConfirm: (p: Project) => void; onRemove: (id: string) => void;
  pick: (cb: ((pos: XZ) => void) | null) => void; flyTo: (pos: XZ) => void; highlight: (l: Highlight[]) => void };
type Item = { kind: 'file'; f: File } | { kind: 'url'; u: string };
/* a spot being placed: where it was asked for (from), where it lands clear of streets and buildings (pos), and what it is */
type Draft = { id: string; from: XZ; pos: XZ; how: string; ok: boolean; pl: Placed };
/* the planner footprint each building type is checked against when it is set beside a street */
const GK: Record<PlaceKind, GhostKind> = { student: 'student', apartments: 'student', homes: 'homes', retail: 'grocery', office: 'office', public: 'office' };
const YEARS_AHEAD = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + i);
const tripsOf = (pl: Placed) => { const t = PLACE_TYPES[pl.kind]; return Math.round(t.field === 'sqft' ? pl.size / 1000 * t.rate : pl.size * t.rate); };

const keyOf = (c: Found) => candidateId(c) + '|' + c.foundIn.label;
const CHECK_C = { exact: 'high', close: 'medium', missing: 'low', unchecked: 'low' } as const;
/* review order: quotes found in the record first, then the most advanced */
const CHECK_RANK = { exact: 0, close: 0, unchecked: 1, missing: 2 }, STATUS_RANK = { approved: 0, construction: 1, planned: 2 };
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
/* the footprint outline of the chosen building type, where it will stand */
function footprint(S: number, pos: XZ, kind: PlaceKind, label: string): Highlight {
  const t = PLACE_TYPES[kind], hw = t.w * S / 2, hd = t.d * S / 2, [x, z] = pos;
  const c: XZ[] = [[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]];
  return { segs: c.map((p, i) => [p, c[(i + 1) % 4]] as [XZ, XZ]), label, at: pos, color: '#f2c14e' };
}

/* ---------- what is still waiting for a person ---------- */
/* fired when an item is hidden or brought back, so counts outside the panel (start screen, pill) follow along */
export const REVIEW_CHANGED = 'atlas-review-changed';
const onMapOf = (A: Atlas, g: Group) => A.PROJECTS.find(p => p.id === g.id || g.members.some(m => candidateId(m) === p.id || sameProject(p, m)));
/* review cards not yet on the map, not hidden, and either worth reviewing or brought back by the reviewer */
const openOf = (A: Atlas, groups: Group[], keepIds: string[]) => groups.filter(g => !onMapOf(A, g) && (!g.screened || keepIds.includes(g.id)));
export function waiting(A: Atlas, labels: Set<string>) {
  const gone = store<string[]>('atlas-agent-dismissed', []).concat(store<string[]>('atlas-agent-deleted', []));
  const found = store<Found[]>('atlas-agent-found', []).filter(c => labels.has(c.foundIn.label) && !gone.includes(keyOf(c)));
  return openOf(A, groupFound(found, candidateId), store('atlas-agent-keep', []));
}

export function AgentPanel({ A, confirmed, onConfirm, onRemove, pick, flyTo, highlight }: Props) {
  const [files, setFiles] = useState<File[]>([]), [links, setLinks] = useState(''), [label, setLabel] = useState('');
  const [pass, setPass] = useState(() => { try { return sessionStorage.getItem('agent-pass') || ''; } catch { return ''; } });
  const [needPass, setNeedPass] = useState(false), [busy, setBusy] = useState(''), [log, setLog] = useState<string[]>([]);
  const [found, setFoundRaw] = useState<Found[]>(() => store('atlas-agent-found', [])), [fileCands, setFileCands] = useState<Found[]>([]);
  const [dismissed, setDismissedRaw] = useState<string[]>(() => store('atlas-agent-dismissed', []));
  /* deleted cards: gone for good (the found entries are dropped too), unlike "Not a project", which can be shown again */
  const [deleted, setDeletedRaw] = useState<string[]>(() => store('atlas-agent-deleted', [])), [asking, setAsking] = useState<string | null>(null);
  const [keepIds, setKeepRaw] = useState<string[]>(() => store('atlas-agent-keep', []));
  const [tab, setTab] = useState<'buildings' | 'other'>('buildings'), [placing, setPlacing] = useState<string | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [added, setAdded] = useState('');
  const [override, setOverride] = useState<string[]>([]);
  const setFound = (f: Found[]) => { setFoundRaw(f); keep('atlas-agent-found', f); };
  const setDismissed = (d: string[]) => { setDismissedRaw(d); keep('atlas-agent-dismissed', d); window.dispatchEvent(new Event(REVIEW_CHANGED)); };
  function remove(g: Group) {
    const keys = g.members.map(keyOf);
    if (draft?.id === g.id) cancel();
    setFound(found.filter(c => !keys.includes(keyOf(c))));
    const d = deleted.concat(keys); setDeletedRaw(d); keep('atlas-agent-deleted', d);
    setDismissed(dismissed.filter(k => !keys.includes(k))); setAsking(null);
  }
  const setKeep = (k: string[]) => { setKeepRaw(k); keep('atlas-agent-keep', k); window.dispatchEvent(new Event(REVIEW_CHANGED)); };

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
  /* "Review" on the start screen lands on the buildings list */
  useEffect(() => {
    const go = () => setTab('buildings');
    window.addEventListener(REVIEW_EVENT, go); return () => window.removeEventListener(REVIEW_EVENT, go);
  }, []);

  const geo = useMemo(() => createGeocoder(A), [A]);
  const all = useMemo(() => { const m = new Map<string, Found>(); fileCands.concat(found).forEach(c => m.set(keyOf(c), c)); return [...m.values()]; }, [fileCands, found]);
  const groups = useMemo(() => groupFound(all.filter(c => !dismissed.includes(keyOf(c)) && !deleted.includes(keyOf(c))), candidateId), [all, dismissed, deleted]);
  const onMap = (g: Group) => onMapOf(A, g);
  const notOnMap = groups.filter(g => !onMap(g)), already = groups.filter(g => onMap(g));
  const open = openOf(A, notOnMap, keepIds), screened = notOnMap.filter(g => !open.includes(g));
  const list = open.filter(g => g.building === (tab === 'buildings'))
    .sort((a, b) => CHECK_RANK[a.check] - CHECK_RANK[b.check] || STATUS_RANK[a.c.status] - STATUS_RANK[b.c.status]);
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

  /* a spot never sits on a street or an existing building: it moves to the nearest open land that fits the footprint */
  function settle(id: string, from: XZ, how: string, pl: Placed, name: string): Draft {
    const s = snapSite(A, GK[pl.kind], from, []);
    highlight([footprint(A.S, s.pos, pl.kind, name)]);
    return { id, from, pos: s.pos, ok: s.ok, pl, how: how + (s.moved ? ', set beside the street on open land (' + s.moved + ' m from the point)' : '') };
  }
  const plOf = (g: Group) => draft?.id === g.id ? draft.pl : placeDefaults(g.c);
  function show(g: Group, spot: Spot) {
    const d = settle(g.id, spot.pos, 'Near ' + spot.how.replace(/, placed from the street grid$/, ''), plOf(g), g.c.name);
    setDraft(d); setAdded(''); flyTo(d.pos);
  }
  function place(g: Group) {
    if (placing === g.id) { setPlacing(null); pick(null); return; }
    setPlacing(g.id); setAdded('');
    /* the map stays where it is: the building outline appears where you clicked */
    pick(pos => { pick(null); setPlacing(null); setDraft(settle(g.id, pos, 'Where you clicked', plOf(g), g.c.name)); });
  }
  function change(g: Group, patch: Partial<Placed>) {
    if (!draft) return;
    const pl = { ...draft.pl, ...patch };
    if (patch.kind && patch.kind !== draft.pl.kind) pl.size = g.c[PLACE_TYPES[patch.kind].field] ?? PLACE_TYPES[patch.kind].size;
    setDraft(settle(g.id, draft.from, draft.how.replace(/, set beside the street.*$/, ''), pl, g.c.name));
  }
  function cancel() { setDraft(null); highlight([]); }
  function confirm(g: Group, d: Draft) {
    const others = g.members.slice(1).map(m => m.foundIn.label).filter((l, i, a) => l !== g.c.foundIn.label && a.indexOf(l) === i);
    const c = { ...g.c, flags: g.c.flags.concat(g.conflicts, others.length ? ['Also in: ' + others.join('; ')] : []) };
    highlight([]); setDraft(null);
    onConfirm(toProject(c, A.toLL(d.pos), g.c.foundIn, d.pl));
    setAdded(g.c.name + ' is on the map as ' + PLACE_TYPES[d.pl.kind].label.toLowerCase() + '. Its traffic counts from fall ' + d.pl.year + ': move the time slider past then to see it.');
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
        <button aria-pressed={tab === 'other'} onClick={() => setTab('other')}>Roads and zoning ({nO})</button></div>
      {tab === 'other' && <p className="note" style={{ margin: '0 0 6px' }}>New or widened roads, and rezonings of a parcel with no building named yet. They are real changes at a place, but they don't add a building to the map.</p>}
      {list.map(g => {
        const c = g.c, spot = spotOf(g), ok = g.check !== 'missing' || override.includes(g.id);
        return <div key={g.id} className="hot" style={{ gridTemplateColumns: '10px 1fr' }}><span className="stripe" style={{ background: 'var(--approved)' }}></span><div>
          <div className="row"><b>{c.name}</b><span className="conf" data-c={CHECK_C[g.check]} title={CHECK_LABEL[g.check]}>{g.check === 'exact' || g.check === 'close' ? 'quote checked' : g.check === 'missing' ? 'quote not found' : 'not checked'}</span>
            {g.underway && <span className="conf" data-c="medium" title="The record says work has started">under construction</span>}
</div>
          <small>{g.category} · {c.status} · {c.where}{c.units ? ' · ' + c.units + ' units' : ''}{c.beds ? ' · ' + c.beds + ' beds' : ''}{c.sqft ? ' · ' + c.sqft.toLocaleString('en-US') + ' sq ft' : ''}{c.acres ? ' · ' + c.acres + ' acres' : ''}</small>
          <blockquote style={{ margin: '6px 0', paddingLeft: 8, borderLeft: '3px solid var(--line)', fontSize: 12.5 }}>“{c.quote}”{c.page ? ' (p. ' + c.page + ')' : ''}</blockquote>
          <small>From {c.foundIn.url ? <a href={c.foundIn.url} target="_blank" rel="noopener">{c.foundIn.label}</a> : c.foundIn.label} · {CHECK_LABEL[c.check || 'unchecked']}</small>
          {g.members.length > 1 && <details style={{ fontSize: 12 }}><summary>Also in {g.members.length - 1} other record{g.members.length > 2 ? 's' : ''}</summary>
            {g.members.slice(1).map(m => <div key={keyOf(m)} style={{ margin: '4px 0' }}>{m.foundIn.url ? <a href={m.foundIn.url} target="_blank" rel="noopener">{m.foundIn.label}</a> : m.foundIn.label} · {m.status} · {CHECK_LABEL[m.check || 'unchecked']}
              <blockquote style={{ margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--line)' }}>“{m.quote}”</blockquote></div>)}</details>}
          {g.underway && <p className="note warn" style={{ margin: '6px 0 0', fontSize: 12 }}>Work has started here. Check the site or the permit record: if it's open already it is not new growth; if it's still being built, confirm it so the model counts it from its finish date.</p>}
          {c.why && <small style={{ display: 'block', marginTop: 4, color: 'var(--muted)' }}>Why it's here: {c.why}</small>}
          {g.conflicts.concat(c.flags).length > 0 && <p className="note warn" style={{ margin: '6px 0 0', fontSize: 12 }}>Check: {g.conflicts.concat(c.flags).join('; ')}</p>}
          {g.building && <>
            <small style={{ display: 'block', marginTop: 6 }}>{spot ? 'Suggested spot: near ' + spot.how.replace(/, placed from the street grid$/, '') + ', beside the street. Look at it before confirming.' : 'No map spot from this address: click the map where it is.'}</small>
            {!ok && <p className="note warn" style={{ margin: '6px 0 0', fontSize: 12 }}>The quote is not in the record's text. Open the record and check it before using this. <button className="mini" onClick={() => setOverride(o => o.concat(g.id))}>I checked the record myself</button></p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {spot && <button className="mini" onClick={() => show(g, spot)}>Show suggested spot</button>}
              <button className="mini" disabled={!ok} onClick={() => place(g)}>{placing === g.id ? 'Click the map where it is… (cancel)' : spot ? 'Pick the spot myself' : 'Quote checked: place on map'}</button>
            </div>
            {draft?.id === g.id && <div className="place-form">
              <small>{draft.how}.{!draft.ok && ' No open land fits here, so it is shown where asked: check it.'}</small>
              <label>Building<select value={draft.pl.kind} onChange={e => change(g, { kind: e.target.value as PlaceKind })}>
                {(Object.keys(PLACE_TYPES) as PlaceKind[]).map(k => <option key={k} value={k}>{PLACE_TYPES[k].label}</option>)}</select></label>
              <label>Size<span><input type="number" min={1} value={draft.pl.size} onChange={e => change(g, { size: Math.max(1, +e.target.value || 1) })} />
                {PLACE_TYPES[draft.pl.kind].field === 'sqft' ? 'sq ft' : PLACE_TYPES[draft.pl.kind].field}</span></label>
              <label>Opens<select value={draft.pl.year} onChange={e => change(g, { year: +e.target.value })}>
                {[...new Set(YEARS_AHEAD.concat(draft.pl.year))].sort().map(y => <option key={y} value={y}>fall {y}</option>)}</select></label>
              <small style={{ color: 'var(--muted)' }}>About {tripsOf(draft.pl).toLocaleString('en-US')} car trips a day once open; traffic counts it from fall {draft.pl.year}.</small>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="mini" disabled={!ok} onClick={() => confirm(g, draft)}>Add to map here</button>
                <button className="mini" onClick={() => place(g)}>{placing === g.id ? 'Click the new spot… (cancel)' : 'Move it'}</button>
                <button className="mini" onClick={cancel}>Cancel</button></div>
            </div>}</>}
          {asking === g.id
            ? <div className="confirm-del" role="alertdialog" aria-label={'Delete ' + c.name + '?'}>
                <b>Delete this review card?</b>
                <small>“{c.name}” is removed from the list for good{g.members.length > 1 ? ', with the ' + g.members.length + ' records that mention it' : ''}. It won't come back with “Show hidden”; only reading the record again would find it.</small>
                <div><button className="mini danger" autoFocus onClick={() => remove(g)}>Yes, delete</button><button className="mini" onClick={() => setAsking(null)}>Cancel</button></div>
              </div>
            : <div className="card-acts">
                <button className="mini" onClick={() => { if (draft?.id === g.id) cancel(); setDismissed(dismissed.concat(g.members.map(keyOf))); }} title="Hide it; you can show hidden ones again">Not a project</button>
                <button className="mini danger" onClick={() => setAsking(g.id)}>Delete</button>
              </div>}
        </div></div>;
      })}
      {added && <p className="note" style={{ margin: '0 0 6px' }}>{added}</p>}
      {!list.length && <p className="note">Nothing here to review.</p>}
    </div>}
    {screened.length > 0 && <details style={{ marginTop: 8, fontSize: 12 }}><summary>Screened out: {screened.length} item{screened.length === 1 ? '' : 's'} that build nothing new at a place</summary>
      <p className="note" style={{ margin: '4px 0' }}>Votes with nothing built (naming, bonds, designations), studies, utilities, and things already built. Bring one back if the screen got it wrong.</p>
      {screened.map(g => <div key={g.id} className="row" style={{ padding: '3px 0', alignItems: 'flex-start', gap: 6 }}>
        <span><b>{g.c.name}</b><br /><small style={{ color: 'var(--muted)' }}>{g.screened} · {g.c.foundIn.url ? <a href={g.c.foundIn.url} target="_blank" rel="noopener">{g.c.foundIn.label}</a> : g.c.foundIn.label}</small></span>
        <button className="mini" onClick={() => setKeep(keepIds.concat(g.id))}>Review it anyway</button></div>)}</details>}
    {already.length > 0 && <p className="note" style={{ marginTop: 6 }}>Already on the map: {already.map(g => onMap(g)!.name).filter((n, i, a) => a.indexOf(n) === i).join(', ')}.</p>}
    {dismissed.length > 0 && <p style={{ margin: '4px 0 0', fontSize: 12 }}><button className="back" onClick={() => setDismissed([])}>Show {dismissed.length} hidden (“Not a project”) entr{dismissed.length === 1 ? 'y' : 'ies'} again</button></p>}

    {confirmed.length > 0 && <div style={{ marginTop: 8 }}><p className="sec">Confirmed by you · in the model now</p>
      {confirmed.map(p => <div key={p.id} className="row" style={{ padding: '3px 0' }}><span>{p.name}</span><button className="mini" onClick={() => onRemove(p.id)}>Remove</button></div>)}
      <p className="note" style={{ marginTop: 6 }}>Saved in this browser only, as a simulation: they stay after a reload, and Remove takes one back off the map.</p></div>}
    <p className="note" style={{ marginTop: 6 }}>The agent only lists what the record says, with the exact quote, and the quote is checked against the record's text. Nothing goes into the model until a person looks at it and places it on the map.</p>
  </div>;
}
