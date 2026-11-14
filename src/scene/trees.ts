/* Trees in town (new, for a realistic look): street trees along local streets and collectors in a planting strip
   beyond the curb, and loose groves in parks. Mostly broadleaf (round canopy on a trunk) with some conifers.
   Placed procedurally from OpenStreetMap streets and parks, NOT from a tree inventory, and kept out of buildings,
   water and intersections. Drawn as instanced meshes so tens of thousands stay fast. */
import * as T from 'three';
import type { Atlas } from '../model/atlas';
import type { XZ } from '../model/types';

const VTREE = 1.8;  /* vertical exaggeration for trees (buildings use 2.5; trees look like lollipops past ~2) */
const CELL = 0.05;  /* 10 m occupancy grid */

export function buildTrees(A: Atlas) {
  const C = A.OSM, S = A.S, EXW = 1.5;
  let seed = 1234567; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const key = (x: number, z: number) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  /* where trees can't go: buildings (with a 4 m margin), water, and the asphalt of every street */
  const occ = new Set<string>();
  C.buildings.forEach(b => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 2; k < b.length; k += 2) { const x = b[k] * S, z = b[k + 1] * S; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const m = 4 * S;
    for (let x = x0 - m; x <= x1 + m; x += CELL / 2) for (let z = z0 - m; z <= z1 + m; z += CELL / 2) occ.add(key(x, z));
  });
  A.SEGS.forEach(s => {
    const w = s.road.c.w * S * EXW / 2, n = Math.max(2, Math.ceil(s.len / (CELL / 2)));
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1, ox = -dz / l, oz = dx / l;
    for (let f = 0; f <= n; f++) for (const side of [-1, 0, 1]) {
      const x = s.a[0] + dx * f / n + ox * w * side * 0.9, z = s.a[1] + dz * f / n + oz * w * side * 0.9;
      occ.add(key(x, z));
    }
  });
  const polys = (list: number[][]) => list.map(fl => { const p: XZ[] = []; for (let k = 0; k < fl.length; k += 2) p.push([fl[k] * S, fl[k + 1] * S]); return p; }).filter(p => p.length > 2);
  const inPoly = (p: XZ, pts: XZ[]) => { let c = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const pa = pts[a], pb = pts[b]; if ((pa[1] > p[1]) !== (pb[1] > p[1]) && p[0] < (pb[0] - pa[0]) * (p[1] - pa[1]) / (pb[1] - pa[1] + 1e-12) + pa[0]) c = !c; } return c; };
  const water = polys(C.water || []);
  const wbox = water.map(p => { const b = [1e9, -1e9, 1e9, -1e9]; p.forEach(q => { b[0] = Math.min(b[0], q[0]); b[1] = Math.max(b[1], q[0]); b[2] = Math.min(b[2], q[1]); b[3] = Math.max(b[3], q[1]); }); return b; });
  const wet = (p: XZ) => water.some((w, i) => p[0] >= wbox[i][0] && p[0] <= wbox[i][1] && p[1] >= wbox[i][2] && p[1] <= wbox[i][3] && inPoly(p, w));
  const spots: { p: XZ; big: boolean }[] = [];
  const taken = new Set<string>();
  const tryAdd = (p: XZ, big: boolean) => {
    const k = key(p[0], p[1]); if (occ.has(k) || taken.has(k) || wet(p)) return;
    taken.add(k); spots.push({ p, big });
  };
  /* street trees: every ~22 m on both sides of local streets and collectors, in the planting strip past the curb */
  A.SEGS.forEach(s => {
    if (s.road.cls !== 'local' && s.road.cls !== 'collector') return;
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1, ox = -dz / l, oz = dx / l;
    const off = s.road.c.w * S * EXW * 0.7 + 5 * S, step = 22 * S, end = 12 * S;
    for (let d = end; d < l - end; d += step) for (const side of [-1, 1]) {
      if (rnd() > 0.72) continue;  /* gaps where driveways and yards are */
      const j = (rnd() - 0.5) * 6 * S;
      tryAdd([s.a[0] + dx / l * (d + j) + ox * off * side, s.a[1] + dz / l * (d + j) + oz * off * side], false);
    }
  });
  /* park groves: about one tree per 30 x 30 m, clumped */
  polys(C.parks || []).forEach(pts => {
    const b = [1e9, -1e9, 1e9, -1e9]; pts.forEach(q => { b[0] = Math.min(b[0], q[0]); b[1] = Math.max(b[1], q[0]); b[2] = Math.min(b[2], q[1]); b[3] = Math.max(b[3], q[1]); });
    const st = 30 * S;
    for (let x = b[0]; x <= b[1]; x += st) for (let z = b[2]; z <= b[3]; z += st) {
      if (rnd() > 0.55) continue;  /* open lawns and fields between groves */
      const p: XZ = [x + (rnd() - 0.5) * st, z + (rnd() - 0.5) * st];
      if (inPoly(p, pts)) tryAdd(p, true);
    }
  });

  /* instanced meshes: canopies (broadleaf), trunks, conifers */
  const canopyG = new T.IcosahedronGeometry(1, 1), trunkG = new T.CylinderGeometry(0.12, 0.16, 1, 5), coneG = new T.ConeGeometry(1, 1, 6);
  trunkG.translate(0, 0.5, 0); coneG.translate(0, 0.5, 0);
  const n = spots.length;
  const leafM = new T.MeshLambertMaterial({ color: 0xffffff }), barkM = new T.MeshLambertMaterial({ color: 0x5b4a3a }), pineM = new T.MeshLambertMaterial({ color: 0xffffff });
  const canopy = new T.InstancedMesh(canopyG, leafM, n), trunk = new T.InstancedMesh(trunkG, barkM, n), pine = new T.InstancedMesh(coneG, pineM, n);
  const LEAF = [0x5f7a3a, 0x6b8442, 0x56703a, 0x748c48, 0x4f6a35, 0x80924c].map(h => new T.Color(h)), PINE = [0x3f4f30, 0x485a34, 0x37462b].map(h => new T.Color(h));
  const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), col = new T.Color();
  let nc = 0, np = 0;
  spots.forEach(({ p, big }) => {
    const hM = (big ? 11 : 8) + rnd() * (big ? 9 : 6), hU = hM * S * VTREE;   /* height in meters, then scene units */
    if (rnd() < (big ? 0.25 : 0.12)) {  /* conifer */
      const r = (2 + rnd() * 1.6) * S;
      ps.set(p[0], 0, p[1]); sc.set(r, hU, r); m4.compose(ps, q, sc); pine.setMatrixAt(np, m4);
      col.copy(PINE[Math.floor(rnd() * PINE.length)]); pine.setColorAt(np, col); np++;
      return;
    }
    const r = (2.6 + rnd() * 2.2) * S * (big ? 1.25 : 1), trunkH = hU * 0.42;
    ps.set(p[0], 0, p[1]); sc.set(r * 0.9, trunkH, r * 0.9); m4.compose(ps, q, sc); trunk.setMatrixAt(nc, m4);
    ps.set(p[0], trunkH + (hU - trunkH) * 0.5, p[1]); sc.set(r, (hU - trunkH) * 0.55, r); m4.compose(ps, q, sc); canopy.setMatrixAt(nc, m4);
    col.copy(LEAF[Math.floor(rnd() * LEAF.length)]).offsetHSL(0, 0, (rnd() - 0.5) * 0.06); canopy.setColorAt(nc, col); nc++;
  });
  canopy.count = nc; trunk.count = nc; pine.count = np;
  [canopy, trunk, pine].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  const group = new T.Group(); group.add(trunk, canopy, pine);
  return { group, mats: [leafM, barkM, pineM], count: nc + np };
}
