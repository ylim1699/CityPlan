import * as T from 'three';
import type { XZ } from '../model/types';

/* Simple models of Rexburg's two temples, so they read as themselves instead of plain boxes.
   Rexburg Idaho Temple (2008): white quartz-finish precast walls, a long rectangular body about 68 ft (21 m) tall,
   one spire attached at the front end, 168 ft (51 m) to the top of a gold angel Moroni statue.
   Teton River Idaho Temple (under construction): three stories, cool gray granite panels, tall arched windows,
   one central spire topped with a metal finial.
   Sources: churchofjesuschristtemples.org, Church News, Wikipedia. Proportions are approximate. */
export type TempleSpec = {
  center: XZ; angle: number; L: number; W: number;  /* scene units; angle turns the long axis from +x */
  bodyM: number; totalM: number; vex: number; S: number;  /* heights in meters, vertical exaggeration, meters to units */
  wall: number; glass: number; spire: 'end' | 'center'; top: 'moroni' | 'finial'; endSign?: number;
};

export function buildTemple(o: TempleSpec): { group: T.Group; mats: T.MeshLambertMaterial[] } {
  const g = new T.Group(), hU = (m: number) => m * o.vex * o.S;
  const wallM = new T.MeshLambertMaterial({ color: o.wall }), glassM = new T.MeshLambertMaterial({ color: o.glass });
  const goldM = new T.MeshLambertMaterial({ color: 0xd9b048, emissive: 0x3a2a08 }), mats = [wallM, glassM, goldM];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: T.Material) => {
    const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b;
  };
  const H = hU(o.bodyM), L = o.L, W = o.W;
  /* body: a full-footprint base and a slightly inset upper tier */
  box(L, H * 0.72, W, 0, 0, 0, wallM);
  box(L * 0.9, H * 0.28, W * 0.84, 0, H * 0.72, 0, wallM);
  /* tall windows along both long sides (art glass), arched windows read as tall narrow panels at this scale */
  const nWin = Math.max(4, Math.round(L / (7 * o.S))), ww = L / nWin * 0.32, wh = H * 0.5;
  for (let k = 0; k < nWin; k++) {
    const x = -L / 2 + (k + 0.5) * L / nWin;
    if (o.spire === 'end' && Math.abs(x - (o.endSign ?? 1) * L * 0.38) < L * 0.14) continue;  /* not behind the tower */
    for (const side of [-1, 1]) box(ww, wh, 0.004, x, H * 0.12, side * (W / 2 + 0.002), glassM);
  }
  /* tower: square base rising above the roof, an octagonal stage, then the spire */
  const tx = o.spire === 'end' ? (o.endSign ?? 1) * (L / 2 - W * 0.22) : 0, tw = W * (o.spire === 'end' ? 0.42 : 0.34);
  const baseTop = H * (o.spire === 'end' ? 1.22 : 1.3);
  box(tw, baseTop, tw, tx, 0, 0, wallM);
  const octH = H * 0.32, oct = new T.Mesh(new T.CylinderGeometry(tw * 0.4, tw * 0.46, octH, 8), wallM);
  oct.position.set(tx, baseTop + octH / 2, 0); oct.castShadow = true; g.add(oct);
  const topH = hU(o.top === 'moroni' ? 4 : 2.5), spireH = Math.max(H * 0.5, hU(o.totalM) - baseTop - octH - topH);
  const sp = new T.Mesh(new T.ConeGeometry(tw * 0.36, spireH, 8), o.top === 'finial' ? new T.MeshLambertMaterial({ color: 0xc9c1a8 }) : wallM);
  sp.position.set(tx, baseTop + octH + spireH / 2, 0); sp.castShadow = true; g.add(sp);
  const y0 = baseTop + octH + spireH;
  if (o.top === 'moroni') {  /* gold angel Moroni: a slim figure on a small ball */
    const ball = new T.Mesh(new T.SphereGeometry(tw * 0.07, 10, 8), goldM); ball.position.set(tx, y0 + tw * 0.05, 0); g.add(ball);
    const fig = new T.Mesh(new T.CylinderGeometry(tw * 0.03, tw * 0.06, topH, 8), goldM); fig.position.set(tx, y0 + tw * 0.1 + topH / 2, 0); g.add(fig);
  } else {  /* metal finial */
    const ball = new T.Mesh(new T.SphereGeometry(tw * 0.08, 10, 8), goldM); ball.position.set(tx, y0, 0); g.add(ball);
    const rod = new T.Mesh(new T.CylinderGeometry(tw * 0.015, tw * 0.03, topH, 6), goldM); rod.position.set(tx, y0 + topH / 2, 0); g.add(rod);
  }
  g.position.set(o.center[0], 0, o.center[1]); g.rotation.y = -o.angle;
  return { group: g, mats };
}

/* long axis, length and width of a footprint (principal axis of its corners) */
export function footprintAxes(pts: XZ[]) {
  let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= pts.length; cz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0; pts.forEach(p => { const x = p[0] - cx, z = p[1] - cz; sxx += x * x; szz += z * z; sxz += x * z; });
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(angle), uz = Math.sin(angle);
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  pts.forEach(p => { const x = p[0] - cx, z = p[1] - cz, a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); });
  return { center: [cx + ux * (a0 + a1) / 2 - uz * (b0 + b1) / 2, cz + uz * (a0 + a1) / 2 + ux * (b0 + b1) / 2] as XZ, angle, L: a1 - a0, W: b1 - b0, ux, uz };
}
