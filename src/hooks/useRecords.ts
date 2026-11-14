/* "Check for new records": ask the server for the newest records in the city's archive, read the ones this browser has not
   seen (one at a time, newest first), and put what the agent finds into the planner's review list (atlas-agent-found).
   Lives in App so a check keeps going after the start screen closes. */
import { useEffect, useMemo, useState } from 'react';
import type { CityRecord, Kind } from '../../agent/laserfiche';
import type { Candidate } from '../model/candidates';
import { isBuilding, screenOf, type Found } from '../model/review';
import type { ProjectsFile } from '../model/types';

export type { CityRecord, Kind };
export type Row = { r: CityRecord; st: 'waiting' | 'reading' | 'done' | 'failed'; n?: number; buildings?: number; err?: string };
export type Phase = 'idle' | 'listing' | 'reading' | 'done' | 'error';
type Known = { id: number; kind: Kind | null; label: string; date: string };

const MAX_READ = 6;  /* newest first; older ones wait for the next check */
function store<T>(k: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } }
function keep(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
const docId = (url?: string) => +((url || '').match(/laserfiche\.rexburg\.org\/WebLink\/DocView\.aspx\?id=(\d+)/i) || [])[1] || 0;
export function kindOf(label: string): Kind | null { return /council/i.test(label) ? 'council' : /agenda/i.test(label) ? 'pz-agenda' : /p&z|planning/i.test(label) ? 'pz' : null; }
function dateOf(label: string) { const d = new Date(label.split(',').slice(1).join(',').trim()); return isNaN(+d) ? '' : d.toISOString().slice(0, 10); }

/* sent when the start screen's "Review" opens the planner, so the review list shows its buildings */
export const REVIEW_EVENT = 'atlas-review';

/* found projects join the planner's review list; the panel listens for the event */
export function addFound(got: Found[]) {
  const key = (c: Found) => c.name.toLowerCase() + '|' + c.foundIn.label;
  const prev = store<Found[]>('atlas-agent-found', []);
  keep('atlas-agent-found', prev.filter(x => !got.some(y => key(y) === key(x))).concat(got));
  window.dispatchEvent(new Event('atlas-found'));
}

export function useRecords(projects: ProjectsFile) {
  /* the last check's report outlives a reload, so its "Review" button does too; a read cut off by the reload was never
     marked seen, so the next check reads it again */
  const [rows, setRowsRaw] = useState<Row[]>(() => store<Row[]>('atlas-records-last', []).map(r => r.st === 'done' || r.st === 'failed' ? r
    : { ...r, st: 'failed', err: 'Stopped by a page reload; check again to read it' }));
  const setRows = (r: Row[]) => { setRowsRaw(r); keep('atlas-records-last', r); };
  const [phase, setPhase] = useState<Phase>(() => rows.length ? 'done' : 'idle'), [msg, setMsg] = useState('');
  const [seen, setSeenRaw] = useState<Known[]>(() => store('atlas-records-seen', []));
  const [checked, setChecked] = useState<string | null>(() => store('atlas-records-checked', null));
  const [fileKnown, setFileKnown] = useState<Known[]>([]);
  const setSeen = (s: Known[]) => { setSeenRaw(s); keep('atlas-records-seen', s); };

  /* records the team already read: sources in projects.json and in the agent's saved candidates */
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data/projects.candidates.json').then(r => r.ok ? r.json() : null).then(j => {
      const list: Known[] = (j?.candidates || []).map((c: Found) => ({ id: docId(c.foundIn?.url), kind: kindOf(c.foundIn?.label || ''), label: c.foundIn?.label || '', date: dateOf(c.foundIn?.label || '') }));
      setFileKnown(list.filter(k => k.id));
    }).catch(() => {});
  }, []);
  const known = useMemo(() => {
    const m = new Map<number, Known>();
    projects.projects.forEach(p => [p.source, p.foundIn].forEach(s => { const id = docId(s?.url); if (id) m.set(id, { id, kind: kindOf(s!.label || ''), label: s!.label || '', date: dateOf(s!.label || '') }); }));
    fileKnown.concat(seen).forEach(k => m.set(k.id, k));
    return m;
  }, [projects, fileKnown, seen]);
  /* the newest record already read, per kind, for "up to date through" */
  const latest = useMemo(() => {
    const out: Partial<Record<Kind, Known>> = {};
    known.forEach(k => { if (k.kind && k.date && (!out[k.kind] || k.date > out[k.kind]!.date)) out[k.kind] = k; });
    return out;
  }, [known]);

  async function call(body: unknown) {
    let pass = ''; try { pass = sessionStorage.getItem('agent-pass') || ''; } catch (e) {}
    const r = await fetch('/api/records', { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-agent-token': pass } : {}) }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: 'The records service did not answer properly (HTTP ' + r.status + '). It needs the server: pnpm dev or the deployed site; on Vercel, check the function logs.' }));
    if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status });
    return j;
  }

  async function check() {
    if (phase === 'listing' || phase === 'reading') return;
    setPhase('listing'); setMsg(''); setRows([]);
    let list: CityRecord[];
    try { list = (await call({ action: 'list' })).records; }
    catch (e: any) { setPhase('error'); setMsg(e.status === 401 ? 'This server needs the agent passcode (enter it in Planner → Read city records).' : e.message); return; }
    const now = new Date().toISOString(); setChecked(now); keep('atlas-records-checked', now);
    const fresh = list.filter(r => !known.has(r.id)).slice(0, MAX_READ);
    const all: Row[] = fresh.map(r => ({ r, st: 'waiting' }));
    setRows(all);
    if (!fresh.length) { setPhase('done'); return; }
    setPhase('reading');
    let seenNow = seen;
    for (let i = 0; i < all.length; i++) {
      const r = all[i].r;
      all[i] = { ...all[i], st: 'reading' }; setRows(all.slice());
      try {
        const j = await call({ action: 'read', id: r.id, edoc: r.edoc, label: r.label, url: r.url });
        const got: Found[] = j.projects.map((c: Candidate) => ({ ...c, foundIn: j.source }));
        addFound(got);
        /* counted as the review list shows them: votes that build nothing, studies and things already built are screened out */
        const worth = got.filter(c => !screenOf(c));
        all[i] = { ...all[i], st: 'done', n: worth.length, buildings: worth.filter(c => c.category && isBuilding(c.category)).length };
        seenNow = seenNow.filter(k => k.id !== r.id).concat([{ id: r.id, kind: r.kind, label: r.label, date: r.date }]); setSeen(seenNow);
      } catch (e: any) {
        all[i] = { ...all[i], st: 'failed', err: e.message };
        if (e.status === 401) { setMsg('This server needs the agent passcode (enter it in Planner → Read city records).'); }
      }
      setRows(all.slice());
    }
    setPhase('done');
  }
  const foundCount = rows.reduce((a, r) => a + (r.n || 0), 0), buildingCount = rows.reduce((a, r) => a + (r.buildings || 0), 0);
  return { phase, rows, msg, checked, latest, check, foundCount, buildingCount };
}
export type Records = ReturnType<typeof useRecords>;
