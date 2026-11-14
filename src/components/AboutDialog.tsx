import { forwardRef } from 'react';
import type { Atlas } from '../model/atlas';
import type { Meta, Source } from '../model/types';

/* Limits, rates and every data source (project sources + snapshot meta blocks). */
export const AboutDialog = forwardRef<HTMLDialogElement, { A: Atlas; metas: Meta[] }>(function AboutDialog({ A, metas }, ref) {
  const seen: Record<string, 1> = {}, items: Source[] = [];
  A.PROJECTS.map(p => p.source).concat(A.UNMAPPED.map(u => u.source), A.CONTEXT.map(u => u.source), [
    { label: 'BYU-Idaho fall 2026 enrollment (East Idaho News)', url: 'https://www.eastidahonews.com/?p=881123' },
    { label: 'BYU-Idaho enrollment and demographics', url: 'https://www.byui.edu/about/enrollment-and-demographics' },
    { label: 'BYU-Idaho fall 2025 enrollment', url: 'https://www.byui.edu/newsroom/announcements/byu-idaho-celebrates-largest-incoming-class-for-second-year-in-a-row' },
    { label: 'BYU-Idaho spring 2026 enrollment (East Idaho News)', url: 'https://www.eastidahonews.com/?p=840638' },
    { label: 'Teton River Idaho Temple size (Church News)', url: 'https://www.thechurchnews.com/almanac/temples/teton-river-idaho/' },
    { label: 'OpenStreetMap (streets, buildings, lots), via Overpass Turbo', url: 'https://www.openstreetmap.org/copyright' },
    { label: 'Madison County / Rexburg GIS: traffic counts and Pedestrian Emphasis District', url: 'https://madison.rexburg.org/mrgis/rest/services/Data' },
    A.WIDEN_SRC
  ]).forEach(s => { if (s.url && !seen[s.url]) { seen[s.url] = 1; items.push(s); } });
  const close = () => (ref as React.RefObject<HTMLDialogElement>).current?.close();
  return <dialog ref={ref}>
    <div className="dlg">
      <h2>What this model can and cannot tell you</h2>
      <p>The projects are real and each one links to its source. The traffic, housing and population figures are a what-if model built from standard per-person rates. Read results as relative: this road is under more pressure than that one.</p>
      <h3>Limits</h3>
      <ul>
        <li>Streets, building outlines, parking lots, parks and water come from OpenStreetMap (downloaded November 2026). Building heights are estimated from building type for about 98% of buildings, and drawn 2.5 times taller so they read from a distance.</li>
        <li>Project footprints are placed from news descriptions where the parcel is not mapped. Mapped buildings inside a project footprint are hidden so they do not overlap.</li>
        <li>The walk district is the city's Pedestrian Emphasis District boundary from the county GIS.</li>
        <li>Streets with a city traffic count from 2015 or later (about 480 of 3,250 street pieces) use that count, grown 2.5% a year to 2026 (assumed growth). Directional approach counts and intersection totals are left out. Other streets use an assumed figure for their road type.</li>
        <li>Capacity comes from lane counts: the OpenStreetMap lanes tag where present, otherwise an assumption (4 lanes for an untagged main road). North 2nd East is set to its widened five-lane layout. Lane counts drive the congestion colors, so a wrong lane count shows up as a wrong color.</li>
        <li>Population is uncertain: the 2020 census counted 39,787, and the city has said its own estimate is closer to 45,000. The model starts from 44,000.</li>
        <li>Student numbers use campus-based enrollment, not totals that include online students.</li>
        <li>Construction progress is estimated from start and end dates, not from site visits.</li>
        <li>Parking keeps three numbers apart: official per-lot counts from BYU-Idaho Parking Services (not published), stalls counted from aerial photos (none yet), and a rough estimate from mapped lot area in the walk district at 30 square meters per space, which includes church and business lots. New housing shows the city code minimum: 2 spaces per unit plus 10% for visitors.</li>
        <li>Developer-led widenings come from the city's construction map, where they have no dates. They change nothing unless you tick them in Planner view, which adds 80% capacity to the streets they cover (assumed).</li>
        <li>It screens options before an engineering study; it is not an intersection or signal-timing study.</li>
      </ul>
      <h3>Rates used</h3>
      <ul>
        <li>Homes: 6.7 car trips a day each. Student housing in the walk district: 2.5 (assumed).</li>
        <li>Supermarket: 94 trips per 1,000 sq ft, less 35% pass-by. Assisted living: 2.6 per bed.</li>
        <li>Each hour carries an assumed share of a weekday's traffic, peaking at 7.5% at 8 am and 9.5% at 5 pm. This is a typical profile, not a Rexburg count.</li>
        <li>These are rounded textbook values. Check them against the current ITE Trip Generation Manual before quoting.</li>
      </ul>
      <h3>Data snapshots</h3>
      <ul>{metas.map((m, i) => <li key={i}>{m.url ? <a href={m.url} target="_blank" rel="noopener">{m.source}</a> : m.source} · {m.fetched} · {m.type}</li>)}</ul>
      <h3>Data sources</h3>
      <ul>{items.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener">{s.label}</a></li>)}</ul>
      <button className="close" onClick={close}>Close</button>
    </div>
  </dialog>;
});
