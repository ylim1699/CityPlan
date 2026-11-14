/* Trip zones on the map: the traffic model's zones (src/model/routing.ts), shaded by the people living in each and
   outlined, lifted when hovered. A town zone is one Census block group cut by the 1.2 km grid of scripts/build_zones.py,
   so its shape is the block group's outline clipped to that square. Campus (4 model zones) is drawn as one area,
   gateways (where main roads leave the map) as small discs. view.ts asks pick() what is under the pointer. */
import * as T from 'three';
import type { BlockGroup, XZ } from '../model/types';
import type { ZonesFile, ZoneStats } from '../model/routing';

/* one violet hue, light = few people, dark = many (validated as an ordinal ramp on the dark map; see LeftControls) */
export const ZONE_PEOPLE = [
  { max: 100, color: '#e4defb', label: 'under 100' },
  { max: 300, color: '#c2b6f3', label: '100 to 300' },
  { max: 700, color: '#9d8bea', label: '300 to 700' },
  { max: 1500, color: '#7a63d9', label: '700 to 1,500' },
  { max: Infinity, color: '#5a43b8', label: '1,500 or more' }
];
export const ZONE_EMPTY = '#8f8b84';  /* nobody lives there: campus, gateways, farmland */
const GRID = 1200;  /* meters, the same grid as scripts/build_zones.py */

export type ZoneArea = { name: string; kind: 'town' | 'campus' | 'gateway'; idx: number[]; aadt?: number };

