/* Data files: named copies of the city's default Census numbers that a person can edit (block groups),
   kept in this browser. A file stores only what differs from the default, so "Reset to default" is dropping the edits.
   Edits reach the traffic model, not just the panels:
   a block group's people scale the residents of the traffic zones inside it, its college students scale their students,
   and its drive-to-work share replaces the zones' commute share. (Shopping numbers are typed straight into the Shopping
   filter instead and ride along with the scenario: see useShopEdits.)
   Homes, median age and cars per household are shown with the edits but don't feed the model. */
import type { BlockGroup } from './types';
import type { ZonesFile } from './routing';

export type BlockField = 'pop' | 'college' | 'homes' | 'medAge' | 'drive' | 'perHH';
export type BlockEdit = Partial<Record<BlockField, number>>;
export type DataEdits = { blocks: Record<string, BlockEdit> };
export type DataFile = { id: string; name: string; saved: string; edits: DataEdits };
/* what the routing worker needs: per zone id, factors on residents and students and a drive share */
export type ZoneEdit = { res?: number; stu?: number; drive?: number };
export type ModelEdits = { zones: Record<string, ZoneEdit> };

export const EMPTY: DataEdits = { blocks: {} };
export const isEmpty = (e: DataEdits) => !Object.keys(e.blocks).length;

/* the default value of a field, as the Census file has it */
export function blockValue(b: BlockGroup, f: BlockField): number | null {
  return f === 'drive' ? b.commute?.drive ?? null : f === 'perHH' ? b.cars?.perHH ?? null : b[f];
}
/* block groups as the open file has them */
export function applyBlocks(groups: BlockGroup[], e: DataEdits): BlockGroup[] {
  if (!Object.keys(e.blocks).length) return groups;
  return groups.map(b => {
    const d = e.blocks[b.id]; if (!d) return b;
    const o: BlockGroup = { ...b };
    if (d.pop != null) o.pop = d.pop;
    if (d.college != null) o.college = d.college;
    if (d.homes != null) o.homes = d.homes;
    if (d.medAge != null) o.medAge = d.medAge;
    if (d.drive != null && b.commute) o.commute = { ...b.commute, drive: d.drive };
    if (d.perHH != null && b.cars) o.cars = { ...b.cars, perHH: d.perHH };
    return o;
  });
}

/* a traffic zone belongs to the block group whose last four id digits start its own id ("1011--3--3", "shop-1031012") */
export const zoneBlockKey = (zoneId: string) => zoneId.replace(/^shop-/, '').slice(0, 4);
export function modelEdits(groups: BlockGroup[], zoneIds: string[], e: DataEdits): ModelEdits {
  const zones: Record<string, ZoneEdit> = {}, byKey = new Map<string, ZoneEdit>();
  for (const b of groups) {
    const d = e.blocks[b.id]; if (!d) continue;
    const z: ZoneEdit = {};
    if (d.pop != null && b.pop) z.res = d.pop / b.pop;
    if (d.college != null && b.college) z.stu = d.college / b.college;
    if (d.drive != null) z.drive = d.drive;
    if (Object.keys(z).length) byKey.set(b.id.slice(-4), z);
  }
  if (byKey.size) zoneIds.forEach(id => { const z = byKey.get(zoneBlockKey(id)); if (z) zones[id] = z; });
  return { zones };
}

/* zones.json with a file's edits: used by the routing worker before it builds the router */
export function applyZones(Z: ZonesFile, m: ModelEdits | null): ZonesFile {
  if (!m || !Object.keys(m.zones).length) return Z;
  return {
    ...Z,
    zones: Z.zones.map(z => {
      const d = m.zones[z.id]; if (!d) return z;
      return { ...z, residents: z.residents * (d.res ?? 1), students: z.students * (d.stu ?? 1), workers: z.workers * (d.res ?? 1),
        acs: z.acs && d.drive != null ? { ...z.acs, drive: d.drive } : z.acs };
    })
  };
}

/* a short stable key for the scenario, so routed results are worked out again when the numbers change */
export function editsKey(e: DataEdits) {
  if (isEmpty(e)) return '';
  const s = JSON.stringify(e.blocks); let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ---------- this browser's files ---------- */
const FILES = 'atlas-data-files', OPEN = 'atlas-data-open';
function read<T>(k: string, fb: T): T { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } }
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } }
export const loadFiles = () => read<DataFile[]>(FILES, []).map(f => ({ ...f, edits: { blocks: f.edits?.blocks || {} } }));  /* older files also kept shopping edits */
export const saveFiles = (f: DataFile[]) => write(FILES, f);
/* the file that is open and its current numbers (edits not saved yet survive a reload) */
export type Open = { id: string | null; edits: DataEdits; editing?: boolean };
export const loadOpen = () => { const o = read<Open>(OPEN, { id: null, edits: EMPTY }); return { ...o, edits: { blocks: o.edits?.blocks || {} } }; };
export const saveOpen = (o: Open) => write(OPEN, o);
export const newFileId = () => 'f' + Date.now().toString(36);
