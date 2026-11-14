/* Slime-mold (Physarum) search for new roads, ported from the UI sandbox's router.js.
   Tero et al. (2010): tubes on a grid carry flow from the site to one food source at a time; tubes that carry flow
   thicken, the rest wither. Buildings, water and parks are expensive to cross, so tubes bend around them.
   The strongest tube to each food source becomes a candidate road. It only PROPOSES roads: the router judges them. */
import type { Atlas } from './atlas';
import type { Router } from './routing';
import type { XZ } from './types';

class Heap {
  k: number[] = []; v: number[] = [];
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!, n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export function physarum(o: { nx: number; nz: number; cost: Float64Array; cell: number; src: number; sinks: number[]; iters: number }) {
  const { nx, nz, cost, cell, src, sinks } = o, N = nx * nz;
  const E: number[] = [], dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) for (const d of dirs) {
    const x2 = x + d[0], z2 = z + d[1]; if (x2 < 0 || x2 >= nx || z2 < 0 || z2 >= nz) continue;
    const a = z * nx + x, b = z2 * nx + x2;
    E.push(a, b, Math.hypot(d[0], d[1]) * cell * (cost[a] + cost[b]) / 2);
  }
  const nE = E.length / 3, D = new Float64Array(nE).fill(1), adj: number[][] = Array.from({ length: N }, () => []);
  for (let e = 0; e < nE; e++) { adj[E[3 * e]].push(e); adj[E[3 * e + 1]].push(e); }
  const p = new Float64Array(N), r = new Float64Array(N), d = new Float64Array(N), Ap = new Float64Array(N);
  function mul(v: Float64Array, out: Float64Array, sink: number) {  /* Laplacian times v, sink held at zero */
    out.fill(0);
    for (let e = 0; e < nE; e++) { const a = E[3 * e], b = E[3 * e + 1], f = D[e] / E[3 * e + 2] * (v[a] - v[b]); out[a] += f; out[b] -= f; }
    out[sink] = 0;
  }
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let it = 0; it < o.iters; it++) {
    const sink = sinks[Math.floor(rnd() * sinks.length)];
    p[sink] = 0; mul(p, Ap, sink);
    for (let i = 0; i < N; i++) r[i] = (i === src ? 1 : 0) - Ap[i];
    r[sink] = 0; d.set(r);
    let rr = 0; for (let i = 0; i < N; i++) rr += r[i] * r[i];
    for (let k = 0; k < 400 && rr > 1e-10; k++) {  /* conjugate gradients, warm-started from the last pressures */
      mul(d, Ap, sink);
      let dAd = 0; for (let i = 0; i < N; i++) dAd += d[i] * Ap[i];
      if (!dAd) break;
      const al = rr / dAd; let rr2 = 0;
      for (let i = 0; i < N; i++) { p[i] += al * d[i]; r[i] -= al * Ap[i]; rr2 += r[i] * r[i]; }
      const bt = rr2 / rr; rr = rr2;
      for (let i = 0; i < N; i++) d[i] = r[i] + bt * d[i];
      d[sink] = 0;
    }
    for (let e = 0; e < nE; e++) {
      const Q = Math.abs(D[e] / E[3 * e + 2] * (p[E[3 * e]] - p[E[3 * e + 1]]));
      const fQ = Math.pow(Q, 1.6) / (1 + Math.pow(Q, 1.6));  /* sigmoid response: strong tubes win */
      D[e] = Math.max(1e-4, D[e] + 0.6 * (fQ * 2 - D[e]));
    }
  }
  /* strongest tube to each food source: shortest path where thick tubes are cheap */
  const paths = sinks.map(t => {
    const dist = new Float64Array(N).fill(Infinity), pe = new Int32Array(N).fill(-1), h = new Heap();
    dist[src] = 0; h.push(0, src);
    while (h.k.length) {
      const u = h.pop(); if (u === t) break;
      for (const e of adj[u]) {
        const v = E[3 * e] === u ? E[3 * e + 1] : E[3 * e], nd = dist[u] + E[3 * e + 2] / D[e];
        if (nd < dist[v]) { dist[v] = nd; pe[v] = e; h.push(nd, v); }
      }
    }
    const cells: number[] = []; let cur = t, sum = 0, cnt = 0;
    while (cur !== src && cur >= 0) {
      cells.push(cur); const e2 = pe[cur]; if (e2 < 0) break;
      sum += D[e2]; cnt++;
      cur = E[3 * e2] === cur ? E[3 * e2 + 1] : E[3 * e2];
    }
    cells.push(src); cells.reverse();
    return { sink: t, cells, tube: cnt ? sum / cnt : 0 };
  });
  return { paths };
}

