/* 3D view: ported from legacy/app.js initScene() with the same drawing code.
   Reads state through getState() so the render loop always sees the latest React state. */
import * as T from 'three';
import { MapControls } from 'three/examples/jsm/controls/OrbitControls';
import type { Atlas } from '../model/atlas';
import type { SegResult, XZ } from '../model/types';
import { congOf, type State } from '../state';
import { CCOL, daylight, hourLabel, pStatus } from '../ui';
import { createSky } from './sky';
import { buildTemple, footprintAxes } from './temples';
import { buildTerrain, type TerrainFile } from './terrain';
import { buildTrees } from './trees';
import { createGhostLayer, type GhostDraw, type GhostEvent, type Highlight } from '../planner/ghostLayer';
import { createBlockLayer, density, densityClass, DENSITY } from './blockLayer';
import type { BlockGroup } from '../model/types';
import { createZoneLayer, ZONE_EMPTY, ZONE_PEOPLE } from './zoneLayer';
import type { ZonesFile, ZoneStats } from '../model/routing';

/* plain names for the road classes, for the street hover label */
const ROAD_TYPE: Record<string, string> = { highway: 'Highway', arterial: 'Major arterial', minor: 'Minor arterial', collector: 'Collector', ramp: 'Ramp', local: 'Local street' };

export type ViewEls = { canvas: HTMLCanvasElement; overlay: HTMLElement; app: HTMLElement };
export type View = { apply: (shown: SegResult[], tp: number) => void; flyTo: (pos: XZ, near?: number) => void; pick: (cb: ((pos: XZ) => void) | null) => void; dispose: () => void;
  /* Planner ghosts (src/planner) */
  setGhosts: (list: GhostDraw[], sel: string | null) => void; onGhost: (cb: ((e: GhostEvent) => void) | null) => void; target: () => XZ;
  setHighlight: (list: Highlight[]) => void;
  /* trip zones layer: people and car trips per zone from the latest routing run */
  setZoneStats: (z: ZoneStats | null) => void;
  /* the map search result: a pin with its name, or null to clear it */
  mark: (pos: XZ | null, label?: string) => void;
  /* Shopping filter: arcs from where shoppers come from to one store, n = car trips a day; null clears them */
  setFlows: (list: Flow[] | null) => void;
  /* where the camera is, so a rebuilt view (new projects) opens where the old one was */
  getCam: () => Cam; setCam: (c: Cam) => void };
export type Cam = { p: number[]; t: number[] };
export type Flow = { a: XZ; b: XZ; n: number };

