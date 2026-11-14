import { createRoot } from 'react-dom/client';
import type { BlockGroupsFile, OsmCity, ProjectsFile } from './model/types';
import { App } from './App';
import './styles.css';
import './theme.css';
import './responsive.css';  /* last: side-panel, tablet and phone layouts */

/* On-screen error box (from the UI sandbox): a failure shows in red instead of a silent blank map */
function showError(msg: string) {
  let b = document.getElementById('errbox');
  if (!b) { b = document.createElement('div'); b.id = 'errbox'; b.setAttribute('role', 'alert'); document.body.appendChild(b); }
  b.textContent = (b.textContent ? b.textContent + '\n' : '') + msg; b.style.display = 'block';
}
window.addEventListener('error', e => showError('Error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', e => showError('Error: ' + String(e.reason)));

/* Load the snapshot files from public/data, build the model, render. */
async function start() {
  const root = createRoot(document.getElementById('root')!);
  root.render(<p style={{ padding: 24 }}>Loading Rexburg…</p>);
  const get = (f: string) => fetch(import.meta.env.BASE_URL + 'data/' + f).then(r => { if (!r.ok) throw new Error(f + ': ' + r.status); return r.json(); });
  try {
    const [city, projects, graph, zones, cal, blocks] = await Promise.all(['city-rexburg.json', 'projects.json', 'graph-rexburg.json', 'zones.json', 'calibration.json', 'blockgroups.json'].map(f => get(f).catch(() => null)));
    if (!city || !projects) throw new Error('city-rexburg.json or projects.json missing');
    root.render(<App city={city as OsmCity} projects={projects as ProjectsFile} cal={cal} zones={graph && zones ? zones : null} blocks={blocks as BlockGroupsFile | null} />);
  } catch (e) {
    root.render(<p style={{ padding: 24 }}>Could not load the city data: {String(e)}</p>);
  }
}
start();
