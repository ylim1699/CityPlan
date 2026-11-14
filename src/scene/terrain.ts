/* Terrain around Rexburg (ported from the UI sandbox's buildTerrain): real elevation from AWS Terrain Tiles,
   drawn 1.25x taller, kept flat under the streets and blended into the plain at the edges, colored by height
   (farmland, foothills, conifer forest, rock, snow), with instanced conifers on the forested slopes.
   Farmsteads (a clump of shade and windbreak trees) dot the open plain outside town; the land itself keeps the height colors. */
import * as T from 'three';
import type { Atlas } from '../model/atlas';

export type TerrainFile = { N: number; H: number; step: number; base: number; h: number[] };
const TVEX = 1.25;
const QS = 804.67 / 200;  /* half a mile in scene units: farmsteads sit on the section grid */

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTerrain(A: Atlas, t: TerrainFile, landNear: T.Color) {
  const S = A.S, N = t.N, Hu = t.H * S, hv = t.h;
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  A.SEGS.forEach(s => { mnx = Math.min(mnx, s.mid[0]); mxx = Math.max(mxx, s.mid[0]); mnz = Math.min(mnz, s.mid[1]); mxz = Math.max(mxz, s.mid[1]); });
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), farm = new Float32Array(N * N), idx: number[] = [], c = new T.Color();
  const lowC = new T.Color(t.base < 600 ? 0x82935f : 0x88935c), midC = new T.Color(0x7d895b), forC = new T.Color(0x4f5a3a), rockC = new T.Color(0x8a8378), snowC = new T.Color(0xe8e6df);
  const forestPts: [number, number, number][] = [];
  /* where town is: buildings per terrain cell, summed over the 3 x 3 cells around each point (about 2 km across) */
  const cnt = new Float32Array(N * N), cellOf = (v: number) => Math.round((v + Hu) / (2 * Hu) * (N - 1));
  A.OSM.buildings.forEach(b => { const i = cellOf(b[2] * S), j = cellOf(b[3] * S); if (i >= 0 && j >= 0 && i < N && j < N) cnt[j * N + i]++; });
  const townAt = (i: number, j: number) => { let n = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < N && jj < N) n += cnt[jj * N + ii]; } return smooth(4, 40, n); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = -Hu + 2 * Hu * i / (N - 1), z = -Hu + 2 * Hu * j / (N - 1);
    const out = Math.hypot(Math.max(0, mnx - x, x - mxx), Math.max(0, mnz - z, z - mxz));
    const keep = smooth(3, 22, out);                                              /* flat under the streets, real beyond */
    const fadeE = Math.min(1, Math.min(i, j, N - 1 - i, N - 1 - j) / (N * 0.08));  /* blend into the plain at the edge */
    const em = hv[k] * t.step, abs = t.base + em, y = Math.max(-0.001, em * S * TVEX * keep * fadeE) - 0.0015;  /* level with building bases in town, just under the map layers */
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    c.copy(lowC).lerp(midC, smooth(t.base + 80, t.base + 450, abs));
    const forest = t.base > 600 && abs > 1750 && abs < 2750;
    if (forest) c.lerp(forC, 0.75 * smooth(1750, 1950, abs) * (1 - smooth(2600, 2750, abs)));
    c.lerp(rockC, smooth(2650, 2950, abs)); c.lerp(snowC, smooth(3050, 3300, abs));
    c.lerp(landNear, 1 - Math.min(keep, fadeE));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    if (forest && keep > 0.9 && fadeE > 0.9) forestPts.push([x, y, z]);
    /* open farm country (where farmsteads go): outside town, on the plain and the benches below the foothills (none near the hazy edge) */
    farm[k] = (1 - townAt(i, j)) * (1 - smooth(t.base + 260, t.base + 460, abs)) * Math.min(1, fadeE * 1.6);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const q = j * N + i; idx.push(q, q + N, q + 1, q + 1, q + N, q + N + 1); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new T.MeshLambertMaterial({ vertexColors: true });
  const mesh = new T.Mesh(g, mat); mesh.receiveShadow = true;
  /* conifer forest on the mountain slopes */
  const cone = new T.ConeGeometry(0.42, 1.6, 5); cone.translate(0, 0.8, 0);
  const per = 7, forest = new T.InstancedMesh(cone, new T.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, forestPts.length * per));
  const mtx = new T.Matrix4(), q0 = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), tc = new T.Color();
  let seed = 7, n = 0; const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cell = 2 * Hu / (N - 1), FG = [0x3f4b2e, 0x4a5733, 0x56613a, 0x38432a].map(h => new T.Color(h));
  forestPts.forEach(p => {
    for (let e = 0; e < per; e++) {
      const hgt = 0.09 + rr() * 0.07; ps.set(p[0] + (rr() - 0.5) * cell, p[1] - 0.01, p[2] + (rr() - 0.5) * cell); sc.set(hgt * 1.4, hgt * 2.2, hgt * 1.4);
      mtx.compose(ps, q0, sc); forest.setMatrixAt(n, mtx); tc.copy(FG[Math.floor(rr() * 4)]); forest.setColorAt(n, tc); n++;
    }
  });
  forest.count = n; forest.instanceMatrix.needsUpdate = true; if (forest.instanceColor) forest.instanceColor.needsUpdate = true;

  /* Farmsteads: a clump of shade and windbreak trees at the corner of some fields (same section grid as the shader) */
  const heightAt = (x: number, z: number) => {
    const fi = (x + Hu) / (2 * Hu) * (N - 1), fj = (z + Hu) / (2 * Hu) * (N - 1), i = Math.max(0, Math.min(N - 2, Math.floor(fi))), j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
    const u = fi - i, v = fj - j, Y = (a: number, b: number) => pos[((j + b) * N + i + a) * 3 + 1];
    return (Y(0, 0) * (1 - u) + Y(1, 0) * u) * (1 - v) + (Y(0, 1) * (1 - u) + Y(1, 1) * u) * v;
  };
  const farmAt = (x: number, z: number) => {
    const i = Math.round((x + Hu) / (2 * Hu) * (N - 1)), j = Math.round((z + Hu) / (2 * Hu) * (N - 1));
    return i < 0 || j < 0 || i >= N || j >= N ? 0 : farm[j * N + i];
  };
  const ball = new T.IcosahedronGeometry(1, 0); ball.translate(0, 1, 0);
  const steads: [number, number][] = [];
  for (let qz = -Hu; qz < Hu; qz += QS) for (let qx = -Hu; qx < Hu; qx += QS) if (rr() < 0.05 && farmAt(qx, qz) > 0.6) steads.push([qx, qz]);
  const PER = 9, farms = new T.InstancedMesh(ball, new T.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, steads.length * PER));
  const TG = [0x4d6a2e, 0x5b7834, 0x41592a, 0x66803a].map(h => new T.Color(h));
  let m = 0;
  steads.forEach(([qx, qz]) => {
    for (let e = 0; e < PER; e++) {
      const x = qx + (e < 5 ? e * 0.09 : rr() * 0.3) + 0.06, z = qz + (e < 5 ? 0.05 : rr() * 0.3) + 0.06, r = 0.035 + rr() * 0.03;
      ps.set(x, heightAt(x, z) - 0.005, z); sc.set(r, r * 1.35, r); mtx.compose(ps, q0, sc);
      farms.setMatrixAt(m, mtx); farms.setColorAt(m, tc.copy(TG[Math.floor(rr() * 4)])); m++;
    }
  });
  farms.count = m; farms.instanceMatrix.needsUpdate = true; if (farms.instanceColor) farms.instanceColor.needsUpdate = true;
  farms.castShadow = true;
  return { mesh, forest, farms, mats: [mat, forest.material as T.MeshLambertMaterial, farms.material as T.MeshLambertMaterial] };
}
