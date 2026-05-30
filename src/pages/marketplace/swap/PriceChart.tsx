import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import type { SwapPairConfig } from './pairs/types';
import { usePairFillHistory, type ChartWindow } from './hooks/usePairFillHistory';

// Mid-market price chart for the active pair. Wired to usePairFillHistory
// which polls the order book and records the running median price. When a
// dedicated "fills feed" RPC ships, we swap in that source without
// touching this component.

const WINDOWS: { id: ChartWindow; label: string }[] = [
  { id: '1h', label: '1h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: 'all', label: 'All' },
];

export interface PriceChartProps {
  pair: SwapPairConfig;
}

interface ChartPoint {
  ts: number;
  label: string;
  price: number;
}

function formatTimeLabel(tsMs: number, span: ChartWindow): string {
  const d = new Date(tsMs);
  if (span === '1h' || span === '24h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

export default function PriceChart({ pair }: PriceChartProps) {
  const { samples, window, setWindow, loading, hasData } = usePairFillHistory(pair);

  const chartData: ChartPoint[] = useMemo(
    () =>
      samples.map((s) => ({
        ts: s.ts_ms,
        label: formatTimeLabel(s.ts_ms, window),
        price: s.price,
      })),
    [samples, window],
  );

  const { minPrice, maxPrice } = useMemo(() => {
    if (chartData.length === 0) return { minPrice: 0, maxPrice: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of chartData) {
      if (p.price < lo) lo = p.price;
      if (p.price > hi) hi = p.price;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { minPrice: 0, maxPrice: 1 };
    if (lo === hi) {
      const pad = lo * 0.01 || 0.0000001;
      return { minPrice: lo - pad, maxPrice: hi + pad };
    }
    const pad = (hi - lo) * 0.10;
    return { minPrice: lo - pad, maxPrice: hi + pad };
  }, [chartData]);

  const latestPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : null;

  return (
    <div
      className="card p-4 space-y-3"
      style={{ border: `1px solid ${pair.accent.glow}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
            {pair.label} price
          </h3>
          <p className="text-[11px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
            Mid-market estimate from the live order book.{' '}
            {loading && hasData ? 'Refreshing…' : null}
          </p>
        </div>
        <div className="text-right">
          <div
            className="font-display font-semibold tabular-nums"
            style={{
              color: pair.accent.text,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 16,
            }}
          >
            {latestPrice !== null ? pair.formatPrice(latestPrice) : '—'}
          </div>
          <div
            className="inline-flex rounded text-[10px] font-display font-semibold mt-1"
            style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {WINDOWS.map((w) => {
              const active = w.id === window;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWindow(w.id)}
                  className="px-2 py-0.5 uppercase tracking-wide transition-colors"
                  style={{
                    color: active ? pair.accent.text : 'rgba(238,240,255,0.45)',
                    background: active ? pair.accent.glow : 'transparent',
                  }}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ height: 220 }}>
        {chartData.length === 0 ? (
          <div
            className="h-full flex items-center justify-center text-xs"
            style={{ color: 'rgba(238,240,255,0.45)' }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={13} className="animate-spin" /> Collecting price data…
              </span>
            ) : (
              <span>
                No price data for this window yet. The chart fills in as orders trade.
              </span>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgba(238,240,255,0.45)', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
                minTickGap={36}
              />
              <YAxis
                domain={[minPrice, maxPrice]}
                tick={{ fill: 'rgba(238,240,255,0.45)', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
                tickFormatter={(v) => pair.formatPrice(Number(v)).split(' ')[0]}
                width={84}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(2,5,14,0.92)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'var(--t1)',
                }}
                labelStyle={{ color: 'rgba(238,240,255,0.55)' }}
                formatter={(value: number) => [pair.formatPrice(value), 'Price']}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke={pair.accent.primary}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
