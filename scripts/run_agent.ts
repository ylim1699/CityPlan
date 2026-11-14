/* Run the agent over city records and keep what it finds for review.
     pnpm agent <pdf-path-or-url> "<label, e.g. City Council minutes, Oct 15 2026>"
       -> adds candidates to public/data/projects.candidates.json (never shown in the app until confirmed)
     pnpm agent --list
     pnpm agent --confirm <candidate-id> <lat> <lon>
       -> a person has checked the quote; copies it into public/data/projects.json with a map location
   Needs GEMINI_API_KEY in .env (or ANTHROPIC_API_KEY with AGENT_PROVIDER=claude); see plan.html section 5. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extractProjects, type FoundProject } from '../agent/extract';
import { candidateId, toProject } from '../src/model/candidates';

const CAND = 'public/data/projects.candidates.json', PROJ = 'public/data/projects.json';
type Cand = FoundProject & { id: string; foundIn: { label: string; url: string }; foundAt: string; model: string };
const load = (): { meta: any; candidates: Cand[] } => existsSync(CAND) ? JSON.parse(readFileSync(CAND, 'utf8'))
  : { meta: { source: 'AI agent reading city records (unreviewed candidates)', url: '', fetched: new Date().toISOString().slice(0, 10), type: 'estimate' }, candidates: [] };
const args = process.argv.slice(2);

if (args[0] === '--list') {
  load().candidates.forEach(c => console.log(`${c.id}\n  ${c.status} · ${c.type} · ${c.where}\n  "${c.quote.slice(0, 160)}"\n  ${c.foundIn.label}`));
} else if (args[0] === '--confirm') {
  const [, id, lat, lon] = args;
  const c = load().candidates.find(x => x.id === id);
  if (!c || !lat || !lon) { console.error('Usage: pnpm agent --confirm <candidate-id> <lat> <lon>   (see pnpm agent --list)'); process.exit(1); }
  const P = JSON.parse(readFileSync(PROJ, 'utf8'));
  if (P.projects.some((p: any) => p.id === id)) { console.error(id + ' is already in projects.json'); process.exit(1); }
  P.projects.push(toProject(c, [+lat, +lon], c.foundIn));
  writeFileSync(PROJ, JSON.stringify(P, null, 1));
  console.log('Confirmed ' + id + ' into ' + PROJ);
} else {
  const [src, label] = args;
  if (!src || !label) { console.error('Usage: pnpm agent <pdf-path-or-url> "<label>"'); process.exit(1); }
  const isUrl = /^https?:\/\//.test(src);
  const bytes = isUrl ? new Uint8Array(await (await fetch(src)).arrayBuffer()) : new Uint8Array(readFileSync(src));
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50; // %P
  const text = isPdf ? '' : Buffer.from(bytes).toString('utf8');
  const srcUrl = isUrl ? src : (text.match(/^Source: (https?:\/\/\S+)/) || [])[1] || '';  // scripts/fetch_minutes.ts writes this first line
  const res = await extractProjects(isPdf ? { pdf: bytes, label } : { text, label }), found = res.projects;
  if (res.tried.length) console.log('Fell back past: ' + res.tried.join(' | '));
  const db = load(), now = new Date().toISOString().slice(0, 10);
  for (const f of found) {
    const id = candidateId(f);
    if (db.candidates.some(c => c.id === id)) continue;
    db.candidates.push({ ...f, id, foundIn: { label, url: srcUrl }, foundAt: now, model: res.model });
  }
  db.meta.fetched = now;
  writeFileSync(CAND, JSON.stringify(db, null, 1));
  console.log(res.model + ': ' + found.length + ' project(s) found; ' + db.candidates.length + ' candidates waiting for review. Next: pnpm agent --list');
}
