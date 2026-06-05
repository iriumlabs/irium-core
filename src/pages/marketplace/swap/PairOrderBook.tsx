import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, Plus, Lock, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import type {
  ListOrdersResult,
  SwapDirection,
  SwapOrderRow,
  SwapPairConfig,
  SwapSortKey,
} from './pairs/types';
import { TimestampDisplay } from '../../../components/ui';

const POLL_INTERVAL_MS = 10_000;

type DirectionFilter = SwapDirection | 'both';

export interface PairOrderBookProps {
  pair: SwapPairConfig;
  selectedOrderId?: string | null;
  onSelectOrder: (row: SwapOrderRow) => void;
  onCreateOrder: () => void;
  myAddresses: Set<string>;
  // FIX 2: parent bumps this counter when something happens that should
  // force an immediate re-poll of listOrders (e.g. SwapPanel's post-create
  // polling sees the new outpoint confirmed). Default 0 means existing
  // callers without the prop keep the pre-FIX-2 10-second poll cadence.
  refreshTick?: number;
}

function truncateAddr(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function relativeAgo(
  opened: number,
  tip: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!opened || !tip) return t('marketplace.pair_order_book.relative_recent');
  const diff = Math.max(0, tip - opened);
  if (diff === 0) return t('marketplace.pair_order_book.relative_just_now');
  if (diff < 60) return t('marketplace.pair_order_book.relative_blocks_ago', { count: diff });
  const hours = Math.floor(diff / 60);
  if (hours < 24) return t('marketplace.pair_order_book.relative_hours_ago', { count: hours });
  return t('marketplace.pair_order_book.relative_days_ago', { count: Math.floor(hours / 24) });
}

export default function PairOrderBook({
  pair,
  selectedOrderId,
  onSelectOrder,
  onCreateOrder,
  myAddresses,
  refreshTick = 0,
}: PairOrderBookProps) {
  const { t } = useTranslation();
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
        // FIX BUG 2: surface server/client shape mismatches for debugging.
        // If the node reports N open orders but returns an empty rows
        // array (or vice versa), we want a console trail so a debug
        // session can grab the raw RPC response. The visible empty
        // state below also shows a "X orders reported, none visible —
        // Reset filters" hint so the user can recover without devtools.
        if (result.total_open > 0 && result.orders.length === 0) {
          console.warn(
            `[PairOrderBook] listOrders reports total_open=${result.total_open}` +
              ` but returned 0 rows for pair=${pair.id} direction=${direction}.` +
              ` Server/client shape mismatch suspected — capture the raw response from` +
              ` /rpc/listswaporders for diagnosis.`,
          );
        }
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
  }, [pair, direction, sort, refreshTick]);

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
            <span>{t('marketplace.pair_order_book.header_title', { pair: pair.label })}</span>
            {refreshing && (
              <RefreshCw size={11} className="animate-spin" style={{ color: 'rgba(238,240,255,0.45)' }} />
            )}
          </h3>
          <p className="text-[11px]" style={{ color: 'rgba(238,240,255,0.45)' }}>
            {t('marketplace.pair_order_book.open_shown_summary', { open: totalOpen, shown: filtered.length })}
            {lastUpdated && (
              <>
                {' '}
                · {t('marketplace.pair_order_book.updated_label')} <TimestampDisplay epoch={lastUpdated} format="time" />
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
          {t('marketplace.pair_order_book.new_swap')}
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
              d === 'both'
                ? t('marketplace.pair_order_book.direction_both')
                : d === 'sell_irm'
                ? t('marketplace.pair_order_book.direction_sell_irm')
                : t('marketplace.pair_order_book.direction_buy_irm');
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
          <option value="price_asc" style={{ background: '#0f0f23' }}>{t('marketplace.pair_order_book.sort_price_asc')}</option>
          <option value="price_desc" style={{ background: '#0f0f23' }}>{t('marketplace.pair_order_book.sort_price_desc')}</option>
          <option value="recent" style={{ background: '#0f0f23' }}>{t('marketplace.pair_order_book.sort_recent')}</option>
        </select>

        <label className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(238,240,255,0.65)' }}>
          <input
            type="checkbox"
            checked={hideMine}
            onChange={(e) => setHideMine(e.target.checked)}
          />
          {t('marketplace.pair_order_book.hide_my_orders')}
        </label>
      </div>

      {/* Body */}
      {loading && orders.length === 0 ? (
        <div
          className="flex items-center justify-center py-10 text-xs"
          style={{ color: 'rgba(238,240,255,0.55)' }}
        >
          <Loader2 size={14} className="animate-spin mr-2" />
          {t('marketplace.pair_order_book.loading_orders', { pair: pair.label })}
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
        // FIX BUG 2: when the node reports orders exist (totalOpen > 0)
        // or rows came back but all got filtered out locally (orders.length
        // > 0 with hideMine on), the previous "No live orders" copy was
        // misleading — the user couldn't tell whether the market was empty
        // or whether filters were hiding everything. Show a discrepancy
        // hint + Reset filters button so the user can recover with one
        // click instead of having to manually retoggle BOTH and the
        // hide-mine checkbox.
        <div className="py-8 text-center text-xs space-y-3" style={{ color: 'rgba(238,240,255,0.45)' }}>
          {totalOpen > 0 || orders.length > 0 ? (
            <>
              <div>
                {orders.length > 0
                  ? `${orders.length} order${orders.length === 1 ? '' : 's'} returned, but your filters hid them all.`
                  : `The node reports ${totalOpen} open order${totalOpen === 1 ? '' : 's'} but returned no rows. ` +
                    `Filters or a stale local response may be hiding them.`}
              </div>
              <button
                type="button"
                onClick={() => { setDirection('both'); setHideMine(false); }}
                className="btn-secondary inline-flex items-center gap-1 text-[11px] px-2 py-1"
              >
                <RefreshCw size={11} /> Reset filters
              </button>
            </>
          ) : (
            t('marketplace.pair_order_book.empty_state', { pair: pair.label })
          )}
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
                      {isSell
                        ? t('marketplace.pair_order_book.side_sells_irm')
                        : t('marketplace.pair_order_book.side_buys_irm')}
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
                        {t('marketplace.pair_order_book.badge_yours')}
                      </span>
                    )}
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-display"
                    style={{ color: '#22c55e' }}
                  >
                    <Lock size={10} />
                    {t('marketplace.pair_order_book.escrow_protected')}
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
                    {t('marketplace.pair_order_book.maker_line', {
                      address: truncateAddr(row.maker_iriumd_address),
                      ago: relativeAgo(row.opened_at_height, tipHeight, t),
                    })}
                  </span>
                </div>

                <div
                  className="mt-1 text-[10px]"
                  style={{ color: 'rgba(238,240,255,0.40)' }}
                >
                  {t('marketplace.pair_order_book.needs_confirmations', {
                    count: row.confirmations_required,
                    network: pair.quote.network ?? pair.quote.name,
                  })}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
