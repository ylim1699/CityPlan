/* App state: one reducer, same fields as the legacy state object. */
import { DEFAULTS } from './model/atlas';
import type { Fix, Params } from './model/types';
import { TODAY_I } from './ui';

export type Mode = 'resident' | 'planner';
export type Layers = { traffic: boolean; cars: boolean; signals: boolean; proj: boolean; walk: boolean; blocks: boolean; zones: boolean; shops?: boolean; flows?: boolean };
/* Traffic congestion filter: which load colors the streets show (green under 70%, yellow 70-85%, red from 85%) */
export type Cong = { green: boolean; yellow: boolean; red: boolean };
export const congOf = (key: number): keyof Cong => key >= 3 ? 'red' : key === 2 ? 'yellow' : 'green';
export type State = {
  mode: Mode; hour: number; widen: string[]; withProjects: boolean; withNew: boolean; ti: number; sel: string | null; spring: boolean;
  block: string | null;  /* Census block group shown in the panel (blocks layer) */
  fixes: Fix[]; prm: Params; layers: Layers; method: 'routed' | 'counts';
  cong: Cong;
  flow?: string | null;  /* the store zone (zones.json id) whose shopping trips the Shopping filter shows */
  lights: number; speed: number;  /* City lights at night (0-1.5) and Demo speed (0.25-4x), from the UI sandbox */
};
export const initialState: State = {
  mode: 'planner', hour: 17, widen: [], withProjects: true, withNew: true, ti: TODAY_I, sel: null, block: null, spring: false, fixes: [],
  prm: { ...DEFAULTS }, layers: { traffic: true, cars: true, signals: true, proj: true, walk: true, blocks: false, zones: false, shops: true, flows: false }, method: 'routed', cong: { green: true, yellow: true, red: true }, lights: 1, speed: 1
};
export type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'hour'; hour: number }
  | { type: 'ti'; ti: number }
  | { type: 'scenario'; withProjects?: boolean; withNew?: boolean }
  | { type: 'layer'; key: keyof Layers; on: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'block'; id: string | null }
  | { type: 'prm'; key: keyof Params; value: number }
  | { type: 'spring'; on: boolean }
  | { type: 'widen'; id: string; on: boolean }
  | { type: 'fix'; fix: Fix }
  | { type: 'unfix'; index: number }
  | { type: 'view'; patch: Partial<State> };

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'mode': return { ...s, mode: a.mode, sel: null };
    case 'hour': return { ...s, hour: ((a.hour % 24) + 24) % 24 };
    case 'ti': return { ...s, ti: a.ti };
    case 'scenario': return { ...s, ...(a.withProjects !== undefined ? { withProjects: a.withProjects } : {}), ...(a.withNew !== undefined ? { withNew: a.withNew } : {}) };
    case 'layer': return { ...s, layers: { ...s.layers, [a.key]: a.on }, block: a.key === 'blocks' && !a.on ? null : s.block };
    case 'select': return { ...s, sel: a.id, block: a.id ? null : s.block };
    case 'block': return { ...s, block: a.id, sel: a.id ? null : s.sel };
    case 'prm': return { ...s, prm: { ...s.prm, [a.key]: a.value } };
    case 'spring': return { ...s, spring: a.on };
    case 'widen': return { ...s, widen: s.widen.filter(x => x !== a.id).concat(a.on ? [a.id] : []) };
    case 'fix': return { ...s, fixes: s.fixes.filter(x => x.road !== a.fix.road).concat([a.fix]) };
    case 'unfix': return { ...s, fixes: s.fixes.filter((_, i) => i !== a.index) };
    case 'view': return { ...s, ...a.patch };
  }
}
