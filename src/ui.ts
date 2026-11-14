/* Small formatting helpers and constants shared by the panels and the 3D view. */
import type { Atlas } from './model/atlas';
import type { Project } from './model/types';

/* road load colors by level (Light, Steady, Busy, Heavy, Over): three contrasting traffic colors.
   Green under 70%, yellow 70 to 85%, red from 85%, a deeper red over capacity. */
export const CCOL = ['#d8c49a', '#e8b65a', '#e88e3a', '#cf552d', '#8f1f2a'];  /* warm scale from the UI sandbox: sand, amber, orange, rust, deep red */
export const TODAY_I = 11, LAST_I = 43;
export const FIXES = [
  { k: 'turn', l: 'Turn lanes (+15%)', f: 1.15 },
  { k: 'signal', l: 'Signal timing (+8%)', f: 1.08 },
  { k: 'round', l: 'Roundabout (+25%)', f: 1.25 }
];
export function fmt(n: number) { return Math.round(n).toLocaleString('en-US'); }
export function pct(x: number) { return Math.round(x * 100) + '%'; }
export function tOf(i: number) { return 2024 + i / 4 + 0.125; }
export function qLabel(t: number) { const y = Math.floor(t); return 'Q' + (Math.floor((t - y) * 4) + 1) + ' ' + y; }
export function hourLabel(h: number) { return h === 0 ? 'midnight' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }
export function daylight(h: number) { function ss(a: number, b: number, x: number) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); } return ss(5.5, 7.5, h) * (1 - ss(17.5, 20, h)); }

export type PStatus = { key: 'done' | 'construction' | 'approved' | 'planned'; label: string; progress: number };
export function pStatus(A: Atlas, p: Project, tp: number): PStatus {
  const s = A.projState(p, tp);
  /* a project that ends after today is only expected done when the slider is moved past its end, not known done */
  if (s.phase === 'done') return { key: 'done', label: p.end > A.TODAY ? (p.unconfirmed ? 'Expected done, timing assumed' : 'Expected done') : 'Finished', progress: 1 };
  if (s.phase === 'active') return { key: 'construction', label: p.unconfirmed ? 'Under way, timing assumed' : 'Under construction', progress: s.progress };
  return { key: p.status === 'planned' ? 'planned' : 'approved', label: p.status === 'planned' ? 'Planned' : 'Approved, not started', progress: 0 };
}
export function when(p: Project, st: PStatus) {
  if (st.key === 'done') return (st.label === 'Finished' ? 'Finished ' : 'Expected by ') + qLabel(p.end);
  if (st.key === 'construction') return 'Target ' + qLabel(p.end);
  return 'Starts ' + qLabel(p.start);
}
