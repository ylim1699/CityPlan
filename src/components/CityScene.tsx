import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Atlas } from '../model/atlas';
import type { State } from '../state';
import { createView, type View } from '../scene/view';

type Props = { A: Atlas; getState: () => State; onSelect: (id: string) => void; appRef: React.RefObject<HTMLDivElement | null> };

/* Canvas + label overlay + compass. The three.js code lives in scene/view.ts; this only mounts it. */
export const CityScene = forwardRef<View | null, Props>(function CityScene({ A, getState, onSelect, appRef }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLDivElement>(null), compass = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null), [failed, setFailed] = useState(false);
  const sel = useRef(onSelect); sel.current = onSelect;
  useImperativeHandle(ref, () => ({
    apply: (s, tp) => view.current?.apply(s, tp), flyTo: p => view.current?.flyTo(p), pick: cb => view.current?.pick(cb), dispose: () => {},
    setGhosts: (l, sel) => view.current?.setGhosts(l, sel), onGhost: cb => view.current?.onGhost(cb), target: () => view.current ? view.current.target() : [0, 0],
    setHighlight: l => view.current?.setHighlight(l)
  }), []);
  useEffect(() => {
    try { view.current = createView({ canvas: canvas.current!, overlay: overlay.current!, app: appRef.current!, compass: compass.current! }, A, getState, id => sel.current(id)); }
    catch (e) { console.error(e); view.current = null; }
    if (!view.current) setFailed(true);
    return () => { view.current?.dispose(); view.current = null; };
  }, [A]);
  return <>
    <canvas id="scene" ref={canvas} aria-label="3D model of Rexburg showing streets, existing buildings and planned projects" />
    <div id="overlay" ref={overlay} />
    <div id="fallback" style={{ display: failed ? 'grid' : 'none' }}><p>The 3D view could not start in this browser. The panels still work.</p></div>
    <div className="card compass" id="compass" ref={compass} aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 2 L20 16 L16 13 L12 16 Z" fill="#0d6767" /><path d="M16 30 L12 16 L16 19 L20 16 Z" fill="#c4cdc8" /></svg></div>
  </>;
});
