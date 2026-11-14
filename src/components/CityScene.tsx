import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { BlockGroup } from '../model/types';
import type { ZonesFile, ZoneStats } from '../model/routing';
import type { State } from '../state';
import { createView, type Cam, type View } from '../scene/view';

type Props = { A: Atlas; getState: () => State; onSelect: (id: string) => void; appRef: React.RefObject<HTMLDivElement | null>;
  blocks?: BlockGroup[] | null; onBlock?: (id: string | null) => void; zones?: ZonesFile | null; zoneStats?: ZoneStats | null };

/* Canvas + label overlay. The three.js code lives in scene/view.ts; this only mounts it. */
export const CityScene = forwardRef<View | null, Props>(function CityScene({ A, getState, onSelect, appRef, blocks = null, onBlock, zones = null, zoneStats = null }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null), [failed, setFailed] = useState(false), cam = useRef<Cam | null>(null);
  const sel = useRef(onSelect); sel.current = onSelect;
  const blk = useRef(onBlock); blk.current = onBlock;
  const zst = useRef(zoneStats); zst.current = zoneStats;
  useImperativeHandle(ref, () => ({
    apply: (s, tp) => view.current?.apply(s, tp), flyTo: p => view.current?.flyTo(p), pick: cb => view.current?.pick(cb), dispose: () => {},
    setGhosts: (l, sel) => view.current?.setGhosts(l, sel), onGhost: cb => view.current?.onGhost(cb), target: () => view.current ? view.current.target() : [0, 0],
    setHighlight: l => view.current?.setHighlight(l), setZoneStats: z => view.current?.setZoneStats(z), mark: (p, l) => view.current?.mark(p, l), setFlows: l => view.current?.setFlows(l),
    getCam: () => view.current ? view.current.getCam() : { p: [], t: [] }, setCam: c => view.current?.setCam(c)
  }), []);
  useEffect(() => {
    try { view.current = createView({ canvas: canvas.current!, overlay: overlay.current!, app: appRef.current! }, A, getState, id => sel.current(id), blocks, id => blk.current?.(id), zones); view.current?.setZoneStats(zst.current); if (cam.current) view.current?.setCam(cam.current); }
    catch (e) { console.error(e); view.current = null; }
    if (!view.current) setFailed(true);
    /* a confirmed project rebuilds the view: keep the camera where the person left it */
    return () => { if (view.current) cam.current = view.current.getCam(); view.current?.dispose(); view.current = null; };
  }, [A, blocks, zones]);
  useEffect(() => { view.current?.setZoneStats(zoneStats); }, [zoneStats]);
  return <>
    <canvas id="scene" ref={canvas} aria-label="3D model of Rexburg showing streets, existing buildings and planned projects" />
    <div id="overlay" ref={overlay} />
    <div id="fallback" style={{ display: failed ? 'grid' : 'none' }}><p>The 3D view could not start in this browser. The panels still work.</p></div>
  </>;
});
