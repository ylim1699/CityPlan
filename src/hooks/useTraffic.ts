/* Talks to the routing worker. Returns the latest routed result for the scenario, or null while it is being computed
   (the app keeps showing the count-based colors until then). */
import { useEffect, useRef, useState } from 'react';
import type { Req, Res } from '../worker/route.worker';
import type { Scenario } from '../model/routing';

type Run = Extract<Res, { type: 'run' }>;
let worker: Worker | null = null;
const listeners = new Set<(m: Res) => void>();
let ready = false, readyErr: string | null = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../worker/route.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Res>) => {
    if (e.data.type === 'ready') ready = true;
    if (e.data.type === 'error') readyErr = e.data.error;
    listeners.forEach(l => l(e.data));
  };
  worker.postMessage({ type: 'init', base: import.meta.env.BASE_URL } satisfies Req);
  return worker;
}
export function send(m: Req) { getWorker().postMessage(m); }
/* projects confirmed from the AI agent: the worker rebuilds its model with them */
export function setExtraProjects(list: unknown[]) { send({ type: 'projects', extra: list } as Req); }
export function useWorkerMessages(fn: (m: Res) => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { const l = (m: Res) => ref.current(m); listeners.add(l); getWorker(); return () => { listeners.delete(l); }; }, []);
}

export function useTraffic(sc: Scenario, enabled: boolean) {
  const key = JSON.stringify(sc);
  const [run, setRun] = useState<Run | null>(null), [hours, setHours] = useState<{ key: string; hours: { mx: number; avg: number }[] } | null>(null);
  const [status, setStatus] = useState<'off' | 'loading' | 'routing' | 'ready' | 'error'>(enabled ? 'loading' : 'off');
  const keyRef = useRef(key); keyRef.current = key;
  useWorkerMessages(m => {
    if (m.type === 'ready') setStatus(s => s === 'loading' ? 'routing' : s);
    if (m.type === 'error') setStatus('error');
    if (m.type === 'run' && m.key === keyRef.current) { setRun(m); setStatus('ready'); }
    if (m.type === 'hours' && m.key === keyRef.current) setHours({ key: m.key, hours: m.hours });
  });
  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    if (readyErr) { setStatus('error'); return; }
    setStatus(ready ? 'routing' : 'loading');
    send({ type: 'run', key, sc, hours: true });
  }, [key, enabled]);
  const fresh = run && run.key === key ? run : null;
  return { run: fresh, stale: run, hours: hours && hours.key === key ? hours.hours : null, status };
}
