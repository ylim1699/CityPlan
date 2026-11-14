import { useMemo, useState } from 'react';
import type { Atlas } from '../model/atlas';
import { createGeocoder } from '../model/geocode';
import type { ZonesFile } from '../model/routing';
import type { XZ } from '../model/types';

type Hit = { label: string; kind: string; pos: XZ };
const KIND: Record<string, string> = { shop: 'Store', food: 'Restaurant', proj: 'Project', road: 'Street', place: 'Place' };

/* Map search in the top bar: a Rexburg grid address ("1450 N 2nd E", placed from the street grid), or the name of
   a store or restaurant (OpenStreetMap), a project or a street. Picking one flies the map there and drops a pin. */
export function MapSearch({ A, zones, onPick }: { A: Atlas; zones: ZonesFile | null; onPick: (pos: XZ | null, label?: string) => void }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [on, setOn] = useState(false);
  const geo = useMemo(() => createGeocoder(A), [A]);
  const index = useMemo(() => {
    const out: Hit[] = [];
    const C = A.OSM;
    if (C.places.walmart) out.push({ label: 'Walmart Supercenter', kind: 'shop', pos: A.M(C.places.walmart) });
    if (C.places.campus) out.push({ label: 'BYU-Idaho', kind: 'place', pos: A.M(C.places.campus) });
    if (C.places.porter) out.push({ label: 'Porter Park', kind: 'place', pos: A.M(C.places.porter) });
    (zones?.stores || []).forEach(([n, k, x, z]) => { if (!/walmart/i.test(n)) out.push({ label: n, kind: k, pos: [x * A.S, z * A.S] }); });
    A.PROJECTS.forEach(p => { if (p.pos) out.push({ label: p.name, kind: 'proj', pos: p.pos }); });
    const roads: Record<string, XZ[]> = {};
    A.SEGS.forEach(s => { if (s.road.name) (roads[s.road.name] = roads[s.road.name] || []).push(s.mid); });
    Object.entries(roads).forEach(([n, mids]) => out.push({ label: n, kind: 'road', pos: mids[mids.length >> 1] }));
    return out;
  }, [A, zones]);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const res: Hit[] = [];
    const spot = geo.locate(q);
    if (spot) res.push({ label: q.trim(), kind: 'Address · ' + spot.how.replace(/, placed from the street grid$/, ''), pos: spot.pos });
    const starts = index.filter(h => h.label.toLowerCase().startsWith(t)), has = index.filter(h => !h.label.toLowerCase().startsWith(t) && h.label.toLowerCase().includes(t));
    return res.concat(starts, has).slice(0, 8);
  }, [q, geo, index]);
  const pick = (h: Hit) => { onPick(h.pos, h.label); setQ(h.label); setOpen(false); setOn(true); };
  const clear = () => { setQ(''); setOpen(false); if (on) { onPick(null); setOn(false); } };
  return <div className="card topcard search" role="search">
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
    <input type="search" value={q} placeholder="Search an address or place" aria-label="Search an address, store, project or street"
      onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={e => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); if (e.key === 'Escape') clear(); }} />
    {(q || on) && <button className="x" aria-label="Clear search" onClick={clear}>×</button>}
    {open && q.trim().length >= 2 && <ul className="search-list" role="listbox">
      {hits.length ? hits.map((h, i) => <li key={i} role="option" aria-selected={false}><button onMouseDown={e => e.preventDefault()} onClick={() => pick(h)}>
        <b>{h.label}</b><small>{KIND[h.kind] || h.kind}</small></button></li>)
        : <li className="none">No match. Try a grid address like “1450 N 2nd E” or a store name.</li>}
    </ul>}
  </div>;
}
