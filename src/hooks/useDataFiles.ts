/* The open data file and this browser's saved ones (model/datafile.ts). The default is the snapshot of city data in
   public/data and never changes. Numbers are read-only until "Edit numbers"; then Save keeps them (in the open file, or a
   new named one when the default was open), Cancel drops them, and "Reset to default" goes back to the snapshot.
   An edit in progress survives a reload. */
import { useState } from 'react';
import { EMPTY, loadFiles, loadOpen, newFileId, saveFiles, saveOpen, type BlockEdit, type BlockField, type DataEdits, type DataFile, type Open } from '../model/datafile';

/* how many numbers differ from the default */
export function changeCount(e: DataEdits) {
  return Object.values(e.blocks).reduce((a, b) => a + Object.keys(b).length, 0);
}

export function useDataFiles() {
  const [files, setFilesRaw] = useState<DataFile[]>(loadFiles), [open, setOpenRaw] = useState<Open>(loadOpen);
  const setFiles = (f: DataFile[]) => { setFilesRaw(f); saveFiles(f); };
  const setOpen = (o: Open) => { setOpenRaw(o); saveOpen(o); };
  const file = files.find(f => f.id === open.id) ?? null;
  const saved = file ? file.edits : EMPTY;
  const dirty = JSON.stringify(open.edits) !== JSON.stringify(saved);
  const edit = (e: DataEdits) => { if (open.editing) setOpen({ ...open, edits: e }); };

  /* value null puts the field back to the default */
  function setBlock(id: string, f: BlockField, v: number | null) {
    const b: BlockEdit = { ...open.edits.blocks[id] };
    if (v == null) delete b[f]; else b[f] = v;
    const blocks = { ...open.edits.blocks }; if (Object.keys(b).length) blocks[id] = b; else delete blocks[id];
    edit({ ...open.edits, blocks });
  }
  return {
    files, file, edits: open.edits, editing: !!open.editing, dirty, changes: changeCount(open.edits),
    setBlock,
    startEdit: () => setOpen({ ...open, editing: true }),
    /* Cancel: back to the numbers as last saved */
    cancelEdit: () => setOpen({ id: open.id, edits: saved }),
    /* Save: into the open file, or a new file named `name` when the default is open (or asked for a copy) */
    save: (name?: string) => {
      const now = new Date().toISOString();
      if (file && name == null) { setFiles(files.map(f => f.id === file.id ? { ...f, edits: open.edits, saved: now } : f)); setOpen({ id: file.id, edits: open.edits }); return; }
      const f: DataFile = { id: newFileId(), name: (name || '').trim() || 'Untitled', saved: now, edits: open.edits };
      setFiles(files.concat(f)); setOpen({ id: f.id, edits: open.edits });
    },
    openFile: (id: string | null) => setOpen({ id, edits: files.find(f => f.id === id)?.edits ?? EMPTY }),
    rename: (id: string, name: string) => setFiles(files.map(f => f.id === id ? { ...f, name: name.trim() || f.name } : f)),
    remove: (id: string) => { setFiles(files.filter(f => f.id !== id)); if (open.id === id) setOpen({ id: null, edits: EMPTY }); },
    /* back to the snapshot: the default opens, saved files are kept */
    reset: () => setOpen({ id: null, edits: EMPTY })
  };
}
export type DataFiles = ReturnType<typeof useDataFiles>;
