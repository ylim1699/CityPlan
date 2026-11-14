/* Suggest a map spot for an address in a city record, from Rexburg's street grid. Two scales share the grid numbers:
   city streets count blocks ("North 2nd East" is 2 blocks, about 460 m, east of Center Street), while county roads count
   1,000 to the mile ("West 1600 North" is 1.6 miles north of Main Street). House numbers follow the street they are on,
   so "1600 N 2nd E" is 16 city blocks north on 2nd East, and "620 S 2530 W" is 620 county units south on 2530 West.
   "396 W Moody Rd" is found on Moody Road where 396 West would cross it. Addresses without a grid direction
   ("601 University Blvd") get no suggestion. A suggestion is only a starting point: the reviewer looks before confirming. */
import type { Atlas } from './atlas';
import type { XZ } from './types';

type Axis = 'x' | 'y';  // x: east (+) / west (-) of Center St; y: north (+) / south (-) of Main St
type Scale = 'city' | 'county';
type Grid = { axis: Axis; v: number; scale: Scale | 'both' };
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const DIRS: Record<string, string> = { n: 'north', s: 'south', e: 'east', w: 'west' };
const SIGN: Record<string, [Axis, number]> = { north: ['y', 1], south: ['y', -1], east: ['x', 1], west: ['x', -1] };

function clean(s: string) {
  return s.toLowerCase().replace(/(\d)(st|nd|rd|th)(?=[a-z])/g, '$1$2 ').replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).map(w => DIRS[w] || w);
}
/* "North 2nd East" -> 200 east; "West 1600 North" -> 1600 north; "Center Street" -> 0 east */
export function gridOf(name: string): Grid | null {
  const w = clean(name);
  if (w.includes('center') && w.some(x => x === 'street' || x === 'st')) return { axis: 'x', v: 0, scale: 'both' };
  if (w.includes('main') && w.some(x => x === 'street' || x === 'st')) return { axis: 'y', v: 0, scale: 'both' };
  for (let i = 0; i < w.length - 1; i++) {
    const m = w[i].match(/^(\d+)(st|nd|rd|th)?$/), ord = ORD[w[i]];
    const d = SIGN[w[i + 1]];
    if ((!m && !ord) || !d) continue;
    const city = !!ord || !!m![2];
    const n = ord ? ord * 100 : city ? +m![1] * 100 : +m![1];
    return { axis: d[0], v: n * d[1], scale: city ? 'city' : 'county' };
  }
  return null;
}

type Line = { pts: XZ[]; name: string };
function median(a: number[]) { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; }

