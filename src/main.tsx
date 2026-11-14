import { createRoot } from 'react-dom/client';
import type { Meta, OsmCity, ProjectsFile } from './model/types';
import { App } from './App';
import './styles.css';

/* Load the snapshot files from public/data, build the model, render. */
async function start() {
  const root = createRoot(document.getElementById('root')!);
  root.render(<p style={{ padding: 24 }}>Loading Rexburg…</p>);
  const get = (f: string) => fetch(import.meta.env.BASE_URL + 'data/' + f).then(r => { if (!r.ok) throw new Error(f + ': ' + r.status); return r.json(); });
  try {
    const [city, projects, graph, zones, cal] = await Promise.all(['city-rexburg.json', 'projects.json', 'graph-rexburg.json', 'zones.json', 'calibration.json'].map(f => get(f).catch(() => null)));
    if (!city || !projects) throw new Error('city-rexburg.json or projects.json missing');
    const metas = [city, projects, graph, zones, cal].map(f => f && f.meta).filter(Boolean) as Meta[];
    root.render(<App city={city as OsmCity} projects={projects as ProjectsFile} metas={metas} cal={cal} zones={graph && zones ? zones : null} />);
  } catch (e) {
    root.render(<p style={{ padding: 24 }}>Could not load the city data: {String(e)}</p>);
  }
}
start();
