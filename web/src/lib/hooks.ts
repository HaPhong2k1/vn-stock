import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { feed } from './feed';

export function useStock(sym: string) {
  return useSyncExternalStore((cb) => feed.onSymbol(sym, cb), () => feed.stocks.get(sym));
}

/** Render lại khi trạng thái chung (chỉ số, kết nối, status) đổi; giới hạn ~4 lần/giây */
export function useGlobal() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let pending = false;
    return feed.onGlobal(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; force(); }, 250);
    });
  }, []);
  return feed;
}
