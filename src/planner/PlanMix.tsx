import { useEffect, useRef, useState } from 'react';
import type { Scenario } from '../model/routing';
import { send, useWorkerMessages } from '../hooks/useTraffic';
import { fmt, hourLabel } from '../ui';

/* Filter readout: what the already-planned city projects and your new projects each add to delay, alone and together.
   One judge request routes four versions of the same hour: neither, planned only, new only, both. */
type Plans = NonNullable<Scenario['plans']>;
type Roads = NonNullable<Scenario['roads']>;
export function PlanMix({ sc, plans, roads, today, open }: { sc: Scenario; plans: Plans; roads: Roads; today: number; open: boolean }) {
  const base: Scenario = { ...sc, withProjects: false }; delete base.plans; delete base.roads;
  const key = 'judge:mix:' + JSON.stringify([base, plans, roads]);
  const [res, setRes] = useState<{ key: string; p: number; n: number; b: number } | null>(null);
  const sent = useRef('');
  useWorkerMessages(m => {
    if (m.type !== 'judge' || m.key !== key) return;
    const v = (id: string) => (m.options.find(o => o.id === id)?.vht ?? m.base) - m.base;
    setRes({ key, p: v('p'), n: v('n'), b: v('b') });
  });
  useEffect(() => {
    if (!open || sent.current === key) return; sent.current = key;
    const withNew = (o: Scenario): Scenario => ({ ...o, ...(plans.length ? { plans } : {}), ...(roads.length ? { roads } : {}) });
    send({ type: 'judge', key, sc: base, options: [{ id: 'p', sc: { ...base, withProjects: true } }, { id: 'n', sc: withNew(base) }, { id: 'b', sc: withNew({ ...base, withProjects: true }) }] });
  }, [key, open]);
  const r = res && res.key === key ? res : null, yr = Math.floor(sc.t);
  if (!r) return <small className="mix-wait">Routing the hour four ways…</small>;
  const top = Math.max(r.p, r.n, r.b, 0.1), extra = r.b - r.p - r.n, real = extra > Math.max(2, 0.05 * r.b);  /* small gaps are routing noise */
  const row = (label: string, v: number, note?: string) => <div className="mix-row"><span>{label}{note && <small>{note}</small>}</span>
    <i style={{ width: Math.max(0, v / top * 100) + '%' }} /><b className="num">{v >= 0 ? '+' : ''}{fmt(v)}</b></div>;
  return <div className="mix">
    <small>Added delay, veh-h · {hourLabel(sc.hour)}, {sc.t <= today ? 'today' : 'fall ' + yr}</small>
    {row('Already planned', r.p, sc.t <= today ? 'pick a future year' : undefined)}
    {row('New projects', r.n, plans.length ? undefined : 'none open by then')}
    {row('Both', r.b)}
    {plans.length > 0 && sc.t > today && <small className={real ? 'mix-warn' : ''}>{real ? 'Together they add ' + fmt(extra) + ' more than separately: they load the same streets. Plan around those.'
      : 'Together they add about what they add separately.'}</small>}
  </div>;
}
