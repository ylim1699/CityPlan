/* What the AI agent returns for one project, and how a person-confirmed candidate becomes an atlas project.
   Shared by the planner panel (upload + confirm) and scripts/run_agent.ts. No SDK imports here. */
import type { Project, Source } from './types';

export type Candidate = {
  name: string; type: string; status: 'construction' | 'approved' | 'planned'; where: string;
  units: number | null; beds: number | null; sqft: number | null; acres: number | null;
  startYear: number | null; endYear: number | null; plain: string; quote: string; page: number | null;
  confidence: 'high' | 'medium' | 'low'; flags: string[];
};

export function candidateId(c: Candidate) { return 'ag-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

/* ll: the map location the reviewer chose. Trip estimates use the same textbook rates as the rest of the atlas. */
export function toProject(c: Candidate, ll: [number, number], foundIn: Source): Project {
  const start = c.startYear ?? 2027, end = c.endYear ?? start + 1.5, student = !!c.beds && /student/i.test(c.type);
  const trips = c.units ? Math.round(c.units * 6.7) : student ? Math.round(c.beds! * 2.5) : c.beds ? Math.round(c.beds * 2.6) : c.sqft ? Math.round(c.sqft / 1000 * 10) : 0;
  return {
    id: candidateId(c), name: c.name, type: c.type, status: c.status, ll: [ll[0], ll[1]], start, end,
    size: [c.units && c.units + ' units', c.beds && c.beds + ' beds', c.sqft && c.sqft.toLocaleString('en-US') + ' sq ft', c.acres && c.acres + ' acres'].filter(Boolean).join(', ') || 'Not stated',
    units: c.units ?? undefined, beds: c.beds ?? undefined, sqft: c.sqft ?? undefined, trips,
    tripBasis: c.units ? c.units + ' units x 6.7 trips a day (textbook rate).' : student ? c.beds + ' student beds x 2.5 trips a day (assumed).'
      : c.beds ? c.beds + ' beds x 2.6 trips a day (assisted living rate).' : c.sqft ? 'ASSUMED 10 trips per 1,000 sq ft; check against ITE.' : 'No trip estimate: size not stated.',
    where: c.where, plain: c.plain, evidence: c.quote, source: foundIn, foundIn, foundBy: 'agent', reviewed: true, confidence: c.confidence,
    flags: c.flags.concat(c.startYear == null || c.endYear == null ? ['Dates assumed by the reviewer; not in the record'] : [], ['Map location set by the reviewer'])
  };
}
