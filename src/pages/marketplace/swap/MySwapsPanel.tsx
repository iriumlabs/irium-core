import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, ArrowRight, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SwapOrderRow, SwapPairConfig } from './pairs/types';

const POLL_INTERVAL_MS = 15_000;

type Tab = 'mine' | 'available' | 'expired';

// FIX BUG 1: in-flight swap hint passed down from SwapPanel. After
// fillOrder consumes the original SwapOrder outpoint, the new
// HtlcBtcSwap outpoint isn't returned by listSwapOrders anymore — so
// MySwapsPanel never sees it, which is why "no open orders" showed
// even though escrow was locked. The parent passes the active swap
// here and we render it as a pinned "Active trade" row at the top of
// the Mine tab.
export interface ActiveSwapHint {
  pairId: string;
  outpoint: { txid: string; vout: number };
  paymentSent: boolean;
  // See SwapPanel's ActiveSwap.role docstring. Drives the "Active trade"
  // row's status text: maker sees "waiting for a buyer" copy, taker sees
  // "send the payment + submit proof" copy.
  role: 'maker' | 'taker';
}

export interface MySwapsPanelProps {
  pair: SwapPairConfig;
  myAddresses: Set<string>;
  activeIriumdAddress: string;
  onOpenOrder: (row: SwapOrderRow) => void;
  refreshTick?: number;
  activeSwap?: ActiveSwapHint | null;
  onOpenActiveSwap?: () => void;
}

