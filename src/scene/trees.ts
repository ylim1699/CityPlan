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
  const roadOcc = new Set<string>();  /* street asphalt only (shrubs may sit near buildings, never on a street) */
  A.SEGS.forEach(s => {
    const w = s.road.c.w * S * EXW / 2, n = Math.max(2, Math.ceil(s.len / (CELL / 2)));
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1, ox = -dz / l, oz = dx / l;
    for (let f = 0; f <= n; f++) for (const side of [-1, 0, 1]) {
      const x = s.a[0] + dx * f / n + ox * w * side * 0.9, z = s.a[1] + dz * f / n + oz * w * side * 0.9;
      occ.add(key(x, z)); roadOcc.add(key(x, z));
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
  const LEAF = [0x5f7a3a, 0x6b8442, 0x56703a, 0x748c48, 0x4f6a35, 0x80924c, 0x8a9a3e, 0x47652f, 0x6f8f3c].map(h => new T.Color(h)), PINE = [0x3f4f30, 0x485a34, 0x37462b, 0x2f4a36].map(h => new T.Color(h));
  const POPLAR = [0x6b8a3a, 0x7a9440, 0x5d7c36].map(h => new T.Color(h)), ORNAMENT = [0x6b3a44, 0x7a4048, 0x8a5a3a, 0x9aa24a].map(h => new T.Color(h));
  const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), col = new T.Color();
  let nc = 0, np = 0;
  const broadleaf = (p: XZ, hU: number, r: number, crown: number, c: T.Color) => {  /* trunk + canopy; crown = canopy height share */
    const trunkH = hU * (1 - crown);
    ps.set(p[0], 0, p[1]); sc.set(Math.max(r * 0.9, 0.6 * S), trunkH, Math.max(r * 0.9, 0.6 * S)); m4.compose(ps, q, sc); trunk.setMatrixAt(nc, m4);
    ps.set(p[0], trunkH + hU * crown * 0.5, p[1]); sc.set(r, hU * crown * 0.55, r); m4.compose(ps, q, sc); canopy.setMatrixAt(nc, m4);
    canopy.setColorAt(nc, c); nc++;
  };
  /* tree kinds: round shade trees, wide cottonwoods, tall narrow poplars (Idaho windbreaks), small ornamentals
     (purple-leaf plum, crabapple) and conifers; parks get more big and evergreen trees than streets */
  spots.forEach(({ p, big }) => {
    const r0 = rnd(), shade = (rnd() - 0.5) * 0.06;
    const pc = big ? [0.25, 0.08, 0.2, 0.04] : [0.12, 0.1, 0.08, 0.15];  /* conifer, poplar, wide, ornamental */
    if (r0 < pc[0]) {  /* conifer */
      const hU = ((big ? 11 : 8) + rnd() * (big ? 10 : 6)) * S * VTREE, r = (2 + rnd() * 1.6) * S;
      ps.set(p[0], 0, p[1]); sc.set(r, hU, r); m4.compose(ps, q, sc); pine.setMatrixAt(np, m4);
      col.copy(PINE[Math.floor(rnd() * PINE.length)]).offsetHSL(0, 0, shade); pine.setColorAt(np, col); np++;
    } else if (r0 < pc[0] + pc[1]) {  /* poplar: tall and narrow */
      const hU = (15 + rnd() * 8) * S * VTREE, r = (1.4 + rnd() * 0.6) * S;
      broadleaf(p, hU, r, 0.85, col.copy(POPLAR[Math.floor(rnd() * POPLAR.length)]).offsetHSL(0, 0, shade));
    } else if (r0 < pc[0] + pc[1] + pc[2]) {  /* wide spreading shade tree */
      const hU = (11 + rnd() * 6) * S * VTREE, r = (4.5 + rnd() * 2.5) * S;
      broadleaf(p, hU, r, 0.55, col.copy(LEAF[Math.floor(rnd() * LEAF.length)]).offsetHSL(0, 0, shade));
    } else if (r0 < pc[0] + pc[1] + pc[2] + pc[3]) {  /* small ornamental */
      const hU = (4 + rnd() * 2.5) * S * VTREE, r = (1.8 + rnd() * 0.8) * S;
      broadleaf(p, hU, r, 0.62, col.copy(ORNAMENT[Math.floor(rnd() * ORNAMENT.length)]).offsetHSL(0, 0, shade));
    } else {  /* round shade tree */
      const hU = ((big ? 11 : 8) + rnd() * (big ? 9 : 6)) * S * VTREE, r = (2.6 + rnd() * 2.2) * S * (big ? 1.25 : 1);
      broadleaf(p, hU, r, 0.58, col.copy(LEAF[Math.floor(rnd() * LEAF.length)]).offsetHSL(0, 0, shade));
    }
  });
  /* shrubs and bushes: along building foundations (front and side beds) and in clumps in parks */
  const shrubPts: XZ[] = [];
  C.buildings.forEach((b, bi) => {
    if (bi % 3 === 2 && rnd() < 0.5) return;
    const pts: XZ[] = []; for (let k = 2; k < b.length; k += 2) pts.push([b[k] * S, b[k + 1] * S]);
    if (pts.length < 3) return;
    let cx = 0, cz = 0; pts.forEach(v => { cx += v[0]; cz += v[1]; }); cx /= pts.length; cz /= pts.length;
    const nS = Math.floor(rnd() * 4);
    for (let k = 0; k < nS; k++) {
      const e = Math.floor(rnd() * pts.length), a = pts[e], c = pts[(e + 1) % pts.length], f = 0.15 + rnd() * 0.7;
      const ex = a[0] + (c[0] - a[0]) * f, ez = a[1] + (c[1] - a[1]) * f, ox = ex - cx, oz = ez - cz, ol = Math.hypot(ox, oz) || 1;
      const sp: XZ = [ex + ox / ol * 2.2 * S, ez + oz / ol * 2.2 * S];
      if (!roadOcc.has(key(sp[0], sp[1])) && !wet(sp)) shrubPts.push(sp);
    }
  });
  polys(C.parks || []).forEach(pts => {
    const b = [1e9, -1e9, 1e9, -1e9]; pts.forEach(v => { b[0] = Math.min(b[0], v[0]); b[1] = Math.max(b[1], v[0]); b[2] = Math.min(b[2], v[1]); b[3] = Math.max(b[3], v[1]); });
    const st = 45 * S;
    for (let x = b[0]; x <= b[1]; x += st) for (let z = b[2]; z <= b[3]; z += st) {
      if (rnd() > 0.35) continue;
      const c: XZ = [x + (rnd() - 0.5) * st, z + (rnd() - 0.5) * st]; if (!inPoly(c, pts)) continue;
      const nn = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < nn; k++) { const sp: XZ = [c[0] + (rnd() - 0.5) * 6 * S, c[1] + (rnd() - 0.5) * 6 * S]; if (!roadOcc.has(key(sp[0], sp[1])) && !wet(sp)) shrubPts.push(sp); }
    }
  });
  const shrubM = new T.MeshLambertMaterial({ color: 0xffffff }), shrubG = new T.IcosahedronGeometry(1, 0);
  const shrubs = new T.InstancedMesh(shrubG, shrubM, Math.max(1, shrubPts.length));
  const SHRUB = [0x4f6b34, 0x5c7a3a, 0x46602f, 0x6a8440, 0x7a8a3a, 0x3e5a30].map(h => new T.Color(h));
  shrubPts.forEach((sp, k) => {
    const r = (0.8 + rnd() * 1.1) * S, h = (0.7 + rnd() * 0.8) * S * VTREE;
    ps.set(sp[0], h * 0.45, sp[1]); q.setFromAxisAngle(new T.Vector3(0, 1, 0), rnd() * 6.28); sc.set(r, h * 0.55, r * (0.8 + rnd() * 0.4));
    m4.compose(ps, q, sc); shrubs.setMatrixAt(k, m4);
    shrubs.setColorAt(k, col.copy(SHRUB[Math.floor(rnd() * SHRUB.length)]).offsetHSL(0, 0, (rnd() - 0.5) * 0.05));
  });
  q.identity();
  shrubs.count = shrubPts.length; shrubs.instanceMatrix.needsUpdate = true; if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
  canopy.count = nc; trunk.count = nc; pine.count = np;
  [canopy, trunk, pine].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  const group = new T.Group(); group.add(trunk, canopy, pine, shrubs);
  return { group, mats: [leafM, barkM, pineM, shrubM], count: nc + np + shrubPts.length };
}
