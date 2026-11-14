/* What the AI agent returns for one project, and how a person-confirmed candidate becomes an atlas project.
   Shared by the planner panel (upload + confirm) and scripts/run_agent.ts. No SDK imports here. */
import type { Project, Source } from './types';
import type { Category, QuoteCheck } from './review';

export type Candidate = {
  name: string; type: string; category?: Category | null; check?: QuoteCheck; status: 'construction' | 'approved' | 'planned'; where: string;
  units: number | null; beds: number | null; sqft: number | null; acres: number | null;
  startYear: number | null; endYear: number | null; plain: string; quote: string; page: number | null;
  confidence: 'high' | 'medium' | 'low'; flags: string[];
  /* from newer agent runs; older candidates go through the word screen in review.ts */
  stage?: 'new' | 'under construction' | 'already built'; worth?: boolean; why?: string;
};

export function candidateId(c: Candidate) { return 'ag-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

/* What the reviewer says a placed project is: the building type sets its footprint on the map and how its size turns into
   traffic (units -> households, student beds -> students, sq ft -> visits); the year is when it opens and starts counting. */
export type PlaceKind = 'student' | 'apartments' | 'homes' | 'retail' | 'office' | 'public';
export const PLACE_TYPES: Record<PlaceKind, { label: string; field: 'units' | 'beds' | 'sqft'; size: number; rate: number; w: number; d: number; h: number; n: number }> = {
  student: { label: 'Student housing', field: 'beds', size: 500, rate: 2.5, w: 70, d: 50, h: 18, n: 2 },
  apartments: { label: 'Apartments or townhomes', field: 'units', size: 120, rate: 6.7, w: 80, d: 60, h: 12, n: 3 },
  homes: { label: 'Single-family homes', field: 'units', size: 250, rate: 9.4, w: 300, d: 300, h: 8, n: 12 },
  retail: { label: 'Store or restaurant', field: 'sqft', size: 50000, rate: 61, w: 120, d: 90, h: 9, n: 1 },
  office: { label: 'Office or clinic', field: 'sqft', size: 60000, rate: 11, w: 80, d: 60, h: 16, n: 1 },
  public: { label: 'School, church or public building', field: 'sqft', size: 40000, rate: 10, w: 90, d: 70, h: 10, n: 1 }
};
export type Placed = { kind: PlaceKind; size: number; year: number };
/* the reviewer's starting point: the type and size the record suggests, opening when the record says (else in two years) */
export function placeDefaults(c: Candidate, now = new Date().getFullYear()): Placed {
  const t = (c.type + ' ' + c.name + ' ' + (c.category || '')).toLowerCase();
  const kind: PlaceKind = c.beds && /student/.test(t) ? 'student' : /single|subdivision|plat|homes?\b/.test(t) && !/town/.test(t) ? 'homes'
    : c.units || /housing|apartment|townhome|condo|residential/.test(t) ? 'apartments' : /school|church|temple|library|public/.test(t) ? 'public'
    : /office|clinic|medical/.test(t) ? 'office' : /commercial|retail|store|restaurant|grocery|mixed/.test(t) ? 'retail' : 'apartments';
  const ty = PLACE_TYPES[kind], size = c[ty.field] ?? ty.size;
  return { kind, size, year: Math.floor(c.endYear ?? (c.startYear != null ? c.startYear + 1 : now + 2)) };
}

/* ll: the map location the reviewer chose; pl: the type, size and opening year the reviewer chose (defaults from the record).
   Trip estimates use the same textbook rates as the rest of the atlas. */
export function toProject(c: Candidate, ll: [number, number], foundIn: Source, pl: Placed = placeDefaults(c)): Project {
  const ty = PLACE_TYPES[pl.kind], end = pl.year + 0.75  /* opens in the fall, as ghosts and enrollment do */;
  const start = Math.min(c.startYear ?? end - 1.5, end - 0.25);
  const units = ty.field === 'units' ? pl.size : undefined, beds = ty.field === 'beds' ? pl.size : undefined, sqft = ty.field === 'sqft' ? pl.size : undefined;
  const trips = Math.round(ty.field === 'sqft' ? pl.size / 1000 * ty.rate : pl.size * ty.rate);
  const fromRecord = c[ty.field] === pl.size;
  return {
    id: candidateId(c), name: c.name, type: ty.label, status: c.status, ll: [ll[0], ll[1]], start, end,
    size: [units && units + ' units', beds && beds + ' beds', sqft && sqft.toLocaleString('en-US') + ' sq ft', c.acres && c.acres + ' acres'].filter(Boolean).join(', '),
    units, beds, sqft, trips, footM: [ty.w, ty.d], hM: ty.h, n: ty.n,
    tripBasis: ty.field === 'sqft' ? sqft!.toLocaleString('en-US') + ' sq ft x ' + ty.rate + ' trips per 1,000 sq ft (estimate).'
      : pl.size + ' ' + ty.field + ' x ' + ty.rate + ' trips a day (' + (ty.field === 'beds' ? 'assumed' : 'textbook rate') + ').',
    where: c.where, plain: c.plain, evidence: c.quote, source: foundIn, foundIn, foundBy: 'agent', reviewed: true, confidence: c.confidence,
    flags: c.flags.concat(fromRecord ? [] : ['Size chosen by the reviewer (' + ty.label.toLowerCase() + '); not in the record'],
      c.endYear == null ? ['Opening year (' + pl.year + ') chosen by the reviewer; not in the record'] : [], ['Map location set by the reviewer'])
  };
}
