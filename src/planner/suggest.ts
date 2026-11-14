/* "Suggest sites": screen open land quickly, then let the router judge the best few (ported from the UI sandbox,
   rebuilt on CityPlan's router). Open land = no mapped building, park or water under the footprint (parking lots count as redevelopment sites),
   no street through it, and a main street within about 1.2 km. Zoning and ownership are NOT checked. */
import { useCallback, useRef, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { Scenario } from '../model/routing';
import type { SegResult, XZ } from '../model/types';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { hourLabel } from '../ui';
import { GHOST_TYPES, ghostPlans, newGhost, type Ghost, type GhostKind } from './ghosts';

const OCC = 0.3;  /* occupancy grid cell, scene units (60 m) */
type Land = { occ: Set<string>; polys: { box: number[]; pts: XZ[]; lot: boolean }[]; segIdx: Map<string, number[]>; box: number[] };
const landCache = new WeakMap<Atlas, Land>();
const key = (x: number, z: number) => Math.floor(x / OCC) + ',' + Math.floor(z / OCC);

function land(A: Atlas): Land {
  const hit = landCache.get(A); if (hit) return hit;
  const C = A.OSM, S = A.S, occ = new Set<string>(), polys: Land['polys'] = [], segIdx = new Map<string, number[]>();
  const box = [1e9, -1e9, 1e9, -1e9];
  (C.buildings || []).forEach(b => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 2; k < b.length; k += 2) { const x = b[k] * S, z = b[k + 1] * S; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let x = x0; x <= x1 + OCC / 2; x += OCC / 2) for (let z = z0; z <= z1 + OCC / 2; z += OCC / 2) occ.add(key(x, z));
  });
  /* parks and water are off limits; parking lots are allowed as redevelopment sites (student housing near campus usually replaces lots) */
  ([[C.parks, false], [C.water, false], [C.lots, true]] as [number[][], boolean][]).forEach(([list, lot]) => (list || []).forEach(fl => {
    const pts: XZ[] = []; for (let k = 0; k < fl.length; k += 2) pts.push([fl[k] * S, fl[k + 1] * S]);
    if (pts.length < 3) return;
    const bx = [1e9, -1e9, 1e9, -1e9]; pts.forEach(p => { bx[0] = Math.min(bx[0], p[0]); bx[1] = Math.max(bx[1], p[0]); bx[2] = Math.min(bx[2], p[1]); bx[3] = Math.max(bx[3], p[1]); });
    polys.push({ box: bx, pts, lot });
  }));
  A.SEGS.forEach((s, i) => {
    const n = Math.max(2, Math.ceil(s.len / (OCC / 2)));
    for (let f = 0; f <= n; f++) occ.add(key(s.a[0] + (s.b[0] - s.a[0]) * f / n, s.a[1] + (s.b[1] - s.a[1]) * f / n));
    const k2 = Math.floor(s.mid[0] / 2) + ',' + Math.floor(s.mid[1] / 2);
    const l = segIdx.get(k2); if (l) l.push(i); else segIdx.set(k2, [i]);
    box[0] = Math.min(box[0], s.mid[0]); box[1] = Math.max(box[1], s.mid[0]); box[2] = Math.min(box[2], s.mid[1]); box[3] = Math.max(box[3], s.mid[1]);
  });
  const L = { occ, polys, segIdx, box }; landCache.set(A, L); return L;
}
function inPoly(p: XZ, pts: XZ[]) {
  let c = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const pa = pts[a], pb = pts[b]; if ((pa[1] > p[1]) !== (pb[1] > p[1]) && p[0] < (pb[0] - pa[0]) * (p[1] - pa[1]) / (pb[1] - pa[1] + 1e-12) + pa[0]) c = !c; }
  return c;
}
function nearSegs(L: Land, pos: XZ, r: number) {
  const out: number[] = [], cx = Math.floor(pos[0] / 2), cz = Math.floor(pos[1] / 2), R = Math.ceil(r / 2);
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) { const l = L.segIdx.get((cx + dx) + ',' + (cz + dz)); if (l) out.push(...l); }
  return out;
}
/* Is a footprint of this kind free at pos? (used for suggestions now, and for placement rules in step 3) */
export function siteFree(A: Atlas, kind: GhostKind, pos: XZ, allowLots = true) {
  const L = land(A), t = GHOST_TYPES[kind], hw = t.w * A.S / 2, hd = t.d * A.S / 2;
  for (let x = -hw; x <= hw + 1e-9; x += OCC / 2) for (let z = -hd; z <= hd + 1e-9; z += OCC / 2) if (L.occ.has(key(pos[0] + x, pos[1] + z))) return false;
  const probes: XZ[] = [pos, [pos[0] - hw, pos[1] - hd], [pos[0] + hw, pos[1] - hd], [pos[0] - hw, pos[1] + hd], [pos[0] + hw, pos[1] + hd]];
  for (const P of L.polys) {
    if (P.lot && allowLots) continue;
    if (P.box[0] > pos[0] + hw || P.box[1] < pos[0] - hw || P.box[2] > pos[1] + hd || P.box[3] < pos[1] - hd) continue;
    if (probes.some(q => inPoly(q, P.pts))) return false;
  }
  return true;
}
const candCache = new WeakMap<Atlas, Record<string, XZ[]>>();
export function candidates(A: Atlas, kind: GhostKind): XZ[] {
  const all = candCache.get(A) || {}; candCache.set(A, all);
  if (all[kind]) return all[kind];
  const L = land(A), b = L.box, step = Math.max(0.6, Math.sqrt((b[1] - b[0]) * (b[3] - b[2]) / 9000)), out: XZ[] = [];
  for (let x = b[0]; x <= b[1]; x += step) for (let z = b[2]; z <= b[3]; z += step) {
    const p: XZ = [x, z];
    if (!nearSegs(L, p, 2).length) continue;
    if (siteFree(A, kind, p)) out.push(p);
  }
  return (all[kind] = out);
}