function truncateAddr(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MySwapsPanel({
  pair,
  myAddresses,
  activeIriumdAddress,
  onOpenOrder,
  refreshTick = 0,
  activeSwap = null,
  onOpenActiveSwap,
}: MySwapsPanelProps) {
  const [orders, setOrders] = useState<SwapOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('mine');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    if (!pair.available) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      setLoading((prev) => orders.length === 0 ? true : prev);
      try {
        const result = await pair.rpc.listOrders({ direction: 'both', limit: 200 });
        if (cancelled) return;
        setOrders(result.orders);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
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
    // refreshTick lets the parent (e.g. after creating a new order) force a
    // re-fetch without waiting for the next poll cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, refreshTick]);

  const mine = useMemo(
    () => orders.filter((o) => myAddresses.has(o.maker_iriumd_address)),
    [orders, myAddresses],
  );
  const available = useMemo(
    () => orders.filter((o) => !myAddresses.has(o.maker_iriumd_address)),
    [orders, myAddresses],
  );
  const expired = useMemo(() => {
    // Heuristic — if a fresh poll consistently shows expiry_height below the
    // highest opened_at_height we've ever observed, treat as expired.
    if (orders.length === 0) return [];
    const tip = orders.reduce((m, o) => Math.max(m, o.opened_at_height), 0);
    return orders.filter((o) => o.expiry_height > 0 && tip > o.expiry_height);
  }, [orders]);

  const view = tab === 'mine' ? mine : tab === 'available' ? available : expired;

  const handleCancel = async (row: SwapOrderRow) => {
    if (!activeIriumdAddress) {
      toast.error('No active Irium wallet address. Cannot cancel.');
      return;
    }
    setCancellingId(row.order_id);
    try {
      await pair.rpc.cancelOrder({
        order_txid: row.outpoint.txid,
        order_vout: row.outpoint.vout,
        destination_address: activeIriumdAddress,
        broadcast: true,
      });
      toast.success('Order cancelled. Funds will be returned.');
      setOrders((prev) =>
        prev.filter((o) => !(o.outpoint.txid === row.outpoint.txid && o.outpoint.vout === row.outpoint.vout)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  };

  const handleSweep = async (row: SwapOrderRow) => {
    setCancellingId(row.order_id);
    try {
      await pair.rpc.sweepExpiredOrder({
        order_txid: row.outpoint.txid,
        order_vout: row.outpoint.vout,
        broadcast: true,
      });
      toast.success('Expired order swept back to the maker.');
      setOrders((prev) =>
        prev.filter((o) => !(o.outpoint.txid === row.outpoint.txid && o.outpoint.vout === row.outpoint.vout)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div
      className="card p-4 space-y-3"
      style={{ border: '1px solid rgba(167,139,250,0.18)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
          My {pair.label} swaps
        </h3>
        <div
          className="inline-flex rounded text-[10px] font-display font-semibold"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {(['mine', 'available', 'expired'] as Tab[]).map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="px-2 py-1 uppercase tracking-wide transition-colors"
                style={{
                  color: active ? pair.accent.text : 'rgba(238,240,255,0.45)',
                  background: active ? pair.accent.glow : 'transparent',
                }}
              >
                {t === 'mine' ? 'Mine' : t === 'available' ? 'All' : 'Expired'}
              </button>
            );
          })}
        </div>
      </div>

      {/* FIX BUG 1: pinned "Active trade" row on the Mine tab. Renders
          whenever SwapPanel has an in-flight swap for the current pair,
          regardless of whether the user is the maker or the taker — the
          original SwapOrder outpoint is gone from listSwapOrders once
          filled, but the trade is still in progress and the user
          deserves to see it under their own list. */}
      {tab === 'mine' && activeSwap && !error && (
        <div
          className="rounded p-2 text-xs space-y-1.5"
          style={{
            background: 'rgba(34,197,94,0.08)',
            border: `1px solid ${pair.accent.primary}`,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-display font-semibold uppercase tracking-wider"
              style={{
                background: 'rgba(34,197,94,0.15)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.30)',
              }}
            >
              <Activity size={10} />
              Active trade
            </span>
            <span
              className="text-[10px]"
              style={{ color: 'rgba(238,240,255,0.55)', fontFamily: '"JetBrains Mono", monospace' }}
              title={`${activeSwap.outpoint.txid}:${activeSwap.outpoint.vout}`}
            >
              {activeSwap.outpoint.txid.slice(0, 8)}…:{activeSwap.outpoint.vout}
            </span>
          </div>
          <div
            className="text-[11px]"
            style={{ color: 'rgba(238,240,255,0.72)', lineHeight: 1.4 }}
          >
            {activeSwap.role === 'maker'
              ? `${pair.label} sell order is live. Waiting for a buyer to fill it — they will send ${pair.quote.code} to your address and submit the proof on-chain, at which point your IRM releases automatically. No action needed from you.`
              : activeSwap.paymentSent
                ? `${pair.label} swap — proof submitted, waiting for the IRM release to confirm.`
                : `${pair.label} swap — escrow is locked. Send the ${pair.quote.code} payment, then submit the proof from the Swap Progress panel.`}
          </div>
          <button
            type="button"
            onClick={() => onOpenActiveSwap?.()}
            className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[10px]"
          >
            <ArrowRight size={10} />
            Open trade
          </button>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div
          className="flex items-center justify-center py-6 text-xs"
          style={{ color: 'rgba(238,240,255,0.55)' }}
        >
          <Loader2 size={14} className="animate-spin mr-2" />
          Loading…
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
      ) : view.length === 0 ? (
        <div className="text-xs py-4 text-center" style={{ color: 'rgba(238,240,255,0.45)' }}>
          {tab === 'mine'
            ? activeSwap
              ? `You have no other open ${pair.label} orders. Your active trade is shown above.`
              : `You have no open ${pair.label} orders yet. Post one to get started.`
            : tab === 'available'
            ? `No live ${pair.label} orders from other wallets right now.`
            : `No expired ${pair.label} orders waiting to be swept.`}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {view.slice(0, 30).map((row) => (
            <div
              key={`${row.outpoint.txid}:${row.outpoint.vout}`}
              className="rounded p-2 text-xs space-y-1.5"
              style={{
                background: 'rgba(0,0,0,0.20)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <button
                type="button"
                onClick={() => onOpenOrder(row)}
                className="w-full text-left space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-display font-semibold tabular-nums"
                    style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--t1)' }}
                  >
                    {row.irm_amount_human} IRM
                  </span>
                  <span style={{ color: pair.accent.text, fontFamily: '"JetBrains Mono", monospace' }}>
                    {row.quote_amount_human}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between"
                  style={{ color: 'rgba(238,240,255,0.55)' }}
                >
                  <span>{row.direction === 'sell_irm' ? 'Selling IRM' : 'Buying IRM'}</span>
                  <span title={row.maker_iriumd_address}>{truncateAddr(row.maker_iriumd_address)}</span>
                </div>
              </button>

              {tab === 'mine' && (
                <button
                  type="button"
                  onClick={() => handleCancel(row)}
                  disabled={cancellingId === row.order_id}
                  className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[10px]"
                >
                  {cancellingId === row.order_id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <X size={10} />
                  )}
                  Cancel order
                </button>
              )}

              {tab === 'expired' && (
                <button
                  type="button"
                  onClick={() => handleSweep(row)}
                  disabled={cancellingId === row.order_id}
                  className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[10px]"
                >
                  {cancellingId === row.order_id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <X size={10} />
                  )}
                  Sweep back to maker
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
