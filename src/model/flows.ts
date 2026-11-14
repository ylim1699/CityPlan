/* Shopping trips for the Shopping filter: daily car trips arriving at one store zone, by the zone they leave from.
   Model estimates from the routing run (the gravity rule and the Walmart share in routing.ts), not tracked trips. */
import type { BlockGroup, XZ } from './types';
import type { Zone, ZonesFile } from './routing';

export type ShopFlows = { zone: number; from: Float32Array }[];
export type FlowRow = { i: number; name: string; n: number; pos: XZ };

export function walmartId(Z: ZonesFile) { return Z.zones.find(z => z.shop && /walmart/i.test(z.name || ''))?.id ?? null; }

/* a place name people know: the store, the Census block group, campus, or the road a visitor comes in on */
export function zoneName(z: Zone, blocks: BlockGroup[] | null) {
  if (z.shop) return z.name ? z.name.split(', ')[0] : 'Stores (no name in OpenStreetMap)';
  if (z.kind === 'campus') return 'BYU-Idaho campus';
  if (z.kind === 'gateway') { const d = /^gw-([a-z]+)-/.exec(z.id); return 'Outside town, ' + (z.road || 'road in') + (d ? ' ' + d[1] : ''); }
  const g = blocks?.find(b => b.id.slice(-4) === z.id.slice(0, 4));
  return g ? g.name : 'Area ' + z.id;
}

/* stores with trips, busiest first */
export function storeList(Z: ZonesFile, flows: ShopFlows) {
  return flows.map(f => ({ id: Z.zones[f.zone].id, name: zoneName(Z.zones[f.zone], null), n: f.from.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.n - a.n);
}

/* where the chosen store's shoppers come from, most trips first; S scales zone coordinates to the scene */
export function flowsTo(Z: ZonesFile, flows: ShopFlows, id: string, blocks: BlockGroup[] | null, S: number) {
  const j = Z.zones.findIndex(z => z.id === id), f = flows.find(x => x.zone === j);
  if (j < 0 || !f) return null;
  const at = (z: Zone): XZ => [z.x * S, z.z * S];
  const rows: FlowRow[] = [];
  f.from.forEach((n, i) => { if (n >= 1) rows.push({ i, name: zoneName(Z.zones[i], blocks), n, pos: at(Z.zones[i]) }); });
  rows.sort((a, b) => b.n - a.n);
  return { store: Z.zones[j], pos: at(Z.zones[j]), name: zoneName(Z.zones[j], null), total: f.from.reduce((a, n) => a + n, 0), rows };
}