/* Quick screen (lower is better): access to a main street, how loaded nearby main streets already are, and where
   each kind belongs (student housing and parking near campus; homes and stores off the blocks next to campus). */
export function screen(A: Atlas, kind: GhostKind, pos: XZ, shown: SegResult[]) {
  const L = land(A), camp = A.M(A.OSM.places.campus), km = Math.hypot(pos[0] - camp[0], pos[1] - camp[1]) * 0.2;  /* 1 scene unit = 200 m */
  let access = 99, load = 0;
  for (const i of nearSegs(L, pos, 3)) {
    const s = A.SEGS[i]; if (s.road.cls === 'local') continue;
    const d = Math.hypot(s.mid[0] - pos[0], s.mid[1] - pos[1]);
    access = Math.min(access, d * 0.2);
    if (d < 1.5 && shown[i]) load = Math.max(load, shown[i].vc);
  }
  if (access > 1.2) return null;
  let sc = (access > 0.4 ? (access - 0.4) * 3 : 0) + Math.max(0, load - 0.7) * 4;
  if (kind === 'student') sc += Math.max(0, km - 0.8) * 2.2;
  if (kind === 'parking') sc = km * 3 + (access > 0.4 ? access : 0);
  if (kind === 'homes') sc += (km < 0.6 ? 1.5 : 0) + km * 0.25;
  if (kind === 'grocery') sc += (km < 0.6 ? 1.5 : 0) + km * 0.15;
  if (kind === 'office') sc += km * 0.1;
  return { score: sc, km, access };
}

export type SuggestState = { busy: string | null; msg: string | null };
/* Hook: suggest(kind, n, year) screens open land, routes the year with each of the best 8 sites, and adds the
   n that add the least delay as Suggested ghosts. Uses its own 'judge' worker request so other panels can't drop it. */
