/* 3D layer for planner ghosts: translucent amber blocks with a label.
   Double-click a ghost to pick it up; the next click on the ground drops it there. */
import * as T from 'three';
import type { XZ } from '../model/types';

export type GhostDraw = { id: string; pos: XZ; w: number; d: number; h: number; n: number; label: string; status: 'planned' | 'suggested'; active: boolean;
  roads?: { pts: XZ[]; status: 'planned' | 'suggested'; label: string }[] };
/* streets a project loads up: glowing ribbons with one "+N pts" label per street */
export type Highlight = { segs: [XZ, XZ][]; label: string; at: XZ; color: string };
export type GhostEvent = { type: 'move'; id: string; pos: XZ } | { type: 'select'; id: string };

export function createGhostLayer(o: { scene: T.Scene; camera: T.Camera; canvas: HTMLCanvasElement; overlay: HTMLElement; S: number; VEX: number }) {
  const { scene, camera, canvas, overlay, S, VEX } = o;
  const group = new T.Group(); scene.add(group);
  const hlGroup = new T.Group(); scene.add(hlGroup);
  let hlMats: T.MeshBasicMaterial[] = [], hlEls: { el: HTMLElement; v: T.Vector3 }[] = [];
  function clearHl() { hlEls.forEach(h => h.el.remove()); hlEls = []; hlGroup.children.forEach(ch => (ch as T.Mesh).geometry?.dispose()); hlMats.forEach(m => m.dispose()); hlMats = []; hlGroup.clear(); }
  type Item = { g: T.Group; mats: (T.MeshBasicMaterial | T.LineBasicMaterial | T.LineDashedMaterial)[]; el: HTMLElement; v: T.Vector3; d: GhostDraw; roadMats: T.MeshBasicMaterial[]; roadEls: { el: HTMLElement; v: T.Vector3 }[] };
  let items: Item[] = [], sel: string | null = null, carrying: string | null = null, cb: ((e: GhostEvent) => void) | null = null, t0 = 0;

  function clear() {
    items.forEach(it => {
      it.el.remove(); it.roadEls.forEach(r => r.el.remove());
      it.g.traverse(ch => { const m = ch as T.Mesh; if (m.geometry) m.geometry.dispose(); });
      it.mats.forEach(m => m.dispose()); it.roadMats.forEach(m => m.dispose());
    });
    group.clear(); items = [];
  }
  function build(d: GhostDraw) {
    const g = new T.Group(); g.position.set(d.pos[0], 0, d.pos[1]); g.userData = { id: d.id };
    const sug = d.status === 'suggested', future = !d.active && !sug, on = sel === d.id;
    const col = sug ? 0xffcf7a : 0xf0a03a, mats: Item['mats'] = [];
    /* footprint split into n blocks, like a small complex */
    const w = d.w * S, dd = d.d * S, h = d.h * S * VEX, cols = Math.ceil(Math.sqrt(d.n * d.w / d.d)), rows = Math.ceil(d.n / cols);
    const cw = w / cols, cd = dd / rows;
    const fill = new T.MeshBasicMaterial({ color: col, transparent: true, opacity: future ? 0.12 : sug ? 0.32 : 0.5, depthWrite: false });
    const edge = future || sug
      ? new T.LineDashedMaterial({ color: on ? 0xffffff : 0xffd38f, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.95 })
      : new T.LineBasicMaterial({ color: on ? 0xffffff : 0xb86a12, transparent: true, opacity: 0.95 });
    mats.push(fill, edge);
    const box = new T.BoxGeometry(1, 1, 1);
    for (let k = 0; k < d.n; k++) {
      const cx = -w / 2 + cw * (k % cols + 0.5), cz = -dd / 2 + cd * (Math.floor(k / cols) + 0.5);
      const m = new T.Mesh(box, fill); m.position.set(cx, h / 2, cz); m.scale.set(cw * 0.78, h, cd * 0.78); m.userData = { id: d.id }; g.add(m);
      const e = new T.LineSegments(new T.EdgesGeometry(box), edge); e.position.copy(m.position); e.scale.copy(m.scale);
      if (edge instanceof T.LineDashedMaterial) e.computeLineDistances();
      g.add(e);
    }
    /* site outline on the ground */
    const pad = new T.Mesh(new T.PlaneGeometry(w + 0.04, dd + 0.04), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: on ? 0.35 : 0.18, depthWrite: false }));
    mats.push(pad.material as T.MeshBasicMaterial);
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03; pad.userData = { id: d.id }; g.add(pad);
    /* access roads: a glowing ribbon (~16 m wide) in world space, dashed while only suggested */
    const roadMats: T.MeshBasicMaterial[] = [], roadEls: Item['roadEls'] = [];
    (d.roads || []).forEach(r => {
      const sug = r.status === 'suggested', pos: number[] = [], w = 16 * S / 2;
      for (let k = 0; k < r.pts.length - 1; k++) {
        const a = r.pts[k], b = r.pts[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-6, ux = dx / L, uz = dz / L, nx = -uz * w, nz = ux * w;
        const dash = sug ? 30 * S : L, gap = sug ? 20 * S : 0;
        for (let s0 = 0; s0 < L; s0 += dash + gap) {
          const s1 = Math.min(L, s0 + dash), ax = a[0] + ux * s0, az = a[1] + uz * s0, bx = a[0] + ux * s1, bz = a[1] + uz * s1;
          pos.push(ax + nx - d.pos[0], 0.06, az + nz - d.pos[1], bx + nx - d.pos[0], 0.06, bz + nz - d.pos[1], bx - nx - d.pos[0], 0.06, bz - nz - d.pos[1],
            ax + nx - d.pos[0], 0.06, az + nz - d.pos[1], bx - nx - d.pos[0], 0.06, bz - nz - d.pos[1], ax - nx - d.pos[0], 0.06, az - nz - d.pos[1]);
        }
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      const m = new T.MeshBasicMaterial({ color: sug ? 0xffc04d : 0xf08c1a, transparent: true, opacity: sug ? 0.85 : 0.95, depthWrite: false, side: T.DoubleSide });
      roadMats.push(m); g.add(new T.Mesh(geo, m));
      if (r.label) {
        const mid = r.pts[Math.floor(r.pts.length / 2)], prev = r.pts[Math.max(0, Math.floor(r.pts.length / 2) - 1)];
        const re = document.createElement('div'); re.className = 'planlabel ghost road'; re.textContent = r.label; overlay.appendChild(re);
        roadEls.push({ el: re, v: new T.Vector3((mid[0] + prev[0]) / 2, 0.2, (mid[1] + prev[1]) / 2) });
      }
    });
    group.add(g);
    const el = document.createElement('div'); el.className = 'planlabel' + (sug ? ' ghost' : '') + (future ? ' future' : '') + (on ? ' sel' : '');
    el.textContent = d.label; overlay.appendChild(el);
    items.push({ g, mats, el, v: new T.Vector3(d.pos[0], h + 0.15, d.pos[1]), d, roadMats, roadEls });
  }

  const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), ndc = new T.Vector2();
  function aim(e: MouseEvent) { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  const onDbl = (e: MouseEvent) => {
    aim(e);
    const h = ray.intersectObjects(group.children, true)[0];
    const id = h && (h.object.userData.id || h.object.parent?.userData.id);
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    carrying = id; canvas.style.cursor = 'crosshair';
    cb?.({ type: 'select', id });
  };
  let down: [number, number] | null = null;
  const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (!carrying || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    if (e.detail > 1) return;  /* the second click of the double-click that picked it up */
    aim(e);
    if (ray.ray.intersectPlane(ground, hit)) { const id = carrying; carrying = null; canvas.style.cursor = ''; cb?.({ type: 'move', id, pos: [hit.x, hit.z] }); }
  };
  canvas.addEventListener('dblclick', onDbl); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);

  const vt = new T.Vector3();
  return {
    set(list: GhostDraw[], selId: string | null) { sel = selId; clear(); list.forEach(build); },
    onEvent(f: ((e: GhostEvent) => void) | null) { cb = f; },
    highlight(list: Highlight[]) {
      clearHl();
      list.forEach(h => {
        const pos: number[] = [], w = 26 * S / 2;
        h.segs.forEach(([a, b]) => {
          const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-6, nx = -dz / L * w, nz = dx / L * w, y = 0.07;
          pos.push(a[0] + nx, y, a[1] + nz, b[0] + nx, y, b[1] + nz, b[0] - nx, y, b[1] - nz, a[0] + nx, y, a[1] + nz, b[0] - nx, y, b[1] - nz, a[0] - nx, y, a[1] - nz);
        });
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        const m = new T.MeshBasicMaterial({ color: h.color, transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide });  /* solid, not additive: additive washes out on the warm road colors */
        hlMats.push(m); hlGroup.add(new T.Mesh(geo, m));
        const el = document.createElement('div'); el.className = 'planlabel hl'; el.textContent = h.label; overlay.appendChild(el);
        hlEls.push({ el, v: new T.Vector3(h.at[0], 0.25, h.at[1]) });
      });
    },
    /* call once per frame after rendering, with the canvas size in CSS pixels */
    frame(W: number, H: number, dt: number) {
      t0 += dt;
      const pulse = 0.5 + 0.5 * Math.sin(t0 * 3);
      hlMats.forEach(m => { m.opacity = 0.6 + 0.35 * pulse; });
      hlEls.forEach(h => { vt.copy(h.v).project(camera); const hd = vt.z > 1 || vt.z < -1; h.el.style.display = hd ? 'none' : '';
        if (!hd) { h.el.style.left = ((vt.x * 0.5 + 0.5) * W).toFixed(1) + 'px'; h.el.style.top = ((-vt.y * 0.5 + 0.5) * H).toFixed(1) + 'px'; } });
      items.forEach(it => {
        if (it.d.status === 'suggested') (it.mats[0] as T.MeshBasicMaterial).opacity = 0.2 + 0.25 * pulse;
        if (carrying === it.d.id) (it.mats[0] as T.MeshBasicMaterial).opacity = 0.25 + 0.4 * pulse;
        vt.copy(it.v).project(camera);
        const hide = vt.z > 1 || vt.z < -1;
        it.el.style.display = hide ? 'none' : '';
        if (!hide) { it.el.style.left = ((vt.x * 0.5 + 0.5) * W).toFixed(1) + 'px'; it.el.style.top = ((-vt.y * 0.5 + 0.5) * H).toFixed(1) + 'px'; }
        it.roadMats.forEach((m, k) => { if ((it.d.roads || [])[k]?.status === 'suggested') m.opacity = 0.45 + 0.45 * pulse; });
        it.roadEls.forEach(r => { vt.copy(r.v).project(camera); const hd = vt.z > 1 || vt.z < -1; r.el.style.display = hd ? 'none' : '';
          if (!hd) { r.el.style.left = ((vt.x * 0.5 + 0.5) * W).toFixed(1) + 'px'; r.el.style.top = ((-vt.y * 0.5 + 0.5) * H).toFixed(1) + 'px'; } });
        if (carrying === it.d.id) it.el.textContent = 'Click where it should go';
        else if (it.el.textContent !== it.d.label) it.el.textContent = it.d.label;
      });
    },
    dispose() { clear(); clearHl(); scene.remove(group); scene.remove(hlGroup); canvas.removeEventListener('dblclick', onDbl); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); }
  };
}