function inside(p: XZ, r: XZ[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c;
  }
  return c;
}
/* a ring clipped to an axis-aligned square (Sutherland-Hodgman, one side at a time) */
function clip(r: XZ[], x0: number, z0: number, x1: number, z1: number) {
  const sides: [(p: XZ) => boolean, (a: XZ, b: XZ) => XZ][] = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= z0, (a, b) => [a[0] + (b[0] - a[0]) * (z0 - a[1]) / (b[1] - a[1]), z0]],
    [p => p[1] <= z1, (a, b) => [a[0] + (b[0] - a[0]) * (z1 - a[1]) / (b[1] - a[1]), z1]]
  ];
  let out = r;
  for (const [ins, cut] of sides) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (ins(b)) { if (!ins(a)) out.push(cut(a, b)); out.push(b); } else if (ins(a)) out.push(cut(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}
const ringOf = (fl: number[], S: number) => { const r: XZ[] = []; for (let k = 0; k < fl.length; k += 2) r.push([fl[k] * S, fl[k + 1] * S]); return r; };

export function peopleClass(n: number) { return n < 1 ? -1 : ZONE_PEOPLE.findIndex(c => n < c.max); }

export function createZoneLayer(scene: T.Scene, S: number) {
  const group = new T.Group(); group.visible = false; scene.add(group);
  let list: { a: ZoneArea; rings: XZ[][]; fill: T.MeshBasicMaterial; line: T.LineBasicMaterial }[] = [];
  let Z: ZonesFile | null = null, stats: ZoneStats | null = null, hov = -1;
  function style(i: number) {
    const o = list[i]; if (!o) return;
    o.fill.opacity = i === hov ? 0.62 : o.a.kind === 'town' ? 0.4 : 0.3;
    o.line.color.set(i === hov ? '#ffffff' : '#ece8fb'); o.line.opacity = i === hov ? 1 : 0.4;
  }
  /* people now: residents + students for the routed year, or the base-year zone file until a run arrives */
  function people(a: ZoneArea) {
    let res = 0, stu = 0;
    a.idx.forEach(i => { res += stats ? stats.res[i] : Z!.zones[i].residents; stu += stats ? stats.stu[i] : Z!.zones[i].students; });
    return { res, stu };
  }
  function paint() {
    list.forEach(o => { const p = people(o.a), k = peopleClass(p.res + p.stu); o.fill.color.set(k < 0 ? ZONE_EMPTY : ZONE_PEOPLE[k].color); });
  }
  function clear() { group.children.forEach(m => { (m as T.Mesh).geometry.dispose(); ((m as T.Mesh).material as T.Material).dispose(); }); group.clear(); }
  function add(a: ZoneArea, rings: XZ[][]) {
    const fill = new T.MeshBasicMaterial({ color: ZONE_EMPTY, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const line = new T.LineBasicMaterial({ color: '#ece8fb', transparent: true, opacity: 0.4, depthWrite: false });
    rings.forEach(r => {
      /* shape in the x/y plane, turned flat onto the ground: (x, y) -> (x, 0, y) */
      const geo = new T.ShapeGeometry(new T.Shape(r.map(p => new T.Vector2(p[0], p[1])))); geo.rotateX(Math.PI / 2);
      const m = new T.Mesh(geo, fill); m.position.y = 0.014; m.renderOrder = 2; group.add(m);
      const l = new T.LineLoop(new T.BufferGeometry().setFromPoints(r.map(p => new T.Vector3(p[0], 0.022, p[1]))), line); l.renderOrder = 3; group.add(l);
    });
    list.push({ a, rings, fill, line });
  }
  return {
    group,
    set(zf: ZonesFile, groups: BlockGroup[], campus: number[]) {
      clear(); list = []; Z = zf; hov = -1;
      const bg: Record<string, BlockGroup> = {}; groups.forEach(g => { bg[g.id.slice(-4)] = g; });
      /* how many squares each block group is cut into, to number them in the label */
      const parts: Record<string, string[]> = {};
      zf.zones.forEach(z => { const m = /^(\d{4})-(-?\d+)-(-?\d+)$/.exec(z.id); if (m) (parts[m[1]] = parts[m[1]] || []).push(z.id); });
      zf.zones.forEach((z, i) => {
        const m = /^(\d{4})-(-?\d+)-(-?\d+)$/.exec(z.id); if (!m || !bg[m[1]]) return;
        const g = bg[m[1]], gx = +m[2], gz = +m[3];
        const rings = g.rings.map(fl => clip(ringOf(fl, 1), gx * GRID, gz * GRID, (gx + 1) * GRID, (gz + 1) * GRID))
          .filter(r => r.length >= 3).map(r => r.map(p => [p[0] * S, p[1] * S] as XZ));
        if (!rings.length) return;
        const n = parts[m[1]].length, name = g.name + (n > 1 ? ' · part ' + (parts[m[1]].indexOf(z.id) + 1) + ' of ' + n : '');
        add({ name, kind: 'town', idx: [i] }, rings);
      });
      const camp = zf.zones.map((z, i) => z.kind === 'campus' ? i : -1).filter(i => i >= 0);
      if (camp.length && campus.length) add({ name: 'BYU-Idaho campus', kind: 'campus', idx: camp }, [ringOf(campus, S)]);
      zf.zones.forEach((z, i) => {
        if (z.kind !== 'gateway') return;
        const r: XZ[] = []; for (let k = 0; k < 20; k++) { const t = k / 20 * Math.PI * 2; r.push([(z.x + Math.cos(t) * 160) * S, (z.z + Math.sin(t) * 160) * S]); }
        add({ name: 'Road into town', kind: 'gateway', idx: [i], aadt: z.aadt }, [r]);
      });
      list.forEach((_, i) => style(i)); paint();
    },
    setStats(s: ZoneStats | null) { stats = s; if (Z) paint(); },
    /* the zone under a ground point, or -1 (gateways and campus first: they sit on top of town zones) */
    pick(p: XZ) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].rings.some(r => inside(p, r))) return i;
      return -1;
    },
    /* what the tooltip shows for zone i: people, jobs, and car trips at the routed hour and per day */
    info(i: number) {
      const o = list[i]; if (!o || !Z) return null;
      const { res, stu } = people(o.a);
      let workers = 0, jobs = 0, out = 0, inn = 0;
      o.a.idx.forEach(k => { const z = Z!.zones[k]; workers += z.workers; jobs += z.jobs ? z.jobs.retail + z.jobs.edu + z.jobs.other + (z.jobs.food || 0) : 0; if (stats) { out += stats.out[k]; inn += stats.in[k]; } });
      return { a: o.a, res, stu, workers, jobs, k: peopleClass(res + stu), trips: stats ? { out, inn, share: stats.share, hour: stats.hour } : null };
    },
    hover(i: number) { if (i === hov) return; const was = hov; hov = i; style(was); style(i); },
    dispose() { clear(); scene.remove(group); }
  };
}
