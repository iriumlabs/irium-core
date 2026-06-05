import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { wallet } from '../../../lib/tauri';
import { useStore } from '../../../lib/store';
import type { AddressInfo } from '../../../lib/types';
import PairSwitcher from './PairSwitcher';
import ComingSoonOverlay from './ComingSoonOverlay';
import PairOrderBook from './PairOrderBook';
import CreateSwapOrderModal from './CreateSwapOrderModal';
import TakeSwapOrderModal from './TakeSwapOrderModal';
import SwapProgress, { type SwapLifecycle } from './SwapProgress';
import MySwapsPanel from './MySwapsPanel';
import PriceChart from './PriceChart';
import { ActivePairContext, type ActivePairContextValue } from './hooks/useActivePair';
import { usePairAvailability } from './hooks/usePairAvailability';
import { SWAP_PAIRS, defaultPair, getPairById } from './pairs';
import type { SwapOrderRow, SwapTxResult } from './pairs/types';

// Top-level container for the multi-pair Swap marketplace.
// Layout matches the OTC Marketplace page so the user feels at home:
//   PairSwitcher (full width)
//   PriceChart (full width)
//   3-column grid: PairOrderBook | SwapProgress | MySwapsPanel
//
// Coming-soon pairs replace the order book / chart / panels with a single
// ComingSoonOverlay so there is exactly one clear next step.

interface ActiveSwap {
  pairId: string;
  outpoint: { txid: string; vout: number };
  paymentSent: boolean;
  // Which side of the trade the local user is on. Drives the role-aware
  // status copy in SwapProgress and the maker/taker text in MySwapsPanel's
  // Active-trade row. Set explicitly at each entry point: handleOrderCreated
  // -> 'maker', handleOrderFilled -> 'taker'.
  role: 'maker' | 'taker';
}

// localStorage key for cross-navigation persistence of the in-flight swap.
// Versioned so future shape bumps stay backward-compatible with older
// clients (old entries are silently discarded by the shape guard).
const ACTIVE_SWAP_STORAGE_KEY = 'irium.marketplace.swap.activeSwap.v1';

