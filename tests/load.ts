/* Test helpers: load the snapshot files from disk the way the app fetches them. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createAtlas } from '../src/model/atlas';
import type { OsmCity, ProjectsFile } from '../src/model/types';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function readJson<T = any>(rel: string): T { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); }
export function loadAtlas() { return createAtlas(readJson<OsmCity>('public/data/city-rexburg.json'), readJson<ProjectsFile>('public/data/projects.json')); }
/* legacy/model.js run against the same city file, for the parity check */
export function loadLegacy(): any {
  const ctx: any = { window: {} };
  ctx.window.OSM_CITY = readJson('public/data/city-rexburg.json');
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'legacy/model.js'), 'utf8').replace('(typeof window !== \'undefined\' ? window : globalThis)', '(window)'), ctx);
  return ctx.window.ATLAS;
}
