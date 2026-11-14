/* Shopping numbers typed in the Filter > Shopping tab: a store's daily arrivals and the trips from each area. They live
   only for this visit (nothing to save), ride along with the scenario (Scenario.shops) so the router reruns without
   rebuilding, and each remembers the number it replaced so ↺ puts it back. */
import { useMemo, useState } from 'react';
import type { ShopEdit } from '../model/routing';

type Val = { v: number; was: number };
export type ShopUi = Record<string, { total?: Val; from?: Record<string, Val> }>;

export function useShopEdits() {
  const [ui, setUi] = useState<ShopUi>({});
  /* key: 'total' or an origin zone id; v null puts the number back */
  function set(store: string, key: string, v: number | null, was: number) {
    setUi(prev => {
      const s = { ...prev[store], from: { ...prev[store]?.from } };
      const old = key === 'total' ? s.total : s.from[key];
      const next = v == null ? undefined : { v, was: old ? old.was : was };
      if (key === 'total') s.total = next; else if (next) s.from[key] = next; else delete s.from[key];
      if (!s.total) delete s.total;
      if (!Object.keys(s.from).length) delete (s as { from?: unknown }).from;
      const out = { ...prev }; if (Object.keys(s).length) out[store] = s; else delete out[store];
      return out;
    });
  }
  const reset = (store: string) => setUi(prev => { const out = { ...prev }; delete out[store]; return out; });
  /* what the router needs: just the numbers */
  const shops = useMemo(() => {
    const out: Record<string, ShopEdit> = {};
    Object.entries(ui).forEach(([id, s]) => {
      const e: ShopEdit = {};
      if (s.total) e.total = s.total.v;
      if (s.from) e.from = Object.fromEntries(Object.entries(s.from).map(([z, x]) => [z, x.v]));
      out[id] = e;
    });
    return out;
  }, [ui]);
  return { ui, shops, set, reset };
}
export type ShopEdits = ReturnType<typeof useShopEdits>;