function readPersistedActiveSwap(): ActiveSwap | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SWAP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveSwap>;
    if (
      typeof parsed.pairId === 'string' &&
      parsed.outpoint &&
      typeof parsed.outpoint.txid === 'string' &&
      typeof parsed.outpoint.vout === 'number' &&
      typeof parsed.paymentSent === 'boolean'
    ) {
      // Legacy entries (pre role-fix) lack the role field; default to
      // 'maker' since rendering the taker proof form to a maker is the
      // bug we are fixing — maker UI is the safer default. Post-fix
      // sessions write the role field explicitly.
      const role: 'maker' | 'taker' = parsed.role === 'taker' ? 'taker' : 'maker';
      return {
        pairId: parsed.pairId,
        outpoint: parsed.outpoint as { txid: string; vout: number },
        paymentSent: parsed.paymentSent,
        role,
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface SwapPanelProps {
  // Pair id requested by the Marketplace page after the user picks a swap
  // option from the OrderTypePickerModal. SwapPanel keeps its own internal
  // active pair state so the user can switch pairs from PairSwitcher while
  // staying on the page, but a fresh externally-requested id always wins
  // (handled by the effect below).
  requestedPairId?: string;
}

export default function SwapPanel({ requestedPairId }: SwapPanelProps = {}) {
  const { t } = useTranslation();
  const [activePairId, setActivePairId] = useState<string>(defaultPair().id);
  const [myAddrs, setMyAddrs] = useState<Set<string>>(new Set());
  const [activeWalletAddr, setActiveWalletAddr] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [takeTarget, setTakeTarget] = useState<SwapOrderRow | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeSwap, setActiveSwap] = useState<ActiveSwap | null>(readPersistedActiveSwap);
  const [refreshTick, setRefreshTick] = useState(0);
  // FIX 2: tracks whether the freshly-broadcast order has been included in
  // an Irium block yet. Flipped on by handleOrderCreated and flipped off
  // by the post-create polling useEffect once the outpoint appears in
  // listOrders. Drives SwapProgress's "Waiting for confirmation (~2 min)"
  // copy.
  const [pendingOrderConfirmation, setPendingOrderConfirmation] = useState(false);

  const activePair = useMemo(
    () => getPairById(activePairId) ?? defaultPair(),
    [activePairId],
  );

  // External pair request (from the Marketplace OrderTypePickerModal).
  // Switch pairs AND auto-open the Create Swap Order modal so the user can
  // start a swap in one click instead of two. Tracked via lastHandledRef so
  // re-renders with the same id don't re-fire the modal after the user has
  // closed it. The {showCreate && availability.available && ...} gate below
  // means setShowCreate(true) is a no-op for chain-gated pairs (LTC pre-25k,
  // DOGE pre-25.2k) — the user just sees the ComingSoonOverlay with the
  // countdown, which is the intended fallback.
  const lastHandledRequestedPairRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!requestedPairId) return;
    if (lastHandledRequestedPairRef.current === requestedPairId) return;
    if (!getPairById(requestedPairId)) return;
    setActivePairId(requestedPairId);
    setShowCreate(true);
    lastHandledRequestedPairRef.current = requestedPairId;
  }, [requestedPairId]);
  const availability = usePairAvailability(activePair);

  // Wallet bootstrap — same shape as the OTC Marketplace page.
  useEffect(() => {
    let cancelled = false;
    wallet
      .listAddresses()
      .then((list: AddressInfo[] | null) => {
        if (cancelled) return;
        const arr = (list ?? []).map((a) => (a.address ?? '').trim()).filter(Boolean);
        setMyAddrs(new Set(arr));
        setActiveWalletAddr(arr[0] ?? '');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror activeSwap to localStorage so navigation away from /marketplace
  // and back restores the in-flight swap instead of silently dropping it.
  // Storage failures (full quota, disabled storage) are non-fatal — the
  // tracker just loses persistence for this turn.
  useEffect(() => {
    try {
      if (activeSwap) {
        localStorage.setItem(ACTIVE_SWAP_STORAGE_KEY, JSON.stringify(activeSwap));
      } else {
        localStorage.removeItem(ACTIVE_SWAP_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [activeSwap]);

  // FIX 2: after postOrder broadcasts, the new outpoint takes about one
  // Irium block (~2 min) to appear in listOrders. Poll listOrders every
  // 15s while pendingOrderConfirmation is true; flip it off and bump
  // refreshTick the moment we see our outpoint so MySwapsPanel and
  // PairOrderBook re-render with the confirmed order instead of waiting
  // for their own poll ticks. Polling is pinned to the pair the order
  // was created on (activeSwap.pairId) rather than the currently
  // displayed pair, so switching pairs while waiting does not break the
  // detection. Errors are silent because the order book panels already
  // surface their own listOrders failures and duplicating the toast
  // here would be noisy.
  useEffect(() => {
    if (!pendingOrderConfirmation || !activeSwap) return;
    const pairForSwap = getPairById(activeSwap.pairId);
    if (!pairForSwap) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await pairForSwap.rpc.listOrders({
          direction: 'both',
          limit: 200,
        });
        if (cancelled) return;
        const found = result.orders.some(
          (o) =>
            o.outpoint.txid === activeSwap.outpoint.txid &&
            o.outpoint.vout === activeSwap.outpoint.vout,
        );
        if (found) {
          setPendingOrderConfirmation(false);
          setRefreshTick((n) => n + 1);
        }
      } catch {
        // silent — the next tick retries
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pendingOrderConfirmation, activeSwap]);

  const ctxValue: ActivePairContextValue = useMemo(
    () => ({
      pair: activePair,
      setPairById: setActivePairId,
      allPairs: SWAP_PAIRS,
    }),
    [activePair],
  );

  const handleOrderCreated = useCallback((result: SwapTxResult) => {
    setRefreshTick((n) => n + 1);
    if (result.order_outpoint) {
      setActiveSwap({
        pairId: activePairId,
        outpoint: result.order_outpoint,
        paymentSent: false,
        role: 'maker',
      });
      // FIX 2: the order has been broadcast but is not yet in a block;
      // surface "Waiting for confirmation (~2 min)" in SwapProgress until
      // the post-create polling useEffect sees the outpoint land in
      // listOrders. setActiveSwap above and this flag together cover the
      // gap between modal close and order-book confirmation.
      setPendingOrderConfirmation(true);
    }
  }, [activePairId]);

  const handleOrderFilled = useCallback((result: SwapTxResult, opts?: { keepOpen?: boolean }) => {
    setRefreshTick((n) => n + 1);
    const outpoint = result.new_swap_outpoint ?? result.order_outpoint;
    if (outpoint) {
      setActiveSwap({
        pairId: activePairId,
        outpoint,
        role: 'taker',
        // FIX BUG 3: when called immediately after step 1 (fillOrder
        // success, escrow funded but payment not yet sent), keepOpen=true
        // and paymentSent stays false so SwapProgress surfaces the
        // "send the payment, then submit proof" copy. When called from
        // step 3 (after claim submission), keepOpen is undefined and
        // paymentSent flips true (existing semantics).
        paymentSent: opts?.keepOpen ? false : true,
      });
    }
    // FIX BUG 3: keep TakeSwapOrderModal mounted when the early step-1
    // signal fires so the user can continue through steps 2 and 3 in the
    // same modal. Only close after the terminal call (proof submitted or
    // explicit cancel).
    if (!opts?.keepOpen) {
      setTakeTarget(null);
    }
  }, [activePairId]);

  // FIX BUG 1: scroll the SwapProgress card into view and trigger a
  // brief pulse highlight when the user clicks "Open trade" on the
  // synthesized active-swap row in MySwapsPanel. The ref points at the
  // wrapper div that holds SwapProgress; the auto-clear useEffect below
  // resets the pulse 1.4s after each trigger so repeated clicks re-fire
  // the animation cleanly.
  const swapProgressRef = useRef<HTMLDivElement>(null);
  const [pulseSwapProgress, setPulseSwapProgress] = useState(false);
  useEffect(() => {
    if (!pulseSwapProgress) return;
    const t = setTimeout(() => setPulseSwapProgress(false), 1400);
    return () => clearTimeout(t);
  }, [pulseSwapProgress]);

  const handleOpenActiveSwap = useCallback(() => {
    if (swapProgressRef.current) {
      swapProgressRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setPulseSwapProgress(true);
  }, []);

  // fetchStatus for the SwapProgress tracker. Without this prop wired, the
  // tracker's polling useEffect early-returns and `life` stays at 'unknown',
  // which surfaces the "Status pending. The node has not yet reported this
  // trade." default copy. Map the order existence + expiry to a coarse
  // lifecycle (funded / expired). Richer states — released, refunded,
  // cancelled — require a server-side swap-status endpoint and are filed
  // as v1.9.50 work on iriumlabs/irium.
  const tipHeight = useStore((s) => s.nodeStatus?.height ?? 0);
  const fetchSwapStatus = useCallback(
    async (outpoint: { txid: string; vout: number }): Promise<{ lifecycle?: SwapLifecycle }> => {
      try {
        const order = await activePair.rpc.getOrder(outpoint.txid, outpoint.vout);
        if (order && order.expiry_height > 0 && tipHeight > order.expiry_height) {
          return { lifecycle: 'expired' };
        }
        // Whether the outpoint is the open-order (taker hasn't filled yet)
        // or the post-fill HtlcBtcSwap, 'funded' is the most informative
        // coarse state and drives statusSentence's "Escrow is locked..." /
        // "Waiting for the payment to confirm..." copy.
        return { lifecycle: 'funded' };
      } catch {
        return { lifecycle: 'funded' };
      }
    },
    [activePair, tipHeight],
  );

  const handleSelectOrder = useCallback((row: SwapOrderRow) => {
    setSelectedOrderId(row.order_id);
    if (!activePair.available) {
      toast.error(
        activePair.comingSoonReason ?? t('marketplace.swap.pair_not_available'),
      );
      return;
    }
    if (myAddrs.has(row.maker_iriumd_address)) {
      // Tapping your own order opens it for inspection but does not take it.
      toast(t('marketplace.swap.own_order_hint'), {
        icon: 'i',
      });
      return;
    }
    setTakeTarget(row);
  }, [activePair, myAddrs]);

  return (
    <ActivePairContext.Provider value={ctxValue}>
      <div className="space-y-3">
        {/* IRM-as-settlement-fuel banner — frames the Spot Swap as a way
            to acquire IRM for downstream Settlement use, not just an end
            in itself. */}
        <div className="bg-[#fcd535]/10 border border-[#fcd535]/30 rounded-lg px-3 py-2 text-[12px] text-[#eaecef]">
          <span className="font-semibold text-[#fcd535]">{t('marketplace.swap.fuel_banner_title')}</span>{' '}
          <span className="text-[#b7bdc6]">{t('marketplace.swap.fuel_banner_body')}</span>
        </div>

        <PairSwitcher
          pairs={SWAP_PAIRS}
          activeId={activePairId}
          onSelect={setActivePairId}
          tipHeight={tipHeight}
        />

        {!availability.available ? (
          <ComingSoonOverlay
            pair={activePair}
            reason={availability.reason ?? t('marketplace.swap.not_available_yet')}
          />
        ) : (
          <>
            <PriceChart pair={activePair} />

            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)' }}
            >
              <PairOrderBook
                pair={activePair}
                selectedOrderId={selectedOrderId}
                onSelectOrder={handleSelectOrder}
                onCreateOrder={() => setShowCreate(true)}
                myAddresses={myAddrs}
                refreshTick={refreshTick}
                pendingActiveSwap={
                  pendingOrderConfirmation &&
                  activeSwap &&
                  activeSwap.pairId === activePairId &&
                  activeSwap.role === 'maker'
                    ? { outpoint: activeSwap.outpoint }
                    : null
                }
              />

              <div className="space-y-3">
                {activeSwap && activeSwap.pairId === activePairId ? (
                  // FIX BUG 1: wrapper for scroll-into-view + pulse
                  // highlight when "Open trade" is clicked in MySwapsPanel.
                  // Box-shadow transitions ~250ms; the pulse stays on for
                  // ~1.4s before the useEffect auto-clears it.
                  <div
                    ref={swapProgressRef}
                    style={{
                      transition: 'box-shadow 250ms ease',
                      boxShadow: pulseSwapProgress
                        ? `0 0 0 2px ${activePair.accent.primary}, 0 0 24px ${activePair.accent.glow}`
                        : '0 0 0 0 rgba(0,0,0,0)',
                      borderRadius: 8,
                    }}
                  >
                    <SwapProgress
                      pair={activePair}
                      swapOutpoint={activeSwap.outpoint}
                      paymentSent={activeSwap.paymentSent}
                      pendingConfirmation={pendingOrderConfirmation}
                      fetchStatus={fetchSwapStatus}
                      takerIriumdAddress={activeWalletAddr}
                      role={activeSwap.role}
                    />
                  </div>
                ) : !activeSwap ? (
                  <div className="bg-[#181a20] border border-[#2b3139] rounded-lg p-4 text-[12px] text-[#b7bdc6] leading-relaxed">
                    <div className="text-[13px] font-semibold text-[#eaecef] mb-2">
                      {t('marketplace.swap.how_it_works_title', { pair: activePair.label })}
                    </div>
                    <ol className="list-decimal pl-4 space-y-1 text-[#b7bdc6]">
                      <li>{t('marketplace.swap.how_it_works_step1')}</li>
                      <li>{t('marketplace.swap.how_it_works_step2')}</li>
                      <li>{t('marketplace.swap.how_it_works_step3', { quote: activePair.quote.code })}</li>
                      <li>{t('marketplace.swap.how_it_works_step4')}</li>
                    </ol>
                  </div>
                ) : null}
              </div>

              <MySwapsPanel
                pair={activePair}
                myAddresses={myAddrs}
                activeIriumdAddress={activeWalletAddr}
                onOpenOrder={handleSelectOrder}
                refreshTick={refreshTick}
                activeSwap={activeSwap && activeSwap.pairId === activePairId ? activeSwap : null}
                onOpenActiveSwap={handleOpenActiveSwap}
              />
            </div>
          </>
        )}

        {showCreate && availability.available && (
          <CreateSwapOrderModal
            pair={activePair}
            makerIriumdAddress={activeWalletAddr}
            onClose={() => setShowCreate(false)}
            onCreated={handleOrderCreated}
          />
        )}

        {takeTarget && availability.available && (
          <TakeSwapOrderModal
            pair={activePair}
            order={takeTarget}
            takerIriumdAddress={activeWalletAddr}
            onClose={() => setTakeTarget(null)}
            onFilled={handleOrderFilled}
          />
        )}
      </div>
    </ActivePairContext.Provider>
  );
}
