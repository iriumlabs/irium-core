import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Plus, Lock, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type {
  ListOrdersResult,
  SwapDirection,
  SwapOrderRow,
  SwapPairConfig,
  SwapSortKey,
} from './pairs/types';

const POLL_INTERVAL_MS = 10_000;

type DirectionFilter = SwapDirection | 'both';

export interface PairOrderBookProps {
  pair: SwapPairConfig;
  selectedOrderId?: string | null;
  onSelectOrder: (row: SwapOrderRow) => void;
  onCreateOrder: () => void;
  myAddresses: Set<string>;
}

function truncateAddr(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function relativeAgo(opened: number, tip: number): string {
  if (!opened || !tip) return 'recent';
  const diff = Math.max(0, tip - opened);
  if (diff === 0) return 'just now';
  if (diff < 60) return `${diff} blocks ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PairOrderBook({
  pair,
  selectedOrderId,
  onSelectOrder,
  onCreateOrder,
  myAddresses,
}: PairOrderBookProps) {
  const [orders, setOrders] = useState<SwapOrderRow[]>([]);
  const [totalOpen, setTotalOpen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>('both');
  const [sort, setSort] = useState<SwapSortKey>('price_asc');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [hideMine, setHideMine] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async (silent: boolean) => {
      if (cancelled) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const result: ListOrdersResult = await pair.rpc.listOrders({
          direction,
          sort,
          limit: 100,
        });
        if (cancelled) return;
        setOrders(result.orders);
        setTotalOpen(result.total_open);
        setError(null);
        setLastUpdated(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    tick(false);
    const id = setInterval(() => tick(true), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pair, direction, sort]);

  const filtered = useMemo(() => {
    if (!hideMine) return orders;
    return orders.filter((o) => !myAddresses.has(o.maker_iriumd_address));
  }, [orders, hideMine, myAddresses]);

  const tipHeight = useMemo(() => {
    let h = 0;
    for (const o of orders) {
      if (o.opened_at_height > h) h = o.opened_at_height;
    }
    return h;
  }, [orders]);

  return (
    <div
      className="card p-4 space-y-3"
      style={{ border: `1px solid ${pair.accent.glow}` }}
    >
      {/* Header — pair label + stats + create button */}
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h3
            className="font-display font-semibold text-sm inline-flex items-center gap-2"
            style={{ color: 'var(--t1)' }}
          >
            <span>{pair.label} order book</span>
            {refreshing && (
              <RefreshCw size={11} className="animate-spin" style={{ color: 'rgba(238,240,255,0.45)' }} />
            )}
          </h3>
          <p className="text-[11px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
            {totalOpen} open · {filtered.length} shown
            {lastUpdated && (
              <>
                {' '}
                · updated {new Date(lastUpdated).toLocaleTimeString()}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateOrder}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <Plus size={13} />
          New swap
        </button>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div
          className="inline-flex rounded text-[10px] font-display font-semibold"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {(['both', 'sell_irm', 'buy_irm'] as DirectionFilter[]).map((d) => {
            const active = d === direction;
            const label =
              d === 'both' ? 'Both' : d === 'sell_irm' ? `Sell IRM` : `Buy IRM`;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className="px-2.5 py-1 uppercase tracking-wide transition-colors"
                style={{
                  color: active ? pair.accent.text : 'rgba(238,240,255,0.45)',
                  background: active ? pair.accent.glow : 'transparent',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <select
          className="input text-xs"
          value={sort}
          onChange={(e) => setSort(e.target.value as SwapSortKey)}
          style={{ padding: '4px 8px' }}
        >
          <option value="price_asc" style={{ background: '#0f0f23' }}>Best price first</option>
          <option value="price_desc" style={{ background: '#0f0f23' }}>Highest price first</option>
          <option value="recent" style={{ background: '#0f0f23' }}>Newest first</option>
        </select>

        <label className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(238,240,255,0.65)' }}>
          <input
            type="checkbox"
            checked={hideMine}
            onChange={(e) => setHideMine(e.target.checked)}
          />
          Hide my orders
        </label>
      </div>

      {/* Body */}
      {loading && orders.length === 0 ? (
        <div
          className="flex items-center justify-center py-10 text-xs"
          style={{ color: 'rgba(238,240,255,0.55)' }}
        >
          <Loader2 size={14} className="animate-spin mr-2" />
          Loading {pair.label} orders…
        </div>
      ) : error ? (
        <div
          className="px-3 py-2 rounded text-xs"
          style={{
            background: 'rgba(252,211,77,0.10)',
            color: '#fbbf24',
            border: '1px solid rgba(252,211,77,0.25)',
          }}
        >
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
          No open {pair.label} orders. Be the first — post one with the New swap button above.
        </div>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {filtered.map((row) => {
            const isSell = row.direction === 'sell_irm';
            const isMine = myAddresses.has(row.maker_iriumd_address);
            const selected = selectedOrderId === row.order_id;
            const Icon = isSell ? ArrowUpRight : ArrowDownLeft;
            const sideColor = isSell ? '#34d399' : '#6EC6FF';
            return (
              <button
                key={`${row.outpoint.txid}:${row.outpoint.vout}`}
                type="button"
                onClick={() => onSelectOrder(row)}
                className="w-full text-left p-3 rounded transition-colors"
                style={{
                  background: selected ? pair.accent.glow : 'rgba(0,0,0,0.20)',
                  border: selected
                    ? `1px solid ${pair.accent.primary}`
                    : '1px solid rgba(255,255,255,0.04)',
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = 'rgba(0,0,0,0.32)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selected
                    ? pair.accent.glow
                    : 'rgba(0,0,0,0.20)';
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 text-[10px] font-display font-semibold uppercase tracking-wider">
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                      style={{
                        background: `${sideColor}1f`,
                        color: sideColor,
                        border: `1px solid ${sideColor}33`,
                      }}
                    >
                      <Icon size={10} />
                      {isSell ? 'Sells IRM' : 'Buys IRM'}
                    </span>
                    <span style={{ color: 'rgba(238,240,255,0.35)' }}>
                      #{row.order_id.slice(0, 8) || '—'}
                    </span>
                    {isMine && (
                      <span
                        className="px-1.5 py-0.5 rounded"
                        style={{
                          background: 'rgba(167,139,250,0.10)',
                          color: '#A78BFA',
                          border: '1px solid rgba(167,139,250,0.25)',
                        }}
                      >
                        Yours
                      </span>
                    )}
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-display"
                    style={{ color: '#22c55e' }}
                  >
                    <Lock size={10} />
                    Escrow protected
                  </span>
                </div>

                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span
                    className="font-display font-semibold tabular-nums"
                    style={{ fontSize: 22, color: 'var(--t1)', fontFamily: '"JetBrains Mono", monospace' }}
                  >
                    {row.irm_amount_human} IRM
                  </span>
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: pair.accent.text, fontFamily: '"JetBrains Mono", monospace' }}
                  >
                    {row.quote_amount_human}
                  </span>
                </div>

                <div
                  className="mt-1 flex items-center justify-between text-[11px]"
                  style={{ color: 'rgba(238,240,255,0.55)' }}
                >
                  <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {row.implied_quote_per_irm_human}
                  </span>
                  <span>
                    Maker {truncateAddr(row.maker_iriumd_address)} · {relativeAgo(row.opened_at_height, tipHeight)}
                  </span>
                </div>

                <div
                  className="mt-1 text-[10px]"
                  style={{ color: 'rgba(238,240,255,0.40)' }}
                >
                  Needs {row.confirmations_required} confirmation
                  {row.confirmations_required === 1 ? '' : 's'} on the {pair.quote.network ?? pair.quote.name} side
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