export function useSuggest(A: Atlas, sc: Scenario, shown: SegResult[], ghosts: Ghost[], setGhosts: (g: Ghost[]) => void) {
  const [st, setSt] = useState<SuggestState>({ busy: null, msg: null });
  const job = useRef<{ key: string; kind: GhostKind; n: number; year: number; picks: { pos: XZ; km: number }[]; why?: string } | null>(null);
  const ghostsRef = useRef(ghosts); ghostsRef.current = ghosts;
  useWorkerMessages(m => {
    const j = job.current;
    if (m.type !== 'judge' || !j || m.key !== j.key) return;
    job.current = null;
    const ranked = m.options.map(o => ({ pos: j.picks[+o.id].pos, km: j.picks[+o.id].km, dv: o.vht - m.base })).sort((a, b) => a.dv - b.dv).slice(0, j.n);
    const keep = ghostsRef.current.filter(g => !(g.status === 'suggested' && g.kind === j.kind));
    const add = ranked.map((r, i) => newGhost(j.kind, r.pos, j.year, 'suggested',
      (j.why ? j.why + ' · ' : i === 0 && j.n === 1 ? 'Best spot · ' : '') + 'Router: ' + (r.dv >= 0 ? '+' : '−') + Math.abs(r.dv).toFixed(1) + ' veh-h at ' + hourLabel(sc.hour) + ' · ' + r.km.toFixed(1) + ' km to campus'));
    setGhosts(keep.concat(add));
    setSt({ busy: null, msg: add.length ? 'Tested ' + m.options.length + ' open sites with the router; ' + add.length + ' suggested (dashed on the map).' : 'No open site found.' });
  });
  const suggest = useCallback((kind: GhostKind, n: number, year: number, why?: string) => {
    setSt({ busy: 'Screening open land…', msg: null });
    setTimeout(() => {  /* let the "busy" line paint before the screen runs */
      const avoid = ghostsRef.current.map(g => g.pos);
      const scored = candidates(A, kind).filter(p => !avoid.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 3))
        .map(p => ({ pos: p, s: screen(A, kind, p, shown) })).filter(x => x.s).sort((a, b) => a.s!.score - b.s!.score);
      const picks: { pos: XZ; km: number }[] = [];
      for (const x of scored) { if (picks.length >= Math.max(n, 8)) break; if (!picks.some(q => Math.hypot(q.pos[0] - x.pos[0], q.pos[1] - x.pos[1]) < 4)) picks.push({ pos: x.pos, km: x.s!.km }); }
      if (!picks.length) { setSt({ busy: null, msg: 'No open site near a main street was found for this type.' }); return; }
      if (kind === 'parking') {  /* no trips of its own, so the router can't rank it: keep the screen's order */
        const keep = ghostsRef.current.filter(g => !(g.status === 'suggested' && g.kind === kind));
        setGhosts(keep.concat(picks.slice(0, n).map((p, i) => newGhost(kind, p.pos, year, 'suggested', (why ? why + ' · ' : i === 0 ? 'Best spot · ' : '') + p.km.toFixed(1) + ' km to campus'))));
        setSt({ busy: null, msg: 'Parking adds no trips of its own, so sites are ranked by distance to campus and street access.' });
        return;
      }
      const t = year + 0.875, base: Scenario = { ...sc, t }, plans = ghostPlans(ghostsRef.current, t);
      if (plans.length) base.plans = plans; else delete base.plans;
      const ty = GHOST_TYPES[kind], k = 'judge:' + Date.now();
      job.current = { key: k, kind, n, year, picks, why };
      setSt({ busy: 'Routing fall ' + year + ' with each of ' + picks.length + ' open sites…', msg: null });
      send({ type: 'judge', key: k, sc: base, options: picks.map((p, i) => ({ id: String(i), sc: { ...base, plans: (base.plans || []).concat([{ id: 'cand', pos: p.pos, beds: ty.beds || 0, units: ty.units || 0, attract: ty.trips || 0 }]) } })) });
    }, 30);
  }, [A, sc, shown, setGhosts]);
  return { suggest, st };
}

/* ---------- Placement rules (step 3) ----------
   Generic rules only, until the county zoning layer is loaded: the footprint must sit on open land (no mapped
   building, park or water under it; parking lots allowed as redevelopment, no street through it, which also keeps it about 30-60 m back from
   street centerlines), keep 30 m from the planner's other projects, and have a street within about 400 m.
   A drop that breaks a rule snaps to the nearest spot that passes, searching out to 1 km. */
function clearOfOthers(A: Atlas, kind: GhostKind, pos: XZ, others: Ghost[]) {
  const t = GHOST_TYPES[kind], gap = 30 * A.S;
  return others.every(o => {
    const u = GHOST_TYPES[o.kind];
    return Math.abs(o.pos[0] - pos[0]) > (t.w + u.w) * A.S / 2 + gap || Math.abs(o.pos[1] - pos[1]) > (t.d + u.d) * A.S / 2 + gap;
  });
}
export type Placement = { pos: XZ; moved: number; ok: boolean; lot?: boolean };  /* moved in meters; ok false = no legal spot nearby; lot = sits on a parking lot */
export function snapSite(A: Atlas, kind: GhostKind, pos: XZ, others: Ghost[]): Placement {
  const L = land(A);
  const legal = (p: XZ) => nearSegs(L, p, 2).length > 0 && siteFree(A, kind, p) && clearOfOthers(A, kind, p, others);
  const onLot = (p: XZ) => !siteFree(A, kind, p, false);
  if (legal(pos)) return { pos, moved: 0, ok: true, lot: onLot(pos) };
  const step = OCC / 2, maxR = 5;  /* 30 m rings out to 1 km */
  for (let r = step; r <= maxR + 1e-9; r += step) {
    let best: XZ | null = null, bd = Infinity;
    const n = Math.max(8, Math.ceil(2 * Math.PI * r / step));
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * k / n, p: XZ = [pos[0] + r * Math.cos(a), pos[1] + r * Math.sin(a)];
      if (legal(p)) { const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]); if (d < bd) { bd = d; best = p; } }
    }
    if (best) return { pos: best, moved: Math.round(bd / A.S), ok: true, lot: onLot(best) };
  }
  return { pos, moved: 0, ok: false };
}