export function createView(els: ViewEls, A: Atlas, getState: () => State, onSelect: (id: string) => void,
  blocks: BlockGroup[] | null = null, onBlock: (id: string | null) => void = () => {}, zones: ZonesFile | null = null): View | null {
  const canvas = els.canvas;
  let renderer: T.WebGLRenderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true }); } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const C = A.OSM, S = A.S, scene = new T.Scene();
  scene.background = new T.Color(0x14130f);  /* dark planning-console sky (from the UI sandbox); setSun() sets it per hour */
  scene.fog = new T.Fog(0x14130f, 160, 460);  /* light haze: mountains 20-45 km out still read */
  const camera = new T.PerspectiveCamera(38, 1, 0.05, 400);
  const home = A.M(C.places.campus);
  camera.position.set(home[0] + 5, 26, home[1] / 2 + 24);
  /* Map controls (Ben's spec): click-and-drag only moves you across the map. Two fingers on a trackpad do the rest:
     pinch zooms toward the pointer, swipe left/right turns a full 360, swipe up/down tilts from straight down to nearly
     flat on the ground (handled in onWheel below). Right-drag also turns and tilts, for a mouse. */
  const controls = new MapControls(camera, canvas);
  controls.enableZoom = false; controls.screenSpacePanning = false; controls.rotateSpeed = 0.55; controls.panSpeed = 1;
  controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.PAN, RIGHT: T.MOUSE.ROTATE };
  controls.target.set(home[0] * 0.5, 0, home[1] * 0.5);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.maxPolarAngle = 1.5; controls.minDistance = 0.35; controls.maxDistance = 90;  /* 1.5 rad = nearly flat; 0.35 = about 70 m away */
  controls.update();
  const hemi = new T.HemisphereLight(0xffffff, 0xb9c4bd, 0.9); scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 0.5); sun.position.set(-12, 30, 14); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;

  const sky = createSky(); scene.add(sky.mesh);  /* blue sky, sun, moon and drifting clouds (src/scene/sky.ts) */
  const sunVis = new T.Vector3(), moonVis = new T.Vector3();
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
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();  /* lit materials need normals */
    const m = new T.Mesh(g, reg(opacity < 1 ? new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, opacity, depthWrite: false })
      : new T.MeshLambertMaterial({ color, side: T.DoubleSide }), color));
    m.receiveShadow = opacity >= 1; scene.add(m); return m;
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

  /* ground and land use in the sandbox's warm, darker palette, so light labels and the warm road scale read on it */
  const ground = new T.Mesh(new T.PlaneGeometry(200, 200), reg(new T.MeshLambertMaterial({ color: 0x748e58 }), 0x748e58));  /* a living olive green, not dry tan */ ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
  polys([C.campus], 0x8a9c60, 0.001, 1);  /* campus lawns */
  polys(C.parks, 0x678f45, 0.0015, 1);  /* parks: greener than the town around them */
  polys(C.lots, 0x6f6a60, 0.002, 1);
  polys(C.water, 0x4f6f80, 0.0025, 1);
  let wl: Ln[] = []; C.waterways.forEach(w => { wl = wl.concat(polyLines(w.slice(1), Math.max(w[0], 6) * S * 1.4)); });
  scene.add(new T.Mesh(ribbons(wl, 0.003), reg(new T.MeshBasicMaterial({ color: 0x4f6f80 }), 0x4f6f80)));
  let rl: Ln[] = []; C.rail.forEach(r => { rl = rl.concat(polyLines(r, 5 * S * 1.4)); });
  scene.add(new T.Mesh(ribbons(rl, 0.0035), reg(new T.MeshBasicMaterial({ color: 0x8d8478 }), 0x8d8478)));

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

  /* Streets (from the UI sandbox): a light curb/sidewalk edge (not on highways), dark asphalt,
     and the load color as a band down the middle of the driving lanes */
  const EXW = 1.5;
  const curbGeo = ribbons(A.SEGS.filter(s => s.road.cls !== 'highway' && s.road.cls !== 'ramp').map(s => ({ a: s.a, b: s.b, w: s.road.c.w * S * EXW * 1.4 })), 0.004); curbGeo.computeVertexNormals();
  const curb = new T.Mesh(curbGeo, reg(new T.MeshLambertMaterial({ color: 0x8b867c, depthWrite: false }), 0x8b867c)); curb.renderOrder = 2; curb.receiveShadow = true; scene.add(curb);
  /* Asphalt and the load band keep a minimum width on screen (uPx = scene units per pixel at the view target, set in
     frame()), so loads stay readable zoomed out, at night and at dawn; the wider dark asphalt reads as a casing. */
  const PXU = { uPx: { value: 0.01 } };
  const MINPX: Record<string, number> = { highway: 2.6, arterial: 2.4, minor: 2.1, collector: 1.9, ramp: 1.6, local: 0.8 };
  type WLn = Ln & { px: number };
  function wideRibbons(lines: WLn[], y: number, withColor?: boolean) {
    const pos: number[] = [], side: number[] = [], wd: number[] = [], nrm: number[] = [];
    lines.forEach(ln => {
      const dx = ln.b[0] - ln.a[0], dz = ln.b[1] - ln.a[1], l = Math.hypot(dx, dz) || 1e-6, ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
      const c = (p: XZ, su: number, sn: number) => { pos.push(p[0], y, p[1]); side.push(ux * su * 0.8 + nx * sn, 0, uz * su * 0.8 + nz * sn); wd.push(ln.w / 2, ln.px); nrm.push(0, 1, 0); };
      c(ln.a, -1, 1); c(ln.b, 1, 1); c(ln.b, 1, -1); c(ln.a, -1, 1); c(ln.b, 1, -1); c(ln.a, -1, -1);
    });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('side', new T.Float32BufferAttribute(side, 3)); g.setAttribute('wd', new T.Float32BufferAttribute(wd, 2)); g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    if (withColor) g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e4);  /* widened in the shader, so never cull it */
    return g;
  }
  function widen<M extends T.Material>(m: M): M {
    m.onBeforeCompile = (sh: any) => {
      sh.uniforms.uPx = PXU.uPx;
      sh.vertexShader = 'uniform float uPx;\nattribute vec3 side;\nattribute vec2 wd;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + side * max(wd.x, wd.y * uPx);');
    };
    return m;
  }
  const segLines = (f: number, px: number) => A.SEGS.map(s => ({ a: s.a, b: s.b, w: s.road.c.w * S * EXW * f, px: (MINPX[s.road.cls] || 1.2) + px }));
  const asphalt = new T.Mesh(wideRibbons(segLines(1.05, 1.3), 0.0045), widen(reg(new T.MeshLambertMaterial({ color: 0x2a2826, depthWrite: false }), 0x2a2826)));
  asphalt.renderOrder = 3; asphalt.receiveShadow = true; asphalt.frustumCulled = false; scene.add(asphalt);
  const roadGeo = wideRibbons(segLines(0.72, 0), 0.005, true);
  const roadMat = widen(new T.MeshBasicMaterial({ vertexColors: true, depthWrite: false, fog: false }));
  const roadMesh = new T.Mesh(roadGeo, roadMat); roadMesh.renderOrder = 4; roadMesh.frustumCulled = false; scene.add(roadMesh);
  const roadCol = roadGeo.getAttribute('color') as T.BufferAttribute;

  /* Hover a street: the whole street (by name) lifts out with a white casing, a wider band and a label */
  const byName = new Map<string, number[]>();
  A.SEGS.forEach((s, i) => { const k = s.road.name || '#' + s.road.id; const l = byName.get(k); if (l) l.push(i); else byName.set(k, [i]); });
  const hover = { key: '', segs: [] as number[], seg: -1, group: new T.Group(), band: null as T.Mesh | null, x: 0, y: 0, dirty: false, inside: false };
  const hoverCase = widen(new T.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, depthTest: false, fog: false }));
  const hoverBand = widen(new T.MeshBasicMaterial({ vertexColors: true, depthWrite: false, depthTest: false, fog: false }));
  scene.add(hover.group);
  const tip = document.createElement('div'); tip.className = 'roadtip'; tip.style.display = 'none';  /* added to the overlay once it is cleared below */
  /* Census block groups (Filter > Census blocks): hover one for a summary, click it for the details panel */
  const bl = createBlockLayer(scene, S); if (blocks) bl.set(blocks);
  let blockHover = -1;
  function setBlockHover(i: number) {
    if (i === blockHover) return;
    blockHover = i; bl.hover(i); canvas.style.cursor = picker ? 'crosshair' : i >= 0 ? 'pointer' : ''; showTip();
  }
  function pickBlock() {
    hRay.setFromCamera(hNdc, camera);
    return hRay.ray.intersectPlane(hPlane, hHit) ? bl.pick([hHit.x, hHit.z]) : -1;
  }
  const fmtN = (v: number) => Math.round(v).toLocaleString('en-US');
  /* Trip zones (Filter > Trip zones): the traffic model's zones, hover one for its people, jobs and car trips */
  const zl = createZoneLayer(scene, S); if (zones && blocks) zl.set(zones, blocks, C.campus);
  let zoneHover = -1;
  function setZoneHover(i: number) {
    if (i === zoneHover) return;
    zoneHover = i; zl.hover(i); canvas.style.cursor = picker ? 'crosshair' : i >= 0 ? 'pointer' : ''; showTip();
  }
  function pickZone() {
    hRay.setFromCamera(hNdc, camera);
    return hRay.ray.intersectPlane(hPlane, hHit) ? zl.pick([hHit.x, hHit.z]) : -1;
  }
  function showZoneTip() {
    const z = zl.info(zoneHover);
    if (!z) { tip.style.display = 'none'; return; }
    tip.innerHTML = '<b></b><em></em><span><i></i></span>';
    tip.querySelector('b')!.textContent = z.a.name;
    tip.querySelector('em')!.textContent = z.a.kind === 'campus' ? 'Trip zone · 4 model zones, a destination for class trips'
      : z.a.kind === 'gateway' ? 'Trip zone · traffic from outside the map' + (z.a.aadt ? ' · ' + fmtN(z.a.aadt) + ' vehicles a day counted' : '')
      : 'Trip zone · the block group cut by a 1.2 km grid';
    (tip.querySelector('i') as HTMLElement).style.background = z.k >= 0 ? ZONE_PEOPLE[z.k].color : ZONE_EMPTY;
    tip.querySelector('span')!.append(z.a.kind === 'gateway' ? 'No residents (edge of the map)' : fmtN(z.res + z.stu) + ' people · ' + fmtN(z.res) + ' residents, ' + fmtN(z.stu) + ' students');
    const line = (t: string) => { const s = document.createElement('small'); s.style.display = 'block'; s.textContent = t; tip.appendChild(s); };
    if (z.a.kind !== 'gateway') line(fmtN(z.workers) + ' workers live here · ' + fmtN(z.jobs) + ' jobs here (LODES 2023)');
    if (z.trips) {
      line('Car trips at ' + hourLabel(z.trips.hour) + ': ' + fmtN(z.trips.out * z.trips.share) + ' leaving · ' + fmtN(z.trips.inn * z.trips.share) + ' arriving');
      line('Per day: ' + fmtN(z.trips.out) + ' leaving · ' + fmtN(z.trips.inn) + ' arriving');
    } else line('Car trips: waiting for the routed run');
    if (z.a.kind === 'town') line('People are estimated from building floor area, scaled to the city totals');
    placeTip();
  }
  function showBlockTip() {
    const b = blockHover >= 0 ? bl.get(blockHover) : null;
    if (!b) { tip.style.display = 'none'; return; }
    const d = density(b), k = densityClass(b);
    tip.innerHTML = '<b></b><span><i></i></span><small></small>';
    tip.querySelector('b')!.textContent = b.name;
    (tip.querySelector('i') as HTMLElement).style.background = k >= 0 ? DENSITY[k].color : '#9aa3ad';
    tip.querySelector('span')!.append(b.pop == null ? 'Population not published' : fmtN(b.pop) + ' people' + (d != null ? ' · ' + fmtN(d) + ' per km²' : ''));
    tip.querySelector('small')!.textContent = (b.pop2020 != null ? '2020 Census count: ' + fmtN(b.pop2020) + ' · ' : '') + 'Click for details';
    placeTip();
  }
  function setHover(seg: number) {
    const key = seg < 0 ? '' : A.SEGS[seg].road.name || '#' + A.SEGS[seg].road.id;
    hover.seg = seg;
    if (key !== hover.key) {
      hover.key = key; hover.group.children.forEach(m => (m as T.Mesh).geometry.dispose()); hover.group.clear(); hover.band = null;
      hover.segs = key ? byName.get(key)! : [];
      if (hover.segs.length) {
        const ls = (f: number, px: number) => hover.segs.map(i => { const s = A.SEGS[i]; return { a: s.a, b: s.b, w: s.road.c.w * S * EXW * f, px: (MINPX[s.road.cls] || 1.2) + px }; });
        const cs = new T.Mesh(wideRibbons(ls(1.2, 3), 0.0055), hoverCase), bd = new T.Mesh(wideRibbons(ls(0.9, 1.6), 0.006, true), hoverBand);
        cs.renderOrder = 8; bd.renderOrder = 9; cs.frustumCulled = bd.frustumCulled = false; hover.group.add(cs, bd); hover.band = bd; syncHover();
      }
    }
    showTip();
  }
  function syncHover() {  /* the lifted band shows the same (fading) load colors */
    if (!hover.band) return;
    const src = roadCol.array as Float32Array, dst = (hover.band.geometry.getAttribute('color') as T.BufferAttribute);
    const d = dst.array as Float32Array;
    hover.segs.forEach((i, k) => { const f = A.SEGS[i].road.cls === 'local' ? 1 / 0.62 : 1; for (let v = 0; v < 18; v++) d[k * 18 + v] = Math.min(1, src[i * 18 + v] * f); });
    dst.needsUpdate = true;
  }
  function placeTip() {  /* beside the pointer, flipped or nudged so it stays on screen (phones are narrow) */
    tip.style.display = 'block';
    const w = tip.offsetWidth, cw = canvas.clientWidth;
    let x = hover.x + 14; if (x + w > cw - 8) x = hover.x - 14 - w; x = Math.max(8, Math.min(cw - 8 - w, x));
    tip.style.left = x + 'px'; tip.style.top = hover.y + 'px'; tip.style.transform = 'translateY(-50%)';
  }
  function showTip() {
    if (hover.seg < 0) { if (zoneHover >= 0) showZoneTip(); else showBlockTip(); return; }
    if (!lastRes) { tip.style.display = 'none'; return; }
    const sg = A.SEGS[hover.seg], r = lastRes[hover.seg], lv = A.level(r.vc);
    let worst = 0; hover.segs.forEach(i => { worst = Math.max(worst, lastRes![i].vc); });
    const rd = sg.road, lanesAssumed = rd.laneBasis.startsWith('assumed');
    tip.innerHTML = '<b></b><em></em><span><i></i></span><small></small>';
    tip.querySelector('b')!.textContent = rd.name || 'Unnamed street';
    /* road type, speed limit and through lanes; "assumed" where OpenStreetMap has no tag */
    tip.querySelector('em')!.textContent = ROAD_TYPE[rd.cls] + ' · ' + rd.mph + ' mph' + (rd.mphTagged ? '' : ' (assumed)') + ' · '
      + rd.lanes + (rd.lanes === 1 ? ' lane' : ' lanes') + (rd.oneway ? ', one-way' : '') + (lanesAssumed ? ' (assumed)' : '');
    (tip.querySelector('i') as HTMLElement).style.background = CCOL[lv.key];
    tip.querySelector('span')!.append(Math.round(r.vc * 100) + '% of capacity here · ' + lv.label);
    tip.querySelector('small')!.textContent = hover.segs.length > 1 ? 'Busiest stretch ' + Math.round(worst * 100) + '%' : '';
    placeTip();
  }
  const hRay = new T.Raycaster(), hNdc = new T.Vector2(), hPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), hHit = new T.Vector3();
  function pickRoad() {  /* nearest street segment to the pointer on the ground, within about 7 px */
    hRay.setFromCamera(hNdc, camera);
    if (!hRay.ray.intersectPlane(hPlane, hHit)) return -1;
    const px = hHit.x, pz = hHit.z, lim = Math.max(0.02, PXU.uPx.value * tapPx);
    let best = -1, bd = lim * lim;
    A.SEGS.forEach((s, i) => {
      const ax = s.a[0], az = s.a[1], dx = s.b[0] - ax, dz = s.b[1] - az, L = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)), ex = ax + dx * t - px, ez = az + dz * t - pz, d2 = ex * ex + ez * ez;
      const hw = Math.max(s.road.c.w * S * EXW * 0.5, PXU.uPx.value * (MINPX[s.road.cls] || 1.2));
      if (d2 < bd + hw * hw) { bd = d2; best = i; }
    });
    return best;
  }
  let tapPx = 7;  /* how near the pointer must be to a street: a finger gets more room than a mouse */
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && !e.buttons) return;
    tapPx = 7;
    if (e.buttons) { if (hover.seg >= 0) setHover(-1); setBlockHover(-1); setZoneHover(-1); return; }  /* dragging the map: no hover */
    const r = canvas.getBoundingClientRect();
    hover.x = e.clientX - r.left; hover.y = e.clientY - r.top; hover.inside = true;
    hNdc.set(hover.x / r.width * 2 - 1, -(hover.y / r.height) * 2 + 1); hover.dirty = true;
  };
  const onLeave = (e: PointerEvent) => { if (e.pointerType === 'touch') return;  /* a finger lifting keeps the tapped details up */
    hover.inside = false; hover.dirty = false; setHover(-1); setBlockHover(-1); setZoneHover(-1); };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave);
  /* road colors fade to new loads instead of snapping (apply() sets the goal, frame() eases toward it) */
  const roadGoal = new Float32Array(roadCol.array.length); let roadFade = false, roadInit = false;

  /* Streetlights (from the UI sandbox): warm sodium on main roads, whiter LED on side streets, shown at night */
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
  })();
  const SODIUM = new T.Color(0xc98a4a), LED = new T.Color(0xb9b2a2), sl: number[] = [], slc: number[] = [];
  A.SEGS.forEach((s, si) => {
    const cls = s.road.cls, step = cls === 'local' ? 0.5 : 0.28, nn = Math.max(1, Math.round(s.len / step));
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1, ox = -dz / l, oz = dx / l, w = s.road.c.w * S * EXW * 0.62, col = cls === 'local' ? LED : SODIUM;
    for (let k = 0; k < nn; k++) { const f = (k + 0.5) / nn, side = (k + si) % 2 ? 1 : -1; sl.push(s.a[0] + dx * f + ox * w * side, 0.09, s.a[1] + dz * f + oz * w * side); slc.push(col.r, col.g, col.b); }
  });
  const slGeo = new T.BufferGeometry(); slGeo.setAttribute('position', new T.Float32BufferAttribute(sl, 3)); slGeo.setAttribute('color', new T.Float32BufferAttribute(slc, 3));
  const slMat = new T.PointsMaterial({ size: 0.26, map: glowTex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  const slPts = new T.Points(slGeo, slMat); slPts.renderOrder = 5; slPts.visible = false; scene.add(slPts);

  /* Traffic signals from OpenStreetMap, one per signalized intersection: a dark pole on the corner with a lamp
     that cycles green, yellow, red (each intersection on its own offset), drawn at a steady size on screen */
  const SIG = C.signals || [], sigH = 5 * A.VEX * S, sigOff = 9 * S, sigCycle = 24;
  const poleG = new T.CylinderGeometry(0.5, 0.5, 1, 5); poleG.translate(0, 0.5, 0);
  const sigPoles = new T.InstancedMesh(poleG, new T.MeshLambertMaterial({ color: 0x2b2a28 }), Math.max(1, SIG.length));
  const sigPos: number[] = [], sigM4 = new T.Matrix4(), sigQ = new T.Quaternion(), sigV = new T.Vector3(), sigSc = new T.Vector3(S * 0.9, sigH, S * 0.9);
  SIG.forEach(([x, z], k) => {
    sigV.set(x * S + sigOff, 0, z * S + sigOff); sigM4.compose(sigV, sigQ, sigSc); sigPoles.setMatrixAt(k, sigM4);
    sigPos.push(sigV.x, sigH, sigV.z);
  });
  sigPoles.count = SIG.length; sigPoles.instanceMatrix.needsUpdate = true; scene.add(sigPoles);
  /* the icon on top: a signal head (red, yellow, green lamps, the current one lit), one point set per lit lamp */
  const sigIcon = (lit: number) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
    x.fillStyle = '#161513'; x.strokeStyle = '#f2ead8'; x.lineWidth = 3;
    x.beginPath(); x.roundRect(19, 2, 26, 60, 7); x.fill(); x.stroke();
    ['#ff4436', '#ffc23a', '#3ddc6b'].forEach((col, k) => {
      x.globalAlpha = k === lit ? 1 : 0.22; x.fillStyle = col;
      x.beginPath(); x.arc(32, 13 + k * 19, 7.5, 0, Math.PI * 2); x.fill();
    });
    return new T.CanvasTexture(c);
  };
  const sigPx = renderer.getPixelRatio();  /* fixed size on screen, like a map pin */
  const sigSets = [0, 1, 2].map(lit => {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(sigPos.length), 3));
    const pts = new T.Points(g, new T.PointsMaterial({ size: 14 * sigPx, map: sigIcon(lit), transparent: true, alphaTest: 0.05, depthWrite: false, sizeAttenuation: false }));
    pts.renderOrder = 7; pts.frustumCulled = false; scene.add(pts); return pts;
  });
  let sigT = 0;
  function paintSignals() {
    const n = [0, 0, 0], arrs = sigSets.map(p => p.geometry.getAttribute('position').array as Float32Array);
    SIG.forEach((_, k) => {
      const ph = (sigT / sigCycle + k * 0.37) % 1, lit = ph < 0.45 ? 2 : ph < 0.55 ? 1 : 0, o = n[lit]++ * 3;
      arrs[lit][o] = sigPos[k * 3]; arrs[lit][o + 1] = sigPos[k * 3 + 1]; arrs[lit][o + 2] = sigPos[k * 3 + 2];
    });
    sigSets.forEach((p, lit) => { p.geometry.setDrawRange(0, n[lit]); p.geometry.getAttribute('position').needsUpdate = true; });
  }
  paintSignals();

  /* Windows drawn by the shader (from the UI sandbox): a grid of panes on every wall above 0.7 m,
     glass by day; at night a share of them lights up (uNight, uLit are set by apply()). */
  const NIGHT = { uNight: { value: 0 }, uLit: { value: 0.35 } };
  function windowMaterial() {
    const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    m.onBeforeCompile = (sh: any) => {
      sh.uniforms.uNight = NIGHT.uNight; sh.uniforms.uLit = NIGHT.uLit;
      sh.vertexShader = 'attribute vec3 wuv;\nvarying vec3 vWuv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWuv = wuv;');
      sh.fragmentShader = 'uniform float uNight;\nuniform float uLit;\nvarying vec3 vWuv;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        'if (vWuv.y > 0.7) {',
        '  float cw = vWuv.z > 1500.0 ? 2.6 : 3.4;',
        '  vec2 cell = vec2(floor(vWuv.x / cw), floor((vWuv.y - 0.7) / 3.1));',
        '  vec2 f = vec2(fract(vWuv.x / cw), fract((vWuv.y - 0.7) / 3.1));',
        '  float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.8);',
        '  float h = fract(sin(dot(vec3(cell, mod(vWuv.z, 1000.0)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
        '  float share = uLit * (vWuv.z > 1500.0 ? 1.15 : 0.85);',
        '  float lit = step(h, share) * win;',
        '  vec3 warm = mix(vec3(1.0, 0.74, 0.42), vec3(0.86, 0.93, 1.0), step(0.82, h));',
        '  totalEmissiveRadiance += warm * lit * uNight * (1.1 + 0.6 * fract(h * 7.0));',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.36, 0.42), win * 0.5);',
        '}'].join('\n'));
    };
    return m;
  }

  /* Existing buildings from OpenStreetMap: walls and roofs merged into one mesh */
  /* Buildings (from the UI sandbox): wall colors by type with a small per-building shade, flat light roofs on
     campus, commercial and industrial buildings, a few brown/terracotta/slate house roofs, darker wall bases.
     wuv = (meters along the wall, meters up, seed) for the window shader; seed > 1500 = apartments, campus, commercial. */
  const cols = (l: number[]) => l.map(h => new T.Color(h));
  const WALLS = [cols([0xe6dcc6, 0xd8c8a8, 0xece9e2, 0xb7bfa3, 0xb9c3c9, 0xcdb48e, 0xe3d49e, 0x9b5a43, 0xc9b9a6]),
    cols([0xd6c9b2, 0xc7b9a0, 0xb8afa4, 0x9c6a52, 0xe0ddd5, 0xa9b3b8, 0xcfc2ac]), cols([0x9b5a43, 0xb8865f, 0xd7cdbd, 0xa86e52]),
    cols([0xc9c6bf, 0xa8a49b, 0xd9d4c8, 0x8f9aa3, 0xb5a58a, 0x7d8890, 0xe2ded4]), cols([0xe8e2d6, 0xc9b89a, 0x9b5a43]),
    cols([0xa39d92, 0x8f8a80, 0xb3ab9c]), cols([0xa3a7ab, 0x8e959b, 0xb8b2a5, 0x9a8f80])];
  const ROOF_GREY = new T.Color(0x7b7b79), ROOF_ALT = cols([0x5a4a3e, 0x9a5b45, 0x5d6670, 0x4f4a45]), ROOF_FLAT = cols([0xcfcdc6, 0xa9a8a3, 0x8f8f8c]);
  const bp: number[] = [], bc: number[] = [], bw: number[] = [], ep: number[] = [], wallC = new T.Color(), roofC = new T.Color();
  /* Rexburg Idaho Temple: find its footprint (43.81071 N, 111.77909 W) and draw the temple model there instead of a box */
  const templeAt = A.LL(43.810709, -111.779088);
  let templeIdx = -1, templeD = 0.5;  /* within 100 m */
  C.buildings.forEach((b, bi) => {
    const pts = flatPts(b.slice(2)); let cx = 0, cz = 0; pts.forEach(q => { cx += q[0]; cz += q[1]; }); cx /= pts.length; cz /= pts.length;
    const d = Math.hypot(cx - templeAt[0], cz - templeAt[1]); if (d < templeD && pts.length >= 4) { templeD = d; templeIdx = bi; }
  });
  C.buildings.forEach((b, bi) => {
    if (bi === templeIdx) return;
    const t = b[0], hm = b[1], h = hm * A.VEX * S, pts = flatPts(b.slice(2)), n = pts.length;
    const j = ((bi * 2654435761) % 1000) / 1000, j2 = ((bi * 40503 + 12345) % 977) / 977, wl = WALLS[t] || WALLS[0];
    wallC.copy(wl[Math.floor(j2 * wl.length) % wl.length]).offsetHSL(0, 0, (j - 0.5) * 0.06);
    if (t === 3 || t === 6 || t === 2) roofC.copy(ROOF_FLAT[Math.floor(j * 3) % 3]);
    else if (j2 < 0.14) roofC.copy(ROOF_ALT[Math.floor(j * 4) % 4]);
    else roofC.copy(ROOF_GREY);
    roofC.offsetHSL(0, 0, (j - 0.5) * 0.08);
    const seed = Math.floor(j * 997) + (t === 1 || t === 2 || t === 3 ? 2000 : 0);
    const wv = (x: number, y: number, z: number, uu: number, vv: number) => { const ao = y > 0 ? 1 : 0.68; bp.push(x, y, z); bc.push(wallC.r * ao, wallC.g * ao, wallC.b * ao); bw.push(uu, vv, seed); };
    const rv = (x: number, y: number, z: number) => { bp.push(x, y, z); bc.push(roofC.r, roofC.g, roofC.b); bw.push(0, -1, seed); };
    let u = 0;
    for (let k = 0; k < n; k++) {
      const p = pts[k], q = pts[(k + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]) / S;
      ep.push(p[0], h, p[1], q[0], h, q[1]);  /* roof outline */
      const o = pts[(k + n - 1) % n], cr = (p[0] - o[0]) * (q[1] - p[1]) - (p[1] - o[1]) * (q[0] - p[0]);
      if (Math.abs(cr) > 0.26 * Math.hypot(p[0] - o[0], p[1] - o[1]) * Math.hypot(q[0] - p[0], q[1] - p[1])) ep.push(p[0], 0, p[1], p[0], h, p[1]);  /* corners only, not every vertex on a curve */
      wv(p[0], 0, p[1], u, 0); wv(q[0], 0, q[1], u + L, 0); wv(q[0], h, q[1], u + L, hm);
      wv(p[0], 0, p[1], u, 0); wv(q[0], h, q[1], u + L, hm); wv(p[0], h, p[1], u, hm);
      u += L;
    }
    let tri: number[][];
    try { tri = T.ShapeUtils.triangulateShape(pts.map(p => new T.Vector2(p[0], p[1])), []); } catch (e) { tri = []; }
    tri.forEach(tr => { tr.forEach(i => { rv(pts[i][0], h, pts[i][1]); }); });
  });
  const bGeo = new T.BufferGeometry();
  bGeo.setAttribute('position', new T.Float32BufferAttribute(bp, 3));
  bGeo.setAttribute('color', new T.Float32BufferAttribute(bc, 3));
  bGeo.setAttribute('wuv', new T.Float32BufferAttribute(bw, 3));
  bGeo.computeVertexNormals();
  const bMat = reg(windowMaterial(), 0xffffff);
  const bMesh = new T.Mesh(bGeo, bMat); bMesh.castShadow = true; bMesh.receiveShadow = true; scene.add(bMesh);
  if (templeIdx >= 0) {
    const ax = footprintAxes(flatPts(C.buildings[templeIdx].slice(2)));
    const tm = buildTemple({ center: ax.center, angle: ax.angle, L: ax.L, W: ax.W, bodyM: 21, totalM: 51, vex: A.VEX, S, wall: 0xf3f1ea, glass: 0x7f8fa6,
      spire: 'end', top: 'moroni', endSign: ax.uz > 0 ? -1 : 1 });  /* spire on the north end, toward campus */
    scene.add(tm.group); tm.mats.forEach(m => reg(m, m.color.getHex()));
  }
  /* Building outlines: faint and dark by day, light at night so the shapes still read (setSun() blends them) */
  const eGeo = new T.BufferGeometry(); eGeo.setAttribute('position', new T.Float32BufferAttribute(ep, 3));
  const eMat = new T.LineBasicMaterial({ color: 0x2a2520, transparent: true, opacity: 0.3, depthWrite: false });
  const bEdges = new T.LineSegments(eGeo, eMat); bEdges.renderOrder = 1; scene.add(bEdges);
  const EDGE_DAY = new T.Color(0x2a2520), EDGE_NIGHT = new T.Color(0xcfd8e6);

  /* Trees in town (street trees and park groves) and the terrain around it (loaded after the city is up) */
  const trees = buildTrees(A); scene.add(trees.group); trees.group.children.forEach(ch => { ch.castShadow = true; });
  trees.mats.forEach(m => reg(m, m.color.getHex()));
  let disposed = false;
  fetch(import.meta.env.BASE_URL + 'data/terrain-rexburg.json').then(r => r.ok ? r.json() : null).then((t: TerrainFile | null) => {
    if (!t || disposed) return;
    const tr = buildTerrain(A, t, new T.Color(0x748e58));
    scene.add(tr.mesh, tr.forest, tr.farms); tr.mats.forEach(m => reg(m, m.color.getHex())); setSun(lightHour);
    ground.position.y = -0.09;  /* the terrain is the ground now; the flat plane stays underneath as a fallback */
  }).catch(() => { /* no terrain file: the flat ground stays */ });

  /* Projects */
  const up = new T.BoxGeometry(1, 1, 1); up.translate(0, 0.5, 0);
  const upEdges = new T.EdgesGeometry(up);
  const projLayer = new T.Group(); scene.add(projLayer);
  type Sub = { solid: T.Mesh; edge: T.LineSegments; h: number; cur: number; goal: number };
  const P3: Record<string, { subs: Sub[]; strips: T.Mesh[] }> = {}, growing = new Set<Sub>();
  let tetonModel: T.Group | null = null;
  A.PROJECTS.forEach(p => {
    const o = { subs: [] as Sub[], strips: [] as T.Mesh[] };
    if (p.foot) {
      const fw = p.foot[0], fd = p.foot[1], n = p.n || 1, cols = Math.ceil(Math.sqrt(n * fw / fd)), rows = Math.ceil(n / cols), cw = fw / cols, cd = fd / rows;
      const pad = new T.Mesh(new T.PlaneGeometry(fw + 0.06, fd + 0.06), reg(new T.MeshBasicMaterial({ color: 0xd9d2c0, transparent: true, opacity: 0.8, depthWrite: false }), 0xd9d2c0));
      pad.rotation.x = -Math.PI / 2; pad.position.set(p.pos![0], 0.0038, p.pos![1]); projLayer.add(pad);
      for (let k = 0; k < n; k++) {
        const x = p.pos![0] - fw / 2 + (k % cols + 0.5) * cw, z = p.pos![1] - fd / 2 + (Math.floor(k / cols) + 0.5) * cd;
        const solid = new T.Mesh(up, new T.MeshLambertMaterial({ color: 0xd4861c }));
        solid.position.set(x, 0, z); solid.scale.set(cw * 0.75, 0.001, cd * 0.75); solid.visible = false;  /* frame() raises it */
        const edge = new T.LineSegments(upEdges, new T.LineBasicMaterial({ color: 0x2e6bc9 }));
        edge.position.set(x, 0, z); edge.scale.set(cw * 0.75, p.h!, cd * 0.75);
        projLayer.add(solid); projLayer.add(edge);
        o.subs.push({ solid, edge, h: p.h!, cur: 0, goal: 0 });
      }
    }
    (p.strips || []).forEach(ln => {
      const ls: Ln[] = []; for (let j = 0; j < ln.length - 1; j++) ls.push({ a: ln[j], b: ln[j + 1], w: 0.09 });
      const m = new T.Mesh(ribbons(ls, 0.0065), new T.MeshBasicMaterial({ color: 0xd4861c })); projLayer.add(m); o.strips.push(m);
    });
    if (p.id === 'temple' && p.foot && p.pos) {  /* Teton River Idaho Temple: the real shape once the spire is up (June 2026) */
      const long = p.foot[0] >= p.foot[1];
      const tm = buildTemple({ center: p.pos, angle: long ? 0 : Math.PI / 2, L: Math.max(p.foot[0], p.foot[1]) * 0.8, W: Math.min(p.foot[0], p.foot[1]) * 0.62,
        bodyM: 18, totalM: 44, vex: A.VEX, S, wall: 0xbfc3c6, glass: 0x5f6f82, spire: 'center', top: 'finial' });
      tm.group.visible = false; projLayer.add(tm.group); tm.mats.forEach(m => reg(m, m.color.getHex())); tetonModel = tm.group;
    }
    P3[p.id] = o;
  });

  /* Moving traffic: small colored cars that drive the street network. At each corner a car picks its next street
     (busier streets and going straight are likelier; never a U-turn). At a dead end, or when its trip is over, it
     shrinks away and a new car appears on a street picked by traffic volume, so busy streets and intersections fill
     up. Cars slow down as a street fills, so they bunch where the load is high. */
  const N = 1400, CAR_COLS = [0xf2f2ee, 0xc9ccd0, 0x8d939a, 0x2b2f35, 0x1f3f73, 0x8e1f24, 0x2f6f73, 0xd8cfb8, 0x5a6b3a, 0x3a5fa8];
  const carMat = new T.MeshLambertMaterial({ color: 0xffffff });
  const carMesh = new T.InstancedMesh(new T.BoxGeometry(0.075, 0.032, 0.035), carMat, N);  /* ~15 m long: larger than life so they read */
  carMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); carMesh.frustumCulled = false; scene.add(carMesh);
  type Car = { s: number; fwd: boolean; u: number; sc: number; st: 0 | 1 | 2; life: number; yaw: number; ox: number; oz: number };  /* st: 0 appearing, 1 driving, 2 leaving */
  const cars: Car[] = [], carObj = new T.Object3D(), carCol = new T.Color();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastRes: SegResult[] | null = null, seed = 11, cum: number[] = [], cumTot = 0;
  function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  /* which segment ends meet: a grid of endpoints, 6 m tolerance */
  const TOL = 0.03, ends = new Map<string, { s: number; atA: boolean }[]>();
  const ek = (x: number, z: number) => Math.round(x / TOL) + ',' + Math.round(z / TOL);
  A.SEGS.forEach((sg, i) => { for (const [p, atA] of [[sg.a, true], [sg.b, false]] as [XZ, boolean][]) { const k = ek(p[0], p[1]); (ends.get(k) || ends.set(k, []).get(k)!).push({ s: i, atA }); } });
  function meeting(p: XZ) {  /* every segment end within tolerance of p (checks the 3x3 neighbor cells) */
    const out: { s: number; atA: boolean }[] = [], cx = Math.round(p[0] / TOL), cz = Math.round(p[1] / TOL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = ends.get((cx + dx) + ',' + (cz + dz)); if (!l) continue;
      for (const e of l) { const q = e.atA ? A.SEGS[e.s].a : A.SEGS[e.s].b; if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= TOL) out.push(e); }
    }
    return out;
  }
  const volOf = (i: number) => lastRes ? Math.max(1, lastRes[i].vol) : 1;
  function spawn(c: Car | undefined, k: number, instant: boolean): Car {
    let j = 0;
    if (cumTot > 0) { const r = rnd() * cumTot; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; } j = lo; }
    else j = Math.floor(rnd() * A.SEGS.length);
    const n: Car = c || { s: 0, fwd: true, u: 0, sc: 0, st: 0, life: 0, yaw: 0, ox: 0, oz: 0 };
    n.s = j; n.fwd = rnd() < 0.5; n.u = rnd(); n.sc = instant ? 1 : 0; n.st = instant ? 1 : 0; n.life = 30 + rnd() * 70; n.yaw = NaN;
    carMesh.setColorAt(k, carCol.setHex(CAR_COLS[Math.floor(rnd() * CAR_COLS.length)]));
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    return n;
  }
  function next(c: Car): boolean {  /* move onto the next street at the corner ahead; false at a dead end */
    const sg = A.SEGS[c.s], end = c.fwd ? sg.b : sg.a, from = c.fwd ? sg.a : sg.b;
    const hx = end[0] - from[0], hz = end[1] - from[1], hl = Math.hypot(hx, hz) || 1;
    let tot = 0; const opts: { s: number; fwd: boolean; w: number }[] = [];
    for (const e of meeting(end)) {
      if (e.s === c.s) continue;
      const o = A.SEGS[e.s], far = e.atA ? o.b : o.a, nx = far[0] - end[0], nz = far[1] - end[1], cos = (nx * hx + nz * hz) / ((Math.hypot(nx, nz) || 1) * hl);
      if (cos < -0.85) continue;  /* no U-turns */
      const w = volOf(e.s) * (0.4 + Math.max(0, cos) * 1.6);
      opts.push({ s: e.s, fwd: e.atA, w }); tot += w;
    }
    if (!opts.length) return false;
    let r = rnd() * tot; for (const o of opts) { r -= o.w; if (r <= 0) { c.s = o.s; c.fwd = o.fwd; return true; } }
    const o = opts[opts.length - 1]; c.s = o.s; c.fwd = o.fwd; return true;
  }
  function allocate(res: SegResult[]) {
    lastRes = res; cum = []; cumTot = 0;
    res.forEach((r, k) => { cumTot += Math.max(0, r.vol) * A.SEGS[k].len; cum.push(cumTot); });
    if (!cars.length) { for (let k = 0; k < N; k++) cars.push(spawn(undefined, k, true)); }
    else cars.forEach(c => { c.life = Math.min(c.life, rnd() * 10); });  /* new loads: cars hand over to the new pattern within ~10 s, no jump */
    placeCars(0);
  }
  function placeCars(dt: number) {
    if (!lastRes) return;
    for (let k = 0; k < N; k++) {
      let c = cars[k];
      if (c.st === 0) { c.sc = Math.min(1, c.sc + dt * 2.5); if (c.sc >= 1) c.st = 1; }
      else if (c.st === 2) { c.sc -= dt * 2.5; if (c.sc <= 0) { c = cars[k] = spawn(c, k, false); } }
      c.life -= dt;
      const vc = lastRes[c.s].vc, sp = 1.6 * Math.max(0.12, Math.min(1, 1.2 - vc));
      if (c.st !== 2) {
        c.u += sp * dt / A.SEGS[c.s].len;
        while (c.u >= 1) {
          const left = (c.u - 1) * A.SEGS[c.s].len;  /* distance past the corner carries onto the next street */
          if (c.life <= 0 || !next(c)) { c.u = 1; c.st = 2; break; }  /* dead end or trip over: shrink away at the corner */
          c.u = left / A.SEGS[c.s].len;
        }
      }
      const sg = A.SEGS[c.s], p0 = c.fwd ? sg.a : sg.b, p1 = c.fwd ? sg.b : sg.a;
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1, off = sg.road.c.w * S * EXW * 0.22;
      /* drive on the right; ease the heading and lane offset through corners so turns don't snap */
      const yaw = Math.atan2(-dz, dx), tox = (-dz / l) * off, toz = (dx / l) * off;
      if (isNaN(c.yaw)) { c.yaw = yaw; c.ox = tox; c.oz = toz; }
      else { const kk = 1 - Math.exp(-dt * 10); let dy = yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); c.yaw += dy * kk; c.ox += (tox - c.ox) * kk; c.oz += (toz - c.oz) * kk; }
      carObj.position.set(p0[0] + dx * c.u + c.ox, 0.006 + 0.016, p0[1] + dz * c.u + c.oz);  /* on the asphalt: half the car's height above the road */
      carObj.rotation.set(0, c.yaw, 0); carObj.scale.setScalar(Math.max(0.001, c.sc));
      carObj.updateMatrix(); carMesh.setMatrixAt(k, carObj.matrix);
    }
    carMesh.instanceMatrix.needsUpdate = true;
  }

  /* Labels and pins */
  const overlay = els.overlay;
  overlay.innerHTML = ''; overlay.appendChild(tip);
  type Mark = { el: HTMLElement; v: T.Vector3; walk?: boolean; proj?: boolean; shop?: boolean; p?: any };
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
  /* Stores and restaurants (Filter > Stores and restaurants): each shop zone of the traffic model, named from OpenStreetMap */
  (zones?.zones || []).forEach(z => {
    if (!z.shop || !z.name || /walmart/i.test(z.name)) return;  /* Walmart has its own place label */
    const el = document.createElement('div'); el.className = 'place shop'; el.textContent = z.name.split(', ')[0]; el.title = z.name; overlay.appendChild(el);
    marks.push({ el, v: new T.Vector3(z.x * S, 0.15, z.z * S), shop: true });
  });
  const pins: Mark[] = [];
  A.PROJECTS.forEach(p => {
    const el = document.createElement('button'); el.className = 'pin'; el.setAttribute('aria-label', p.name);
    const sp = document.createElement('span'); sp.textContent = p.name; el.appendChild(sp); el.appendChild(document.createElement('i'));
    el.addEventListener('click', () => { onSelect(p.id); });
    overlay.appendChild(el);
    pins.push({ el, p, v: new T.Vector3(p.pos![0], (p.h || 0.02) + 0.1, p.pos![1]), proj: true });
  });
  let found: Mark | null = null;  /* the map search pin */
  /* Shopping trips: one arc per home area, raised with distance, as thick as its trips (square root, so small ones still show) */
  const flowG = new T.Group(), flowMat = new T.MeshBasicMaterial({ color: 0xe9b25f, transparent: true, opacity: 0.85, depthWrite: false });
  const dotMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  scene.add(flowG);
  function setFlows(list: Flow[] | null) {
    flowG.children.forEach(m => { (m as T.Mesh).geometry.dispose(); }); flowG.clear();
    if (!list || !list.length) return;
    const mx = Math.max(...list.map(f => f.n)) || 1;
    list.forEach(f => {
      const d = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]); if (d < 0.05) return;
      const c = new T.QuadraticBezierCurve3(new T.Vector3(f.a[0], 0.06, f.a[1]), new T.Vector3((f.a[0] + f.b[0]) / 2, 0.3 + Math.min(d, 25) * 0.12, (f.a[1] + f.b[1]) / 2), new T.Vector3(f.b[0], 0.06, f.b[1]));
      const r = 0.012 + 0.06 * Math.sqrt(f.n / mx);
      const m = new T.Mesh(new T.TubeGeometry(c, 40, r, 6, false), flowMat); m.renderOrder = 6; flowG.add(m);
      const dot = new T.Mesh(new T.SphereGeometry(r * 1.8, 10, 8), dotMat); dot.position.set(f.a[0], 0.06, f.a[1]); dot.renderOrder = 6; flowG.add(dot);
    });
    const end = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.04, 28), flowMat); end.position.set(list[0].b[0], 0.06, list[0].b[1]); end.renderOrder = 6; flowG.add(end);
  }
  const ghosts = createGhostLayer({ scene, camera, canvas, overlay, S, VEX: A.VEX });
  const vtmp = new T.Vector3(); let W = 1, H = 1;
  function place(m: Mark) {
    const st = getState();
    vtmp.copy(m.v).project(camera);
    const hide = vtmp.z > 1 || vtmp.z < -1 || (m.proj && !st.layers.proj) || (m.walk && !st.layers.walk) || (m.shop && st.layers.shops === false);
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

  /* Day and night (from the UI sandbox): the sun moves with the hour (east in the morning, west in the evening),
     the sky darkens, windows and streetlights come on, and the light glides to a new hour at the demo speed. */
  const light = { sky: new T.Color(0x14130f), duskC: new T.Color(0x2a1c10), night: new T.Color(0x0a0e16) };  /* deep night navy: dark, but not flat black */
  const dimOf = (d: number) => 0.3 + 0.7 * d;  /* flat colors at night keep about a third of their brightness */
  const sunDir = new T.Vector3(0.3, 1, 0.4).normalize();
  let lightHour = getState().hour, lastLights = -1, nightV = 0;
  function setSun(h: number) {
    const st = getState(), d = daylight(h), dusk = (h >= 16.5 && h <= 20) || (h >= 5 && h <= 8) ? Math.max(0, 1 - Math.abs(d - 0.45) * 2.2) : 0;
    /* the sun's arc over Rexburg: rises in the east (+x) at 6, peaks 55° up in the south (+z) at noon, sets in the west at 18;
       the moon runs the opposite half of the circle. Shadows come from whichever is up. */
    const a = Math.PI * (h - 6) / 12, tilt = 55 * Math.PI / 180;
    sunVis.set(Math.cos(a), Math.sin(a) * Math.sin(tilt), Math.sin(a) * Math.cos(tilt)).normalize();
    moonVis.copy(sunVis).multiplyScalar(-1); moonVis.y = Math.abs(moonVis.y) * 0.8 + 0.25; moonVis.normalize();
    if (d < 0.05) sunDir.copy(moonVis); else sunDir.set(sunVis.x, Math.max(0.08, sunVis.y), sunVis.z).normalize();
    const haze = sky.set({ sun: sunVis, moon: moonVis, day: d, dusk });
    (scene.background as T.Color).copy(haze);
    (scene.fog as T.Fog).color.copy(haze);
    /* less sky fill and a stronger sun by day, so buildings and trees cast clear shadows away from the sun */
    /* at night a cool moonlit fill keeps ground, trees and buildings readable in blue-grey instead of black */
    hemi.intensity = 0.3 + 0.34 * d; hemi.color.setHex(d < 0.3 ? 0x7f93bd : 0xfff1dc); hemi.groundColor.setHex(d < 0.3 ? 0x1e2333 : 0x5a4e3a);
    sun.intensity = 0.12 + 0.92 * d;
    eMat.color.copy(EDGE_DAY).lerp(EDGE_NIGHT, 1 - d); eMat.opacity = 0.3 + 0.22 * (1 - d); sun.color.setHex(d < 0.05 ? 0xa8bce0 : dusk > 0.2 ? 0xffc98e : 0xffe6c2);
    const dim = dimOf(d);  /* unlit (flat) materials dim by hand; lit ones follow the lights */
    tints.forEach(tn => { tn.m.color.copy(tn.c); if (tn.m instanceof T.MeshBasicMaterial) tn.m.color.multiplyScalar(dim); });
    NIGHT.uNight.value = (1 - d) * st.lights; NIGHT.uLit.value = 0.5;
    nightV = (1 - d) * st.lights;
    carMat.emissive.setRGB(1, 0.97, 0.9).multiplyScalar(0.75 * (1 - d));  /* at night cars glow with their headlights, not yellow: yellow means a busy street */
    overlay.classList.toggle('night', d < 0.5); document.body.classList.toggle('night', d < 0.4);
    grey.setHex(0x3f3a35).lerp(new T.Color(0x1c1a18), 1 - d);
    lastLights = st.lights;
  }
  let fly: any = null, raf = 0, zoomVel = 0, tiltVel = 0, turnVel = 0, zoomAt: T.Vector3 | null = null, lastSwipe = -1e9;
  const clock = new T.Clock();
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
    const stF = getState(), dh = ((stF.hour - lightHour + 36) % 24) - 12;
    if (Math.abs(dh) > 0.003) {  /* about 3 s per hour at 1x, easing in at the end */
      const sp = (0.32 + 0.2 * Math.abs(dh)) * Math.min(1, Math.abs(dh) * 1.6 + 0.2) * dt * (stF.speed || 1);
      lightHour = (lightHour + Math.sign(dh) * Math.min(Math.abs(dh), sp) + 24) % 24; setSun(lightHour);
    } else if (stF.lights !== lastLights) setSun(lightHour);
    if (Math.abs(zoomVel) > 1e-4 && !fly) {  /* zoom toward the pointer, eased */
      const step = zoomVel * 0.22; zoomVel -= step;
      const dcur = camera.position.distanceTo(controls.target), dnew = Math.max(controls.minDistance, Math.min(controls.maxDistance, dcur * Math.exp(step))), f = dnew / dcur;
      const P = zoomAt || controls.target;
      camera.position.sub(P).multiplyScalar(f).add(P); controls.target.sub(P).multiplyScalar(f).add(P); controls.target.y = 0;
    } else zoomVel = 0;
    if ((Math.abs(tiltVel) > 1e-4 || Math.abs(turnVel) > 1e-4) && !fly) {  /* tilt (straight down to eye level) and turn, eased */
      const ts = tiltVel * 0.25, rs = turnVel * 0.25; tiltVel -= ts; turnVel -= rs;
      const off = camera.position.clone().sub(controls.target), rr = off.length();
      let phi = Math.acos(Math.max(-1, Math.min(1, off.y / rr))), th = Math.atan2(off.x, off.z);
      phi = Math.max(0.001, Math.min(controls.maxPolarAngle, phi + ts)); th += rs;
      camera.position.set(controls.target.x + rr * Math.sin(phi) * Math.sin(th), rr * Math.cos(phi), controls.target.z + rr * Math.sin(phi) * Math.cos(th));
    } else { tiltVel = 0; turnVel = 0; }
    controls.update();
    /* the sun follows the view so nearby buildings and trees cast shadows */
    const dist = camera.position.distanceTo(controls.target);
    PXU.uPx.value = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, canvas.clientHeight);
    /* near plane grows as you zoom out: depth stays precise, so the flat map layers can sit just above the ground
       (a few cm apart) without flickering, and roads and buildings don't look like they float */
    const nr = Math.max(0.02, Math.min(2, dist * 0.02));
    if (Math.abs(camera.near - nr) > camera.near * 0.15) { camera.near = nr; camera.updateProjectionMatrix(); }
    if (hover.dirty && hover.inside && !picker) {
      hover.dirty = false; setHover(pickRoad());
      setZoneHover(hover.seg < 0 && stF.layers.zones ? pickZone() : -1);  /* zones sit above the Census blocks */
      setBlockHover(hover.seg < 0 && zoneHover < 0 && stF.layers.blocks ? pickBlock() : -1);  /* streets win: a block shows where no street is under the pointer */
    }
    sky.tick(reduce ? 0 : dt, camera);
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).addScaledVector(sunDir, Math.max(60, dist * 3));
    const sc2 = sun.shadow.camera as T.OrthographicCamera, hs = Math.max(6, Math.min(110, dist * 0.85));
    if (sc2.right !== hs) { sc2.left = -hs; sc2.right = hs; sc2.top = hs; sc2.bottom = -hs; sc2.near = 1; sc2.far = Math.max(200, dist * 6); sc2.updateProjectionMatrix(); }
    slPts.visible = nightV > 0.02;
    if (slPts.visible) { slMat.opacity = 0.42 * Math.min(1, nightV); slMat.size = Math.max(0.26, dist * 0.0034); }
    if (sigPoles.visible && !reduce) { sigT += dt; paintSignals(); }
    if (roadFade) {  /* ease road colors toward the newest loads */
      const arr = roadCol.array as Float32Array, k = reduce ? 1 : 1 - Math.exp(-dt * 7);
      let left = false;
      for (let i = 0; i < arr.length; i++) { const d = roadGoal[i] - arr[i]; if (Math.abs(d) > 0.002) { arr[i] += d * k; left = true; } else arr[i] = roadGoal[i]; }
      roadCol.needsUpdate = true; roadFade = left; syncHover();
    }
    if (growing.size) {  /* buildings rise or sink to their new stage of construction */
      const k = reduce ? 1 : 1 - Math.exp(-dt * 5);
      growing.forEach(g => {
        g.cur += (g.goal - g.cur) * k;
        if (Math.abs(g.goal - g.cur) < 0.002) { g.cur = g.goal; growing.delete(g); }
        g.solid.visible = g.cur > 0.002; g.solid.scale.y = Math.max(0.001, g.cur * g.h);
      });
    }
    if (!reduce && getState().layers.cars) placeCars(dt);
    renderer.render(scene, camera);
    marks.forEach(place); pins.forEach(place); if (found) place(found); ghosts.frame(W, H, dt);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  controls.addEventListener('start', () => { fly = null; });
  const wRay = new T.Raycaster(), wNdc = new T.Vector2(), wPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), wHit = new T.Vector3();
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    let dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    dy = Math.max(-400, Math.min(400, dy));
    /* Pinch arrives as ctrl + wheel: always zoom. A two-finger swipe sends pixel deltas with a sideways part or
       fractions; once a swipe is seen, the rest of that gesture (including big fast deltas) stays a swipe for 0.6 s,
       so it never flips into zooming halfway. A mouse wheel (whole steps, no sideways part) zooms. Shift forces zoom. */
    const now = performance.now();
    if (!e.ctrlKey && e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40)) lastSwipe = now;
    const swipe = !e.ctrlKey && !e.shiftKey && e.deltaMode === 0 && now - lastSwipe < 600;
    if (swipe) {
      tiltVel += Math.max(-80, Math.min(80, dy)) * 0.004;           /* up/down: tilt */
      turnVel += Math.max(-80, Math.min(80, e.deltaX)) * 0.006;     /* left/right: turn, all the way around */
      fly = null; return;
    }
    zoomVel += dy * (e.ctrlKey ? 0.012 : 0.0021);
    const r = canvas.getBoundingClientRect();
    wNdc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); wRay.setFromCamera(wNdc, camera);
    const d = camera.position.distanceTo(controls.target);
    zoomAt = wRay.ray.intersectPlane(wPlane, wHit) && wHit.distanceTo(controls.target) < d * 6 ? wHit.clone() : controls.target.clone();
    fly = null;
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  /* Phone pinch: two fingers spreading or closing zoom toward the point between them (MapControls keeps the
     two-finger turn, since its own zoom is off) */
  let pinch = 0;
  const pinchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length !== 2) { pinch = 0; return; }
    const dist = pinchDist(e.touches);
    if (pinch > 0 && dist > 0) {
      zoomVel += Math.log(pinch / dist);
      const r = canvas.getBoundingClientRect(), mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      wNdc.set((mx - r.left) / r.width * 2 - 1, -((my - r.top) / r.height) * 2 + 1); wRay.setFromCamera(wNdc, camera);
      const d = camera.position.distanceTo(controls.target);
      zoomAt = wRay.ray.intersectPlane(wPlane, wHit) && wHit.distanceTo(controls.target) < d * 6 ? wHit.clone() : controls.target.clone();
      fly = null;
    }
    pinch = dist;
  };
  const onTouchEnd = (e: TouchEvent) => { if (e.touches.length !== 2) pinch = 0; };
  canvas.addEventListener('touchstart', onTouch, { passive: true }); canvas.addEventListener('touchmove', onTouch, { passive: true });
  canvas.addEventListener('touchend', onTouchEnd); canvas.addEventListener('touchcancel', onTouchEnd);

  /* Pick mode: the next click (not a drag) on the ground reports its position */
  let picker: ((pos: XZ) => void) | null = null, down: [number, number] | null = null;
  const ray = new T.Raycaster(), ground0 = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
  const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > (e.pointerType === 'touch' ? 10 : 5)) return;
    if (e.pointerType === 'touch' && !picker) {  /* phones have no hover: a tap shows the street (or block, zone) details there */
      const r = canvas.getBoundingClientRect();
      hover.x = e.clientX - r.left; hover.y = e.clientY - r.top; hover.inside = true; tapPx = 18;
      hNdc.set(hover.x / r.width * 2 - 1, -(hover.y / r.height) * 2 + 1); hover.dirty = true;
    }
    if (!picker) {  /* a plain click with the blocks layer on opens that block group (or closes it, off the blocks) */
      if (getState().layers.blocks && e.button === 0) { const i = blockHover >= 0 ? blockHover : pickBlock(); onBlock(i >= 0 ? bl.get(i)!.id : null); }
      return;
    }
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (ray.ray.intersectPlane(ground0, hit)) { const cb = picker; picker = null; canvas.style.cursor = ''; cb([hit.x, hit.z]); }
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);

  const tmpc = new T.Color(), grey = new T.Color(0x3f3a35);  /* dark warm asphalt when traffic colors are off */
  return {
    apply(shown, tp) {
      const st = getState();
      const dim = dimOf(daylight(lightHour));  /* sky, lights and windows follow the gliding hour in setSun() */
      roadMat.color.setScalar(st.layers.traffic ? 1 : dim);
      shown.forEach((r, k) => {
        const lk = A.level(r.vc).key;
        if (st.layers.traffic && st.cong[congOf(lk)]) { tmpc.set(CCOL[lk]); if (A.SEGS[k].road.cls === 'local') tmpc.multiplyScalar(0.62); } else tmpc.copy(grey);  /* side streets quieter */
        for (let v = 0; v < 6; v++) { const o = (k * 6 + v) * 3; roadGoal[o] = tmpc.r; roadGoal[o + 1] = tmpc.g; roadGoal[o + 2] = tmpc.b; }
      });
      if (!roadInit) { (roadCol.array as Float32Array).set(roadGoal); roadCol.needsUpdate = true; roadInit = true; } else roadFade = true;
      A.WIDEN.forEach(w => { const on = st.widen.indexOf(w.id) >= 0; widMats[w.id].opacity = on ? 1 : 0.5; widMats[w.id].color.set(on ? '#5b2fa3' : '#8557c2'); });
      widLayer.visible = st.layers.proj;
      projLayer.visible = st.layers.proj; walk.visible = st.layers.walk; carMesh.visible = st.layers.cars;
      sigPoles.visible = st.layers.signals !== false && SIG.length > 0; sigSets.forEach(p => { p.visible = sigPoles.visible; });  /* older saved state has no signals key: show them */
      bl.group.visible = st.layers.blocks; bl.select(st.block); if (!st.layers.blocks) setBlockHover(-1);
      zl.group.visible = !!st.layers.zones; if (!st.layers.zones) setZoneHover(-1);
      A.PROJECTS.forEach(p => {
        const ps = pStatus(A, p, tp), o = P3[p.id], n = o.subs.length;
        o.subs.forEach((s, k) => {
          let fill = ps.key === 'done' ? 1 : Math.max(0, Math.min(1, ps.progress * n - k));
          if (ps.key === 'construction' && n === 1) fill = Math.max(0.08, ps.progress);
          if (s.goal !== fill) { s.goal = fill; growing.add(s); }
          (s.solid.material as T.MeshLambertMaterial).color.set(ps.key === 'done' || fill >= 1 && n > 1 ? '#0e8a79' : '#d4861c').multiplyScalar(0.4 + 0.6 * dim);
          s.edge.visible = ps.key !== 'done' && fill < 1;
          (s.edge.material as T.LineBasicMaterial).color.set(ps.key === 'construction' ? '#a8650f' : ps.key === 'planned' ? '#8557c2' : '#2e6bc9');
        });
        o.strips.forEach(s => { s.visible = ps.key === 'construction'; });
        if (p.id === 'temple' && tetonModel) {  /* the temple model replaces the plain box once it would be 60% built */
          const showT = ps.key === 'done' || (ps.key === 'construction' && ps.progress >= 0.6);
          tetonModel.visible = showT; o.subs.forEach(s => { (s.solid.material as T.Material).visible = !showT; });
        }
      });
      pins.forEach(pn => {
        pn.el.setAttribute('data-s', pStatus(A, pn.p, tp).key);
        pn.el.classList.toggle('sel', st.sel === pn.p.id);
      });
      allocate(shown); showTip();
    },
    setFlows,
    mark(pos, label) {
      if (found) { found.el.remove(); found = null; }
      if (!pos) return;
      const el = document.createElement('div'); el.className = 'pin found'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', label || 'Search result');
      const sp = document.createElement('span'); sp.textContent = label || ''; el.appendChild(sp); el.appendChild(document.createElement('i'));
      overlay.appendChild(el); found = { el, v: new T.Vector3(pos[0], 0.1, pos[1]) }; place(found);
    },
    flyTo(pos, near) {
      const off = camera.position.clone().sub(controls.target), len = off.length();
      fly = { k: 0, from: controls.target.clone(), to: new T.Vector3(pos[0], 0, pos[1]), dir: off.normalize(), len0: len, len1: near ?? Math.min(len, 9) };
    },
    pick(cb) { picker = cb; canvas.style.cursor = cb ? 'crosshair' : ''; },
    setGhosts(list, sel) { ghosts.set(list, sel); },
    onGhost(cb) { ghosts.onEvent(cb); },
    setHighlight(list) { ghosts.highlight(list); },
    target() { return [controls.target.x, controls.target.z]; },
    getCam() { return { p: camera.position.toArray(), t: controls.target.toArray() }; },
    setCam(c) { camera.position.fromArray(c.p); controls.target.fromArray(c.t); controls.update(); },
    setZoneStats(z) { zl.setStats(z); if (zoneHover >= 0) showTip(); },
    dispose() { disposed = true; bl.dispose(); zl.dispose(); setFlows(null); flowMat.dispose(); dotMat.dispose(); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('touchstart', onTouch); canvas.removeEventListener('touchmove', onTouch); canvas.removeEventListener('touchend', onTouchEnd); canvas.removeEventListener('touchcancel', onTouchEnd); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave); ghosts.dispose(); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); overlay.innerHTML = ''; }
  };
}
