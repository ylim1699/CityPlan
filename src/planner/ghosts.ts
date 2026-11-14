/* Planner ghosts: fixed building types a planner places "for a year". A ghost counts from fall of its year on.
   Planned ghosts go into the router's scenario (housing adds people to its zone, shops and offices add trips);
   Suggested ghosts are proposals and are drawn on the map but do not count until a planner accepts them. */
import type { Atlas } from '../model/atlas';
import type { PlanSite, ZonesFile } from '../model/routing';
import type { XZ } from '../model/types';

export type GhostKind = 'student' | 'homes' | 'grocery' | 'office' | 'parking';
/* place: result of the placement rules at the last drop (moved = meters it snapped; ok false = no legal spot nearby) */
export type Ghost = { id: string; kind: GhostKind; pos: XZ; year: number; status: 'planned' | 'suggested'; why?: string; place?: { moved: number; ok: boolean; lot?: boolean } };

/* Sizes in meters. Trip figures are ESTIMATES from ITE-style rates (same as the UI sandbox). */
export const GHOST_TYPES: Record<GhostKind, {
  label: string; size: string; w: number; d: number; h: number; n: number; note: string;
  beds?: number; units?: number; spaces?: number; park: number; trips?: number;
}> = {
  student: { label: 'Student housing', size: '500 beds', w: 70, d: 50, h: 18, n: 2, beds: 500, park: 300, note: 'Adds 500 students to its zone; the router gives fewer car trips in the walk district' },
  homes: { label: 'Neighborhood', size: '250 homes', w: 300, d: 300, h: 8, n: 12, units: 250, park: 550, note: 'Adds 250 households (3.3 people each) to its zone' },
  grocery: { label: 'Grocery store', size: '50,000 sq ft', w: 120, d: 90, h: 9, n: 1, park: 200, trips: 3055, note: '94 trips per 1,000 sq ft, less 35% pass-by (estimate)' },
  office: { label: 'Office or clinic', size: '60,000 sq ft', w: 80, d: 60, h: 16, n: 1, park: 180, trips: 660, note: '11 trips per 1,000 sq ft (estimate)' },
  parking: { label: 'Parking structure', size: '600 spaces', w: 100, d: 60, h: 12, n: 1, spaces: 600, park: 0, note: 'Adds spaces; trips are already counted by the uses it serves' }
};
export const KINDS = Object.keys(GHOST_TYPES) as GhostKind[];
export const YEARS = [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034];
/* fall of the ghost's year: same convention as enrollment (popSeries switches years at t = y + 0.75) */
export const ghostActive = (g: Ghost, t: number) => t >= g.year + 0.75;

let seq = 1;
export function newGhost(kind: GhostKind, pos: XZ, year: number, status: Ghost['status'] = 'planned', why?: string): Ghost {
  return { id: 'g' + Date.now().toString(36) + (seq++), kind, pos: [pos[0], pos[1]], year, status, why };
}

/* Nearest town zone to a scene position (same rule as the placement test) */
export function zoneFinder(A: Atlas, zones: ZonesFile | null) {  /* nearest Census zone (kept for reference; ghosts now use ghostPlans) */
  return (pos: XZ) => {
    if (!zones) return -1;
    let best = -1, bd = Infinity;
    zones.zones.forEach((z, i) => { if (z.kind !== 'town') return; const d = Math.hypot(z.x * A.S - pos[0], z.z * A.S - pos[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  };
}

/* What a set of ghosts adds to the router's scenario at time t: each counted ghost is its own small zone at its site
   (scenario.plans), with a driveway to the nearest street, so its trips leave from where it actually sits.
   Positions are rounded to 4 m so tiny drags reuse cached runs. */
const r2 = (x: number) => Math.round(x * 50) / 50;
export function ghostPlans(list: Ghost[], t: number): PlanSite[] {
  return list.filter(g => g.status === 'planned' && ghostActive(g, t) && g.kind !== 'parking').map(g => {
    const ty = GHOST_TYPES[g.kind];
    return { id: g.id, pos: [r2(g.pos[0]), r2(g.pos[1])] as XZ, beds: ty.beds || 0, units: ty.units || 0, attract: ty.trips || 0 };
  });
}

/* Supply the active planned ghosts add, for the counter strip */
export function ghostSupply(list: Ghost[], t: number) {
  const s = { beds: 0, units: 0, spaces: 0, parkNeed: 0 };
  list.forEach(g => {
    if (g.status !== 'planned' || !ghostActive(g, t)) return;
    const ty = GHOST_TYPES[g.kind];
    s.beds += ty.beds || 0; s.units += ty.units || 0; s.spaces += ty.spaces || 0; s.parkNeed += ty.park;
  });
  return s;
}

export function loadGhosts(): Ghost[] { try { return JSON.parse(localStorage.getItem('atlas-ghosts') || '[]'); } catch { return []; } }
export function saveGhosts(list: Ghost[]) { try { localStorage.setItem('atlas-ghosts', JSON.stringify(list)); } catch { /* storage off */ } }