/* Crossing cost per grid cell: 1 = open land; buildings 14, water 60, parks 4, parking lots 2.5, along existing streets 1.8 */
function costGrid(A: Atlas, box: number[], cell: number) {
  const C = A.OSM, S = A.S, nx = Math.ceil((box[1] - box[0]) / cell) + 1, nz = Math.ceil((box[3] - box[2]) / cell) + 1, g = new Float64Array(nx * nz).fill(1);
  const ci = (x: number, z: number) => { const i = Math.round((x - box[0]) / cell), j = Math.round((z - box[2]) / cell); return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i; };
  const bump = (x: number, z: number, v: number) => { const k = ci(x, z); if (k >= 0) g[k] = Math.max(g[k], v); };
  (C.buildings || []).forEach(b => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 2; k < b.length; k += 2) { const x = b[k] * S, z = b[k + 1] * S; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (x1 < box[0] || x0 > box[1] || z1 < box[2] || z0 > box[3]) return;
    for (let xx = x0; xx <= x1 + cell / 2; xx += cell / 2) for (let zz = z0; zz <= z1 + cell / 2; zz += cell / 2) bump(xx, zz, 14);
  });
  ([[C.water, 60], [C.parks, 4], [C.lots, 2.5]] as [number[][], number][]).forEach(([list, v]) => {
    (list || []).forEach(fl => {
      const pts: XZ[] = []; for (let k = 0; k < fl.length; k += 2) pts.push([fl[k] * S, fl[k + 1] * S]);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; pts.forEach(q => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); });
      if (x1 < box[0] || x0 > box[1] || z1 < box[2] || z0 > box[3]) return;
      for (let xx = Math.max(x0, box[0]); xx <= Math.min(x1, box[1]); xx += cell) for (let zz = Math.max(z0, box[2]); zz <= Math.min(z1, box[3]); zz += cell) {
        let inside = false;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const pa = pts[a], pb = pts[b]; if ((pa[1] > zz) !== (pb[1] > zz) && xx < (pb[0] - pa[0]) * (zz - pa[1]) / (pb[1] - pa[1]) + pa[0]) inside = !inside; }
        if (inside) bump(xx, zz, v);
      }
      pts.forEach(q => bump(q[0], q[1], v));
    });
  });
  A.SEGS.forEach(s => { for (let f = 0; f <= 1; f += 0.25) bump(s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f, 1.8); });
  return { g, nx, nz, ci };
}
function simplify(pts: XZ[], tol: number): XZ[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1]; let mx = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((pts[i][0] - a[0]) * dx + (pts[i][1] - a[1]) * dz) / l2));
    const d = Math.hypot(pts[i][0] - a[0] - u * dx, pts[i][1] - a[1] - u * dz); if (d > mx) { mx = d; mi = i; }
  }
  if (mx < tol) return [a, b];
  return simplify(pts.slice(0, mi + 1), tol).slice(0, -1).concat(simplify(pts.slice(mi), tol));
}

export type RoadCandidate = { to: number; toName: string; pts: XZ[]; lenM: number; tube: number };
/* Candidate roads from a site (scene units) to nearby streets, strongest tubes first; none cross a building */
export function slimeRoads(A: Atlas, R: Router, site: XZ, rad = 9, skipNode?: number | null) {
  const skip: Record<number, 1> = {}; if (skipNode != null) skip[skipNode] = 1;
  const sinks = R.sinksAround(site, rad, skip);
  if (!sinks.length) return { cands: [] as RoadCandidate[], sinks: 0 };
  const box = [site[0], site[0], site[1], site[1]];
  sinks.forEach(s => { box[0] = Math.min(box[0], s.pos[0]); box[1] = Math.max(box[1], s.pos[0]); box[2] = Math.min(box[2], s.pos[1]); box[3] = Math.max(box[3], s.pos[1]); });
  box[0] -= 1.5; box[1] += 1.5; box[2] -= 1.5; box[3] += 1.5;
  const cell = Math.max(0.35, Math.sqrt((box[1] - box[0]) * (box[3] - box[2]) / 2400));
  const cg = costGrid(A, box, cell), si = cg.ci(site[0], site[1]);
  cg.g[si] = 1;
  const sk = sinks.map(s => { const k = cg.ci(s.pos[0], s.pos[1]); cg.g[k] = 1; return k; });
  const res = physarum({ nx: cg.nx, nz: cg.nz, cost: cg.g, cell, src: si, sinks: sk, iters: 36 });
  const cands = res.paths.map((pth, i) => {
    let pts: XZ[] = pth.cells.map(k => [box[0] + (k % cg.nx) * cell, box[2] + Math.floor(k / cg.nx) * cell]);
    pts[0] = [site[0], site[1]]; pts[pts.length - 1] = [sinks[i].pos[0], sinks[i].pos[1]];
    pts = simplify(pts, cell * 0.7);
    let len = 0; for (let q = 1; q < pts.length; q++) len += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]);
    const blocked = pth.cells.filter(k => cg.g[k] >= 14).length;
    return { to: sinks[i].node, toName: sinks[i].name, pts, lenM: len / A.S, tube: pth.tube, blocked };
  }).filter(c => c.blocked === 0).sort((a, b) => b.tube - a.tube).slice(0, 5)
    .map(({ blocked: _b, ...c }) => c);
  return { cands, sinks: sinks.length };
}
