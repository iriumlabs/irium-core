import { useEffect, useRef, useState } from 'react';
import type { PriceSample, SwapPairConfig, SwapOrderRow } from '../pairs/types';

// Time window helpers for the chart filter chips. "all" is unbounded.
export type ChartWindow = '1h' | '24h' | '7d' | 'all';

const WINDOW_MS: Record<ChartWindow, number | null> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  all: null,
};

const POLL_INTERVAL_MS = 30_000;
const MAX_SAMPLES = 720;

// usePairFillHistory builds a price time-series for the active pair by
// polling the order book and computing the volume-weighted mid price
// across currently-open orders. As orders disappear (filled or
// cancelled) we keep the previous samples so the chart has continuity.
// When a richer "fills feed" RPC ships, the polling body here is the
// only thing that needs to change.

export interface UsePairFillHistoryResult {
  samples: PriceSample[];
  window: ChartWindow;
  setWindow: (w: ChartWindow) => void;
  loading: boolean;
  hasData: boolean;
}

function midPrice(orders: SwapOrderRow[]): number | null {
  const usable = orders
    .map((o) => o.implied_quote_per_irm)
    .filter((p) => Number.isFinite(p) && p > 0);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return mid;
}

export function usePairFillHistory(pair: SwapPairConfig): UsePairFillHistoryResult {
  const [samples, setSamples] = useState<PriceSample[]>([]);
  const [window, setWindow] = useState<ChartWindow>('24h');
  const [loading, setLoading] = useState(false);
  // Reset the sample buffer when the active pair changes so stale BTC
  // points don't show up on a USDT chart and vice versa.
  const pairIdRef = useRef(pair.id);

  useEffect(() => {
    if (pairIdRef.current !== pair.id) {
      setSamples([]);
      pairIdRef.current = pair.id;
    }
  }, [pair.id]);

  useEffect(() => {
    if (!pair.available) {
      // Coming-soon pair — no polling, no samples.
      setSamples([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const result = await pair.rpc.listOrders({ direction: 'both', limit: 100 });
        if (cancelled) return;
        const price = midPrice(result.orders);
        if (price !== null) {
          const sample: PriceSample = { ts_ms: Date.now(), price };
          setSamples((prev) => {
            const next = [...prev, sample];
            if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES);
            return next;
          });
        }
      } catch {
        // Silent — the panel surfaces order book errors itself.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pair]);

  const cutoffMs = WINDOW_MS[window];
  const filtered =
    cutoffMs === null
      ? samples
      : samples.filter((s) => s.ts_ms >= Date.now() - cutoffMs);

  return {
    samples: filtered,
    window,
    setWindow,
    loading,
    hasData: filtered.length > 0,
  };
}
