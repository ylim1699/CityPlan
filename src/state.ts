/* App state: one reducer, same fields as the legacy state object. */
import { DEFAULTS } from './model/atlas';
import type { Fix, Params } from './model/types';
import { TODAY_I } from './ui';

export type Mode = 'resident' | 'planner';
export type Layers = { traffic: boolean; cars: boolean; proj: boolean; walk: boolean };
export type State = {
  mode: Mode; hour: number; widen: string[]; withProjects: boolean; ti: number; sel: string | null; spring: boolean;
  fixes: Fix[]; prm: Params; layers: Layers; method: 'routed' | 'counts';
};
export const initialState: State = {
  mode: 'resident', hour: 17, widen: [], withProjects: true, ti: TODAY_I, sel: null, spring: false, fixes: [],
  prm: { ...DEFAULTS }, layers: { traffic: true, cars: true, proj: true, walk: true }, method: 'routed'
};
export type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'hour'; hour: number }
  | { type: 'ti'; ti: number }
  | { type: 'scenario'; withProjects: boolean }
  | { type: 'layer'; key: keyof Layers; on: boolean }
  | { type: 'select'; id: string | null }
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
    case 'scenario': return { ...s, withProjects: a.withProjects };
    case 'layer': return { ...s, layers: { ...s.layers, [a.key]: a.on } };
    case 'select': return { ...s, sel: a.id };
    case 'prm': return { ...s, prm: { ...s.prm, [a.key]: a.value } };
    case 'spring': return { ...s, spring: a.on };
    case 'widen': return { ...s, widen: s.widen.filter(x => x !== a.id).concat(a.on ? [a.id] : []) };
    case 'fix': return { ...s, fixes: s.fixes.filter(x => x.road !== a.fix.road).concat([a.fix]) };
    case 'unfix': return { ...s, fixes: s.fixes.filter((_, i) => i !== a.index) };
    case 'view': return { ...s, ...a.patch };
  }
}
