import { useCallback, useEffect, useMemo, useState } from 'react';
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
      return parsed as ActiveSwap;
    }
    return null;
  } catch {
    return null;
  }
}

export default function SwapPanel() {
  const { t } = useTranslation();
  const [activePairId, setActivePairId] = useState<string>(defaultPair().id);
  const [myAddrs, setMyAddrs] = useState<Set<string>>(new Set());
  const [activeWalletAddr, setActiveWalletAddr] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [takeTarget, setTakeTarget] = useState<SwapOrderRow | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeSwap, setActiveSwap] = useState<ActiveSwap | null>(readPersistedActiveSwap);
  const [refreshTick, setRefreshTick] = useState(0);

  const activePair = useMemo(
    () => getPairById(activePairId) ?? defaultPair(),
    [activePairId],
  );
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
      });
    }
  }, [activePairId]);

  const handleOrderFilled = useCallback((result: SwapTxResult) => {
    setRefreshTick((n) => n + 1);
    const outpoint = result.new_swap_outpoint ?? result.order_outpoint;
    if (outpoint) {
      setActiveSwap({
        pairId: activePairId,
        outpoint,
        paymentSent: true,
      });
    }
    setTakeTarget(null);
  }, [activePairId]);

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
        activePair.comingSoonReason ?? 'This pair is not available yet',
      );
      return;
    }
    if (myAddrs.has(row.maker_iriumd_address)) {
      // Tapping your own order opens it for inspection but does not take it.
      toast('That is your own order. Use the My Swaps panel on the right to cancel it.', {
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
        />

        {!availability.available ? (
          <ComingSoonOverlay
            pair={activePair}
            reason={availability.reason ?? 'Not available yet'}
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
              />

              <div className="space-y-3">
                {activeSwap && activeSwap.pairId === activePairId && (
                  <SwapProgress
                    pair={activePair}
                    swapOutpoint={activeSwap.outpoint}
                    paymentSent={activeSwap.paymentSent}
                    fetchStatus={fetchSwapStatus}
                  />
                )}
                {!activeSwap && (
                  <div className="bg-[#181a20] border border-[#2b3139] rounded-lg p-4 text-[12px] text-[#b7bdc6] leading-relaxed">
                    <div className="text-[13px] font-semibold text-[#eaecef] mb-2">
                      How {activePair.label} swaps work
                    </div>
                    <ol className="list-decimal pl-4 space-y-1 text-[#b7bdc6]">
                      <li>Pick an order from the book on the left, or post your own.</li>
                      <li>
                        The seller&apos;s IRM is locked in escrow the moment the order is taken.
                      </li>
                      <li>
                        The buyer sends {activePair.quote.code} to the seller&apos;s address.
                      </li>
                      <li>
                        Once the payment confirms, the IRM is released to the buyer
                        automatically.
                      </li>
                    </ol>
                  </div>
                )}
              </div>

              <MySwapsPanel
                pair={activePair}
                myAddresses={myAddrs}
                activeIriumdAddress={activeWalletAddr}
                onOpenOrder={handleSelectOrder}
                refreshTick={refreshTick}
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
