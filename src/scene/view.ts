/* 3D view: ported from legacy/app.js initScene() with the same drawing code.
   Reads state through getState() so the render loop always sees the latest React state. */
import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { Atlas } from '../model/atlas';
import type { SegResult, XZ } from '../model/types';
import type { State } from '../state';
import { CCOL, daylight, pStatus } from '../ui';

export type ViewEls = { canvas: HTMLCanvasElement; overlay: HTMLElement; app: HTMLElement; compass: HTMLElement };
export type View = { apply: (shown: SegResult[], tp: number) => void; flyTo: (pos: XZ) => void; pick: (cb: ((pos: XZ) => void) | null) => void; dispose: () => void };

export function createView(els: ViewEls, A: Atlas, getState: () => State, onSelect: (id: string) => void): View | null {
  const canvas = els.canvas;
  let renderer: T.WebGLRenderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true }); } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const C = A.OSM, S = A.S, scene = new T.Scene();
  scene.background = new T.Color(0xe6ebe6);
  scene.fog = new T.Fog(0xe6ebe6, 70, 150);
  const camera = new T.PerspectiveCamera(38, 1, 0.05, 400);
  const home = A.M(C.places.campus);
  camera.position.set(home[0] + 5, 26, home[1] / 2 + 24);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(home[0] * 0.5, 0, home[1] * 0.5);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.42; controls.minDistance = 1.5; controls.maxDistance = 90;
  controls.update();
  const hemi = new T.HemisphereLight(0xffffff, 0xb9c4bd, 0.9); scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 0.5); sun.position.set(-12, 30, 14); scene.add(sun);

  const tints: { m: any; c: T.Color }[] = [];
  function reg<M>(mat: M, hex: number): M { tints.push({ m: mat, c: new T.Color(hex) }); return mat; }
  function flatPts(fl: number[]): XZ[] { const o: XZ[] = []; for (let k = 0; k < fl.length; k += 2) o.push([fl[k] * S, fl[k + 1] * S]); return o; }
  /* Flat polygons merged into one mesh */
  function polys(list: number[][], color: number, y: number, opacity: number) {
    const pos: number[] = [];
    list.forEach(fl => {
      const pts = flatPts(fl); if (pts.length < 3) return;
      const v2 = pts.map(p => new T.Vector2(p[0], p[1]));
      let tri: number[][];
      try { tri = T.ShapeUtils.triangulateShape(v2, []); } catch (e) { return; }
      tri.forEach(t => { t.forEach(i => { pos.push(pts[i][0], y, pts[i][1]); }); });
    });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    const m = new T.Mesh(g, reg(new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }), color));
    scene.add(m); return m;
  }
  /* Ribbons along polylines; optional per-ribbon vertex colors */
  type Ln = { a: XZ; b: XZ; w: number };
  function ribbons(lines: Ln[], y: number, withColor?: boolean) {
    const pos: number[] = [];
    lines.forEach(ln => {
      const a = ln.a, b = ln.b, w = ln.w / 2, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1e-6;
      const ux = dx / l, uz = dz / l, nx = -uz * w, nz = ux * w;
      const ax = a[0] - ux * w * 0.8, az = a[1] - uz * w * 0.8, bx = b[0] + ux * w * 0.8, bz = b[1] + uz * w * 0.8;
      pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
    });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    if (withColor) g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
    return g;
  }
  function polyLines(fl: number[], w: number): Ln[] { const p = flatPts(fl), o: Ln[] = []; for (let k = 0; k < p.length - 1; k++) o.push({ a: p[k], b: p[k + 1], w }); return o; }

  const ground = new T.Mesh(new T.PlaneGeometry(200, 200), reg(new T.MeshBasicMaterial({ color: 0xdfe5df }), 0xdfe5df));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
  polys([C.campus], 0xe8e1cf, 0.002, 1);
  polys(C.parks, 0xc3dbbd, 0.004, 1);
  polys(C.lots, 0xcfd3cf, 0.005, 1);
  polys(C.water, 0xa9cfe0, 0.006, 1);
  let wl: Ln[] = []; C.waterways.forEach(w => { wl = wl.concat(polyLines(w.slice(1), Math.max(w[0], 6) * S * 1.4)); });
  scene.add(new T.Mesh(ribbons(wl, 0.007), reg(new T.MeshBasicMaterial({ color: 0xa9cfe0 }), 0xa9cfe0)));
  let rl: Ln[] = []; C.rail.forEach(r => { rl = rl.concat(polyLines(r, 5 * S * 1.4)); });
  scene.add(new T.Mesh(ribbons(rl, 0.008), reg(new T.MeshBasicMaterial({ color: 0x8d8478 }), 0x8d8478)));

  const walk = new T.Group(), W4 = C.walk.map(v => v * S);
  const pedPts: XZ[] = C.ped ? flatPts(C.ped) : [[W4[0], W4[1]], [W4[2], W4[1]], [W4[2], W4[3]], [W4[0], W4[3]]];
  const pedMesh = polys([C.ped || [C.walk[0], C.walk[1], C.walk[2], C.walk[1], C.walk[2], C.walk[3], C.walk[0], C.walk[3]]], 0x0d6767, 0.012, 0.07);
  scene.remove(pedMesh); walk.add(pedMesh);
  walk.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(pedPts.map(p => new T.Vector3(p[0], 0.05, p[1]))), new T.LineBasicMaterial({ color: 0x0d6767 })));
  scene.add(walk);
  /* Developer-led widenings: purple outlines, brighter when assumed built */
  const widLayer = new T.Group(), widMats: Record<string, T.LineBasicMaterial> = {};
  A.WIDEN.forEach(w => {
    const mat = new T.LineBasicMaterial({ color: 0x8557c2, transparent: true, opacity: 0.55 }); widMats[w.id] = mat;
    w.rings.forEach(r => { widLayer.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(r.map(p => new T.Vector3(p[0], 0.07, p[1]))), mat)); });
  });
  scene.add(widLayer);

  /* Streets: one mesh, colored per segment */
  const EXW = 1.5;
  const roadGeo = ribbons(A.SEGS.map(s => ({ a: s.a, b: s.b, w: s.road.c.w * S * EXW })), 0.03, true);
  const roadMat = new T.MeshBasicMaterial({ vertexColors: true });
  scene.add(new T.Mesh(roadGeo, roadMat));
  const roadCol = roadGeo.getAttribute('color') as T.BufferAttribute;

  /* Existing buildings from OpenStreetMap: walls and roofs merged into one mesh */
  const BCOL = [0xf4f5f1, 0xefe6d6, 0xe9dcc4, 0xe2e7ea, 0xf1ece4, 0xe6e8e4, 0xdde2e4].map(h => new T.Color(h));
  const bp: number[] = [], bc: number[] = [];
  C.buildings.forEach(b => {
    const t = b[0], h = b[1] * A.VEX * S, pts = flatPts(b.slice(2)), n = pts.length, col = BCOL[t] || BCOL[0];
    function push(x: number, y: number, z: number) { bp.push(x, y, z); bc.push(col.r, col.g, col.b); }
    for (let k = 0; k < n; k++) {
      const p = pts[k], q = pts[(k + 1) % n];
      push(p[0], 0, p[1]); push(q[0], 0, q[1]); push(q[0], h, q[1]);
      push(p[0], 0, p[1]); push(q[0], h, q[1]); push(p[0], h, p[1]);
    }
    let tri: number[][];
    try { tri = T.ShapeUtils.triangulateShape(pts.map(p => new T.Vector2(p[0], p[1])), []); } catch (e) { tri = []; }
    tri.forEach(tr => { tr.forEach(i => { push(pts[i][0], h, pts[i][1]); }); });
  });
  const bGeo = new T.BufferGeometry();
  bGeo.setAttribute('position', new T.Float32BufferAttribute(bp, 3));
  bGeo.setAttribute('color', new T.Float32BufferAttribute(bc, 3));
  bGeo.computeVertexNormals();
  const bMat = reg(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }), 0xffffff);
  scene.add(new T.Mesh(bGeo, bMat));

  /* Projects */
  const up = new T.BoxGeometry(1, 1, 1); up.translate(0, 0.5, 0);
  const upEdges = new T.EdgesGeometry(up);
  const projLayer = new T.Group(); scene.add(projLayer);
  const P3: Record<string, { subs: { solid: T.Mesh; edge: T.LineSegments }[]; strips: T.Mesh[] }> = {};
  A.PROJECTS.forEach(p => {
    const o = { subs: [] as { solid: T.Mesh; edge: T.LineSegments }[], strips: [] as T.Mesh[] };
    if (p.foot) {
      const fw = p.foot[0], fd = p.foot[1], n = p.n || 1, cols = Math.ceil(Math.sqrt(n * fw / fd)), rows = Math.ceil(n / cols), cw = fw / cols, cd = fd / rows;
      const pad = new T.Mesh(new T.PlaneGeometry(fw + 0.06, fd + 0.06), reg(new T.MeshBasicMaterial({ color: 0xd9d2c0, transparent: true, opacity: 0.8, depthWrite: false }), 0xd9d2c0));
      pad.rotation.x = -Math.PI / 2; pad.position.set(p.pos![0], 0.011, p.pos![1]); projLayer.add(pad);
      for (let k = 0; k < n; k++) {
        const x = p.pos![0] - fw / 2 + (k % cols + 0.5) * cw, z = p.pos![1] - fd / 2 + (Math.floor(k / cols) + 0.5) * cd;
        const solid = new T.Mesh(up, new T.MeshLambertMaterial({ color: 0xd4861c }));
        solid.position.set(x, 0, z); solid.scale.set(cw * 0.75, p.h!, cd * 0.75);
        const edge = new T.LineSegments(upEdges, new T.LineBasicMaterial({ color: 0x2e6bc9 }));
        edge.position.set(x, 0, z); edge.scale.set(cw * 0.75, p.h!, cd * 0.75);
        projLayer.add(solid); projLayer.add(edge);
        o.subs.push({ solid, edge });
      }
    }
    (p.strips || []).forEach(ln => {
      const ls: Ln[] = []; for (let j = 0; j < ln.length - 1; j++) ls.push({ a: ln[j], b: ln[j + 1], w: 0.09 });
      const m = new T.Mesh(ribbons(ls, 0.05), new T.MeshBasicMaterial({ color: 0xd4861c })); projLayer.add(m); o.strips.push(m);
    });
    P3[p.id] = o;
  });

  /* Moving traffic */
  const N = 700, carPos = new Float32Array(N * 3), cars: { s: number; u: number; dir: number }[] = [], carGeo = new T.BufferGeometry();
  carGeo.setAttribute('position', new T.BufferAttribute(carPos, 3));
  const carPts = new T.Points(carGeo, new T.PointsMaterial({ color: 0x22343a, size: 0.07, sizeAttenuation: true }));
  scene.add(carPts);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastRes: SegResult[] | null = null, seed = 11;
  function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function allocate(res: SegResult[]) {
    const cum: number[] = []; let tot = 0;
    res.forEach((r, k) => { tot += r.vol * A.SEGS[k].len; cum.push(tot); });
    let j = 0;
    for (let k = 0; k < N; k++) {
      const target = (k + 0.5) / N * tot;
      while (j < cum.length - 1 && cum[j] < target) j++;
      const keep = cars[k] && cars[k].u;
      cars[k] = { s: j, u: keep != null ? keep : rnd(), dir: k % 2 ? 1 : -1 };
    }
    lastRes = res; placeCars(0);
  }
  function placeCars(dt: number) {
    if (!lastRes) return;
    for (let k = 0; k < N; k++) {
      const c = cars[k], s = A.SEGS[c.s], vc = lastRes[c.s].vc;
      const sp = 1.6 * Math.max(0.1, Math.min(1, 1.2 - vc));
      c.u += c.dir * sp * dt / s.len;
      if (c.u > 1) c.u -= Math.floor(c.u); if (c.u < 0) c.u += Math.ceil(-c.u);
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1, off = c.dir * s.road.c.w * S * EXW * 0.22;
      carPos[k * 3] = s.a[0] + dx * c.u + (-dz / l) * off;
      carPos[k * 3 + 1] = 0.06;
      carPos[k * 3 + 2] = s.a[1] + dz * c.u + (dx / l) * off;
    }
    (carGeo.attributes.position as T.BufferAttribute).needsUpdate = true;
  }

  /* Labels and pins */
  const overlay = els.overlay;
  overlay.innerHTML = '';
  type Mark = { el: HTMLElement; v: T.Vector3; walk?: boolean; proj?: boolean; p?: any };
  const marks: Mark[] = [];
  function streetAt(name: string, near: XZ) {
    let best: XZ | null = null, bd = 1e9;
    A.SEGS.forEach(s => { if (s.road.name !== name) return; const d = Math.hypot(s.mid[0] - near[0], s.mid[1] - near[1]); if (d < bd) { bd = d; best = s.mid; } });
    return best;
  }
  const camp = A.M(C.places.campus), wal = A.M(C.places.walmart), por = A.M(C.places.porter), e333 = A.M(C.places.exit333), e332 = A.M(C.places.exit332);
  ([['BYU-Idaho', camp, 0.35], ['Downtown', [0.6, -0.5], 0.3], ['Walmart', wal, 0.25], ['Porter Park', por, 0.05], ['Exit 333', e333, 0.1], ['Exit 332', e332, 0.1],
    ['US-20', streetAt('US-20', [-12, 6]), 0.1], ['2nd East', streetAt('North 2nd East', [2, -5]), 0.1], ['Main St', streetAt('West Main Street', [-6, 0]), 0.1],
    ['University Blvd', streetAt('University Boulevard', [-7, 11]), 0.1], ['Walk district', [W4[2] - 0.6, W4[3] + 0.25], 0.05]] as [string, XZ | null, number][])
    .forEach(l => {
      if (!l[1]) return;
      const el = document.createElement('div'); el.className = 'place'; el.textContent = l[0]; overlay.appendChild(el);
      marks.push({ el, v: new T.Vector3(l[1][0], l[2], l[1][1]), walk: /^Walk/.test(l[0]) });
    });
  if (C.places.river) { const rv = document.createElement('div'); rv.className = 'place water'; rv.textContent = 'Teton River'; overlay.appendChild(rv); marks.push({ el: rv, v: new T.Vector3(C.places.river[0] * S, 0.1, C.places.river[1] * S) }); }
  const pins: Mark[] = [];
  A.PROJECTS.forEach(p => {
    const el = document.createElement('button'); el.className = 'pin'; el.setAttribute('aria-label', p.name);
    const sp = document.createElement('span'); sp.textContent = p.name; el.appendChild(sp); el.appendChild(document.createElement('i'));
    el.addEventListener('click', () => { onSelect(p.id); });
    overlay.appendChild(el);
    pins.push({ el, p, v: new T.Vector3(p.pos![0], (p.h || 0.02) + 0.1, p.pos![1]), proj: true });
  });
  const vtmp = new T.Vector3(); let W = 1, H = 1;
  function place(m: Mark) {
    const st = getState();
    vtmp.copy(m.v).project(camera);
    const hide = vtmp.z > 1 || vtmp.z < -1 || (m.proj && !st.layers.proj) || (m.walk && !st.layers.walk);
    m.el.style.display = hide ? 'none' : '';
    if (hide) return;
    m.el.style.left = ((vtmp.x * 0.5 + 0.5) * W).toFixed(1) + 'px';
    m.el.style.top = ((-vtmp.y * 0.5 + 0.5) * H).toFixed(1) + 'px';
  }
  function resize() {
    const r = els.app.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(els.app);
  resize();

  let fly: any = null, raf = 0;
  const clock = new T.Clock(), compass = els.compass.firstElementChild as HTMLElement;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (fly) {
      fly.k = Math.min(1, fly.k + dt / 0.7);
      const e = 1 - Math.pow(1 - fly.k, 3);
      const tx = fly.from.x + (fly.to.x - fly.from.x) * e, tz = fly.from.z + (fly.to.z - fly.from.z) * e;
      const len = fly.len0 + (fly.len1 - fly.len0) * e;
      controls.target.set(tx, 0, tz);
      camera.position.set(tx + fly.dir.x * len, fly.dir.y * len, tz + fly.dir.z * len);
      if (fly.k >= 1) fly = null;
    }
    controls.update();
    if (!reduce && getState().layers.cars) placeCars(dt);
    renderer.render(scene, camera);
    marks.forEach(place); pins.forEach(place);
    compass.style.transform = 'rotate(' + controls.getAzimuthalAngle() + 'rad)';
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  controls.addEventListener('start', () => { fly = null; });

  /* Pick mode: the next click (not a drag) on the ground reports its position */
  let picker: ((pos: XZ) => void) | null = null, down: [number, number] | null = null;
  const ray = new T.Raycaster(), ground0 = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
  const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (!picker || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (ray.ray.intersectPlane(ground0, hit)) { const cb = picker; picker = null; canvas.style.cursor = ''; cb([hit.x, hit.z]); }
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);

  const tmpc = new T.Color(), grey = new T.Color(0xb9c2bd);
  return {
    apply(shown, tp) {
      const st = getState();
      const d = daylight(st.hour), dim = 0.24 + 0.76 * d, night = new T.Color(0x16202a), dusk = (st.hour >= 17 && st.hour <= 19) || (st.hour >= 5 && st.hour <= 7) ? 1 - Math.abs(d - 0.5) * 2 : 0;
      (scene.background as T.Color).setHex(0xe6ebe6).lerp(new T.Color(0xf0d9c2), dusk * 0.6).lerp(night, 1 - d);
      (scene.fog as T.Fog).color.copy(scene.background as T.Color);
      hemi.intensity = 0.2 + 0.7 * d; sun.intensity = 0.04 + 0.46 * d;
      tints.forEach(t => { t.m.color.copy(t.c).multiplyScalar(dim); });
      (carPts.material as T.PointsMaterial).color.set(d < 0.5 ? '#ffe7a0' : '#22343a');
      overlay.classList.toggle('night', d < 0.5);
      roadMat.color.setScalar(st.layers.traffic ? 1 : dim);
      const arr = roadCol.array as Float32Array;
      shown.forEach((r, k) => {
        if (st.layers.traffic) tmpc.set(CCOL[A.level(r.vc).key]); else tmpc.copy(grey);
        for (let v = 0; v < 6; v++) { const o = (k * 6 + v) * 3; arr[o] = tmpc.r; arr[o + 1] = tmpc.g; arr[o + 2] = tmpc.b; }
      });
      roadCol.needsUpdate = true;
      A.WIDEN.forEach(w => { const on = st.widen.indexOf(w.id) >= 0; widMats[w.id].opacity = on ? 1 : 0.5; widMats[w.id].color.set(on ? '#5b2fa3' : '#8557c2'); });
      widLayer.visible = st.layers.proj;
      projLayer.visible = st.layers.proj; walk.visible = st.layers.walk; carPts.visible = st.layers.cars;
      A.PROJECTS.forEach(p => {
        const ps = pStatus(A, p, tp), o = P3[p.id], n = o.subs.length;
        o.subs.forEach((s, k) => {
          let fill = ps.key === 'done' ? 1 : Math.max(0, Math.min(1, ps.progress * n - k));
          if (ps.key === 'construction' && n === 1) fill = Math.max(0.08, ps.progress);
          s.solid.visible = fill > 0;
          s.solid.scale.y = Math.max(0.001, fill * p.h!);
          (s.solid.material as T.MeshLambertMaterial).color.set(ps.key === 'done' || fill >= 1 && n > 1 ? '#0e8a79' : '#d4861c').multiplyScalar(0.4 + 0.6 * dim);
          s.edge.visible = ps.key !== 'done' && fill < 1;
          (s.edge.material as T.LineBasicMaterial).color.set(ps.key === 'construction' ? '#a8650f' : ps.key === 'planned' ? '#8557c2' : '#2e6bc9');
        });
        o.strips.forEach(s => { s.visible = ps.key === 'construction'; });
      });
      pins.forEach(pn => {
        pn.el.setAttribute('data-s', pStatus(A, pn.p, tp).key);
        pn.el.classList.toggle('sel', st.sel === pn.p.id);
      });
      allocate(shown);
    },
    flyTo(pos) {
      const off = camera.position.clone().sub(controls.target), len = off.length();
      fly = { k: 0, from: controls.target.clone(), to: new T.Vector3(pos[0], 0, pos[1]), dir: off.normalize(), len0: len, len1: Math.min(len, 9) };
    },
    pick(cb) { picker = cb; canvas.style.cursor = cb ? 'crosshair' : ''; },
    dispose() { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); overlay.innerHTML = ''; }
  };
}