/* grid number -> scene coordinate, piecewise linear through the mapped grid streets (outliers dropped) */
function axisMap(pairs: [number, number][]) {
  const byV = new Map<number, number[]>();
  pairs.forEach(([v, c]) => byV.set(v, (byV.get(v) || []).concat(c)));
  let pts = [...byV].map(([v, cs]) => [v, median(cs)] as [number, number]).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const k = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const res = pts.map(p => Math.abs(p[1] - (my + k * (p[0] - mx)))), mad = median(res) || 1e-6;
  pts = pts.filter((_, i) => res[i] <= 4 * mad);
  const mono: [number, number][] = [];
  pts.forEach(p => { if (!mono.length || Math.sign(p[1] - mono[mono.length - 1][1]) === Math.sign(k)) mono.push(p); });
  if (mono.length < 2) return null;
  return (v: number) => {
    let i = 0;
    while (i < mono.length - 2 && v > mono[i + 1][0]) i++;
    const [a, b] = [mono[i], mono[i + 1]];
    return a[1] + (v - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
  };
}
function nearestOn(lines: Line[], p: XZ): { at: XZ; d: number } | null {
  let best: { at: XZ; d: number } | null = null;
  for (const l of lines) for (let i = 0; i < l.pts.length - 1; i++) {
    const a = l.pts[i], b = l.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
    const at: XZ = [a[0] + u * dx, a[1] + u * dz], d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (!best || d < best.d) best = { at, d };
  }
  return best;
}
/* where a road crosses the line x = c (axis 'x') or z = c (axis 'y') */
function crossings(lines: Line[], axis: Axis, c: number): XZ[] {
  const k = axis === 'x' ? 0 : 1, out: XZ[] = [];
  for (const l of lines) for (let i = 0; i < l.pts.length - 1; i++) {
    const a = l.pts[i], b = l.pts[i + 1];
    if ((a[k] - c) * (b[k] - c) > 0 || a[k] === b[k]) continue;
    const u = (c - a[k]) / (b[k] - a[k]);
    out.push([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]);
  }
  return out;
}
const SUFFIXES = new Set(['rd', 'road', 'hwy', 'highway', 'blvd', 'boulevard', 'dr', 'drive', 'ave', 'avenue', 'st', 'street', 'ln', 'lane', 'way', 'cir', 'circle', 'ct', 'court', 'north', 'south', 'east', 'west']);

export type Spot = { pos: XZ; how: string };
export function createGeocoder(A: Atlas) {
  const S = A.S, grid: { g: Grid; l: Line }[] = [];
  const pairs: Record<Scale, Record<Axis, [number, number][]>> = { city: { x: [], y: [] }, county: { x: [], y: [] } };
  for (const r of A.ROADS) {
    const g = gridOf(r.name); if (!g) continue;
    grid.push({ g, l: r });
    /* a grid street runs across its own axis: an east-west number is read from x, a north-south one from z */
    const at: [number, number] = [g.v, median(r.pts.map(p => g.axis === 'x' ? p[0] : p[1]))];
    (g.scale === 'both' ? (['city', 'county'] as Scale[]) : [g.scale]).forEach(s => pairs[s][g.axis].push(at));
  }
  const maps = { city: { x: axisMap(pairs.city.x), y: axisMap(pairs.city.y) }, county: { x: axisMap(pairs.county.x), y: axisMap(pairs.county.y) } };
  const to = (scale: Scale, axis: Axis, v: number) => maps[scale][axis]?.(v) ?? null;

  function locate(where: string): Spot | null {
    const w = clean(where.replace(/\b(approximately|approx|located at|located|near)\b/gi, ' '));
    const i = w.findIndex((x, k) => /^\d{1,5}$/.test(x) && !!SIGN[w[k + 1]]);
    if (i < 0) return null;
    const n = +w[i], [axis, sign] = SIGN[w[i + 1]], v = n * sign;
    const restWords = w.slice(i + 2);
    const rest = restWords.join(' ');
    const other = gridOf(rest);
    const label = n + ' ' + w[i + 1][0].toUpperCase() + w[i + 1].slice(1);
    if (other) {
      if (other.axis === axis) return null;
      const scale: Scale = other.scale === 'county' ? 'county' : 'city';
      const gx = axis === 'x' ? to(scale, 'x', v) : to(scale, 'x', other.v), gz = axis === 'y' ? to(scale, 'y', v) : to(scale, 'y', other.v);
      if (gx == null || gz == null) return null;
      let pos: XZ = [gx, gz];
      /* settle onto the named street itself when it is mapped nearby (streets bend; the grid fit is straight) */
      const on = nearestOn(grid.filter(e => e.g.axis === other.axis && e.g.v === other.v).map(e => e.l), pos);
      if (on && on.d / S < 250) pos = on.at;
      return { pos, how: label + ' on ' + titleCase(rest) + ', placed from the street grid' };
    }
    /* a named road: house numbers in town count city blocks */
    const core = restWords.filter(x => !SUFFIXES.has(x)).join(' ').replace(/[^a-z0-9 ]/g, '');
    const c = to('city', axis, v);
    if (!core || c == null) return null;
    const re = new RegExp('\\b' + core + '\\b', 'i');
    for (const r of A.ROADS.filter(r => re.test(r.name))) {
      const hit = crossings([r], axis, c)[0];
      if (hit) return { pos: hit, how: label + ' along ' + r.name + ', placed from the street grid' };
    }
    return null;
  }
  return { locate };
}
function titleCase(s: string) { return s.replace(/\b[a-z]/g, c => c.toUpperCase()); }
