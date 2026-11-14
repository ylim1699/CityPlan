/* A person's corrections to the pulled project records (this browser): fields they changed, or the whole record removed.
   Applied over projects.json and the agent's confirmed projects, in the page and in the routing worker alike. */
import { useState } from 'react';
import type { Project } from '../model/types';

export const EDIT_FIELDS = ['name', 'status', 'start', 'end', 'size', 'plain', 'evidence', 'flags', 'trips'] as const;
export type ProjectEdit = Partial<Pick<Project, typeof EDIT_FIELDS[number]>> & { removed?: boolean; removedName?: string };  /* the name, to list it for restoring */
export type ProjectEdits = Record<string, ProjectEdit>;

const KEY = 'atlas-project-edits';
function load(): ProjectEdits { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }

export function applyProjectEdits(list: Project[], ed: ProjectEdits): Project[] {
  return list.filter(p => !ed[p.id]?.removed).map(p => {
    const e = ed[p.id]; if (!e) return p;
    const { removed, removedName, ...fields } = e; return { ...p, ...fields };
  });
}

export function useProjectEdits() {
  const [edits, setRaw] = useState<ProjectEdits>(load);
  const save = (n: ProjectEdits) => { setRaw(n); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) {} };
  return {
    edits,
    edit: (id: string, e: ProjectEdit) => save({ ...edits, [id]: { ...edits[id], ...e } }),
    remove: (id: string, name: string) => save({ ...edits, [id]: { ...edits[id], removed: true, removedName: name } }),
    restore: (id: string) => { const { removed, removedName, ...rest } = edits[id] || {}; const n = { ...edits }; if (Object.keys(rest).length) n[id] = rest; else delete n[id]; save(n); },
    reset: (id: string) => { const n = { ...edits }; delete n[id]; save(n); }
  };
}
export type ProjectEditsApi = ReturnType<typeof useProjectEdits>;
