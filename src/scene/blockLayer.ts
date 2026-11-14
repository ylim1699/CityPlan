/* Census block groups on the map: each one shaded by people per km² (ACS estimate), outlined, and lifted when hovered
   or selected. view.ts asks pick() which group is under the pointer and shows the tooltip; the panel shows the details. */
import * as T from 'three';
import type { BlockGroup, XZ } from '../model/types';

/* one blue hue, light = few people, dark = many, spread wide (near white to navy) so the steps read on the tan ground;
   lightness monotone with even gaps (dataviz validator) */
export const DENSITY = [
  { max: 100, color: '#cde2fb', label: 'under 100' },
  { max: 1000, color: '#86b6ef', label: '100 to 1,000' },
  { max: 3000, color: '#3987e5', label: '1,000 to 3,000' },
  { max: 8000, color: '#1c5cab', label: '3,000 to 8,000' },
  { max: Infinity, color: '#0d366b', label: '8,000 or more' }
];
export function density(b: BlockGroup) { return b.pop == null || !b.landKm2 ? null : b.pop / b.landKm2; }
export function densityClass(b: BlockGroup) { const d = density(b); return d == null ? -1 : DENSITY.findIndex(c => d < c.max); }

function inside(p: XZ, r: XZ[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c;
  }
  return c;
}

export function createBlockLayer(scene: T.Scene, S: number) {
  const group = new T.Group(); group.visible = false; scene.add(group);
  let list: { b: BlockGroup; rings: XZ[][]; fill: T.MeshBasicMaterial; line: T.LineBasicMaterial }[] = [];
  let hov = -1, sel = -1;
  function style(i: number) {
    const o = list[i]; if (!o) return;
    const on = i === hov || i === sel;
    o.fill.opacity = i === sel ? 0.9 : on ? 0.86 : 0.76;
    o.line.color.set(on ? '#ffffff' : '#e8eef7'); o.line.opacity = on ? 1 : 0.45;
  }
  return {
    group,
    set(groups: BlockGroup[]) {
      group.children.forEach(m => { (m as T.Mesh).geometry.dispose(); ((m as T.Mesh).material as T.Material).dispose(); }); group.clear();
      list = groups.map(b => {
        const rings = b.rings.map(fl => { const r: XZ[] = []; for (let k = 0; k < fl.length; k += 2) r.push([fl[k] * S, fl[k + 1] * S]); return r; });
        const k = densityClass(b);
        const fill = new T.MeshBasicMaterial({ color: k < 0 ? '#9aa3ad' : DENSITY[k].color, transparent: true, opacity: 0.76, depthWrite: false, side: T.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        const line = new T.LineBasicMaterial({ color: '#e8eef7', transparent: true, opacity: 0.45, depthWrite: false });
        rings.forEach(r => {
          /* shape in the x/y plane, turned flat onto the ground: (x, y) -> (x, 0, y) */
          const geo = new T.ShapeGeometry(new T.Shape(r.map(p => new T.Vector2(p[0], p[1])))); geo.rotateX(Math.PI / 2);
          const m = new T.Mesh(geo, fill); m.position.y = 0.012; m.renderOrder = 2; group.add(m);
          const lg = new T.BufferGeometry().setFromPoints(r.map(p => new T.Vector3(p[0], 0.02, p[1])));
          const l = new T.LineLoop(lg, line); l.renderOrder = 3; group.add(l);
        });
        return { b, rings, fill, line };
      });
      hov = sel = -1;
    },
    /* the block group under a ground point, or -1 */
    pick(p: XZ) { return list.findIndex(o => o.rings.some(r => inside(p, r))); },
    get(i: number) { return list[i]?.b ?? null; },
    hover(i: number) { if (i === hov) return; const was = hov; hov = i; style(was); style(i); },
    select(id: string | null) { const was = sel; sel = id ? list.findIndex(o => o.b.id === id) : -1; style(was); style(sel); },
    dispose() { group.children.forEach(m => { (m as T.Mesh).geometry.dispose(); ((m as T.Mesh).material as T.Material).dispose(); }); scene.remove(group); }
  };
}
