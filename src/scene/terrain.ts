/* Terrain around Rexburg (ported from the UI sandbox's buildTerrain): real elevation from AWS Terrain Tiles,
   drawn 1.25x taller, kept flat under the streets and blended into the plain at the edges, colored by height
   (farmland, foothills, conifer forest, rock, snow), with instanced conifers on the forested slopes. */
import * as T from 'three';
import type { Atlas } from '../model/atlas';

export type TerrainFile = { N: number; H: number; step: number; base: number; h: number[] };
const TVEX = 1.25;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTerrain(A: Atlas, t: TerrainFile, landNear: T.Color) {
  const S = A.S, N = t.N, Hu = t.H * S, hv = t.h;
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  A.SEGS.forEach(s => { mnx = Math.min(mnx, s.mid[0]); mxx = Math.max(mxx, s.mid[0]); mnz = Math.min(mnz, s.mid[1]); mxz = Math.max(mxz, s.mid[1]); });
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), idx: number[] = [], c = new T.Color();
  const lowC = new T.Color(t.base < 600 ? 0x9a9a6a : 0xa39368), midC = new T.Color(0x8c8a60), forC = new T.Color(0x4f5a3a), rockC = new T.Color(0x8a8378), snowC = new T.Color(0xe8e6df);
  const forestPts: [number, number, number][] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = -Hu + 2 * Hu * i / (N - 1), z = -Hu + 2 * Hu * j / (N - 1);
    const out = Math.hypot(Math.max(0, mnx - x, x - mxx), Math.max(0, mnz - z, z - mxz));
    const keep = smooth(3, 22, out);                                              /* flat under the streets, real beyond */
    const fadeE = Math.min(1, Math.min(i, j, N - 1 - i, N - 1 - j) / (N * 0.08));  /* blend into the plain at the edge */
    const em = hv[k] * t.step, abs = t.base + em, y = Math.max(-0.01, em * S * TVEX * keep * fadeE) - 0.025;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    c.copy(lowC).lerp(midC, smooth(t.base + 80, t.base + 450, abs));
    const forest = t.base > 600 && abs > 1750 && abs < 2750;
    if (forest) c.lerp(forC, 0.75 * smooth(1750, 1950, abs) * (1 - smooth(2600, 2750, abs)));
    c.lerp(rockC, smooth(2650, 2950, abs)); c.lerp(snowC, smooth(3050, 3300, abs));
    c.lerp(landNear, 1 - Math.min(keep, fadeE));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    if (forest && keep > 0.9 && fadeE > 0.9) forestPts.push([x, y, z]);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const q = j * N + i; idx.push(q, q + N, q + 1, q + 1, q + N, q + N + 1); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
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
  return { mesh, forest, mats: [mat, forest.material as T.MeshLambertMaterial] };
}
