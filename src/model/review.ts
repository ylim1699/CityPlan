/* Reviewing what the AI agent found, before a person confirms it: is the quote really in the record, is it a building,
   and is it the same project another record already mentioned. Shared by the server (quote checks), the planner panel
   and scripts/run_agent.ts. No SDK imports here. */
import type { Candidate } from './candidates';
import type { Source } from './types';

export const CATEGORIES = ['housing', 'commercial', 'mixed use', 'public building', 'subdivision', 'road or trail', 'utility', 'zoning only', 'study or plan', 'other'] as const;
export type Category = typeof CATEGORIES[number];
/* what the map shows as a building; roads, utilities, rezonings and studies are listed apart */
const BUILDING: Category[] = ['housing', 'commercial', 'mixed use', 'public building', 'subdivision'];
export function isBuilding(cat: Category) { return BUILDING.includes(cat); }

/* ---------- quote check ---------- */
export type QuoteCheck = 'exact' | 'close' | 'missing' | 'unchecked';
export const CHECK_LABEL: Record<QuoteCheck, string> = {
  exact: 'Quote found word for word in the record',
  close: 'Quote found; small differences from scan errors in the record',
  missing: 'Quote NOT found in the record: check by hand',
  unchecked: 'Quote not checked: the record has no readable text'
};
const words = (s: string) => s.toLowerCase().replace(/[‘’`']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/* Every part of the quote (the agent may join parts with "...") must appear in the record. Parts that aren't word for word
   are matched by the best window of the same length; 80% of words in common allows OCR slips like "Term River" for "Teton River". */
export function checkQuote(quote: string, record: string): QuoteCheck {
  const doc = words(record);
  if (doc.length < 40) return 'unchecked';
  const docStr = ' ' + doc.join(' ') + ' ';
  const parts = quote.split(/\.{3}|…/).map(words).filter(p => p.length >= 3);
  if (!parts.length) return 'missing';
  let worst = 1;
  for (const p of parts) {
    if (docStr.includes(' ' + p.join(' ') + ' ')) continue;
    worst = Math.min(worst, bestWindow(p, doc));
  }
  return worst === 1 ? 'exact' : worst >= 0.8 ? 'close' : 'missing';
}
function bestWindow(p: string[], doc: string[]) {
  const need = new Map<string, number>(), have = new Map<string, number>();
  p.forEach(w => need.set(w, (need.get(w) || 0) + 1));
  let hit = 0, best = 0;
  const add = (w: string, d: 1 | -1) => {
    const n = need.get(w); if (!n) return;
    const h = have.get(w) || 0;
    if (d > 0 && h < n) hit++; else if (d < 0 && h <= n) hit--;
    have.set(w, h + d);
  };
  for (let i = 0; i < doc.length; i++) {
    add(doc[i], 1);
    if (i >= p.length) add(doc[i - p.length], -1);
    best = Math.max(best, hit);
  }
  return best / p.length;
}

/* ---------- category ---------- */
/* Older candidates have no category from the agent: read it from the name (strong non-building words) and then the type */
const RULES: [Category, RegExp][] = [
  ['road or trail', /\b(road|street|bridge|trail|trails|path|pathway|sidewalk|signal|widening|interchange)\b/],
  ['utility', /\b(sewer|water|wastewater|utility|utilities|power|cell tower|tower|infrastructure)\b/],
  ['zoning only', /\b(rezone|rezoning|annexation|zone change|vacate|vacation|map amendment)\b/],
  ['study or plan', /\b(study|master plan|comprehensive plan)\b/],
  ['mixed use', /\bmixed\b/],
  ['commercial', /\b(commercial|retail|store|restaurant|office|hotel|business|grocery|shop)\b/],
  ['public building', /\b(school|church|temple|library|hospital|fire station|public building)\b/],
  ['housing', /\b(housing|homes?|apartments?|townhomes?|residential|condos?|duplex|dwellings?)\b/],
  ['subdivision', /\b(subdivision|plat|pud|lots?)\b/]
];
export function categoryOf(c: Pick<Candidate, 'name' | 'type'> & { category?: Category | null }): Category {
  if (c.category && CATEGORIES.includes(c.category)) return c.category;
  const name = c.name.toLowerCase(), type = c.type.toLowerCase();
  for (const [cat, re] of RULES.slice(0, 4)) if (re.test(name)) return cat;
  for (const [cat, re] of RULES) if (re.test(type)) return cat;
  for (const [cat, re] of RULES.slice(4)) if (re.test(name)) return cat;
  return 'other';
}

/* ---------- same project in several records ---------- */
const STOP = new Set(['the', 'a', 'of', 'and', 'at', 'for', 'to', 'in', 'on', 'project', 'subdivision', 'plat', 'final', 'preliminary', 'pud', 'planned',
  'unit', 'development', 'division', 'div', 'phase', 'approximately', 'design', 'contract', 'agreement', 'cup', 'conditional', 'use', 'permit']);
export function nameTokens(name: string) {
  return new Set(words(name).filter(w => !STOP.has(w)).map(w => w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}
const DIR: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w' };
const SUFFIX: Record<string, string> = { road: 'rd', highway: 'hwy', boulevard: 'blvd', drive: 'dr', avenue: 'ave', street: 'st', lane: 'ln' };
/* "approximately 620 South, 2530 West" and "620 S 2530 W" are the same address; only addresses with a house number count */
export function addressKey(where: string) {
  const w = words(where.replace(/\b(approximately|approx|located at|located)\b/gi, '')).map(x => DIR[x] || SUFFIX[x] || x);
  const i = w.findIndex(x => /^\d+$/.test(x));
  return i < 0 ? '' : w.slice(i).join(' ');
}
export function sameProject(a: { name: string; where: string }, b: { name: string; where: string }) {
  const ta = nameTokens(a.name), tb = nameTokens(b.name);
  const inter = [...ta].filter(t => tb.has(t)).length, small = Math.min(ta.size, tb.size);
  if (small >= 2 && inter === small) return true;               // one name inside the other: "Summerfield 14" / "Summerfield Div 14 Subdivision"
  if (ta.size === 1 && tb.size === 1 && inter === 1) return true;
  if (inter / (ta.size + tb.size - inter) >= 0.6) return true;
  const ka = addressKey(a.where);
  return !!ka && ka === addressKey(b.where) && inter >= 1;        // same site, e.g. a plan amendment and the rezone that goes with it
}

export type Found = Candidate & { foundIn: Source };
export type Group = { id: string; c: Found; members: Found[]; category: Category; building: boolean; check: QuoteCheck; conflicts: string[] };
const STATUS_RANK = { construction: 3, approved: 2, planned: 1 }, CONF_RANK = { high: 3, medium: 2, low: 1 }, CHECK_RANK = { exact: 3, close: 2, unchecked: 1, missing: 0 };
const filled = (c: Candidate) => [c.units, c.beds, c.sqft, c.acres, c.startYear, c.endYear].filter(v => v != null).length;

/* One card per project: the most advanced record leads (approved beats proposed), blanks are filled from the others,
   and records that disagree on the address are flagged for the reviewer. */
export function groupFound(list: Found[], idOf: (c: Candidate) => string): Group[] {
  const groups: Found[][] = [];
  for (const f of list) {
    const g = groups.find(g => g.some(m => sameProject(m, f)));
    if (g) g.push(f); else groups.push([f]);
  }
  return groups.map(members => {
    const ranked = [...members].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || CHECK_RANK[b.check || 'unchecked'] - CHECK_RANK[a.check || 'unchecked']
      || CONF_RANK[b.confidence] - CONF_RANK[a.confidence] || filled(b) - filled(a));
    const lead = ranked[0], c: Found = { ...lead, flags: [...lead.flags] };
    for (const k of ['units', 'beds', 'sqft', 'acres', 'startYear', 'endYear'] as const) if (c[k] == null) c[k] = ranked.find(m => m[k] != null)?.[k] ?? null;
    const addrs = new Map<string, string>();
    members.forEach(m => { const k = addressKey(m.where); if (k && !addrs.has(k)) addrs.set(k, m.where); });
    if (!addressKey(c.where) && addrs.size) c.where = [...addrs.values()][0];
    const conflicts = addrs.size > 1 ? ['Records give different locations: ' + [...addrs.values()].join(' / ')] : [];
    const check = ranked.map(m => m.check || 'unchecked').sort((a, b) => CHECK_RANK[b] - CHECK_RANK[a])[0];
    const category = categoryOf(c);
    return { id: idOf(c), c, members: ranked, category, building: isBuilding(category), check, conflicts };
  });
}
