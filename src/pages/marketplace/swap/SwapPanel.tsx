import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { wallet } from '../../../lib/tauri';
import type { AddressInfo } from '../../../lib/types';
import PairSwitcher from './PairSwitcher';
import ComingSoonOverlay from './ComingSoonOverlay';
import PairOrderBook from './PairOrderBook';
import CreateSwapOrderModal from './CreateSwapOrderModal';
import TakeSwapOrderModal from './TakeSwapOrderModal';
import SwapProgress from './SwapProgress';
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

export default function SwapPanel() {
  const [activePairId, setActivePairId] = useState<string>(defaultPair().id);
  const [myAddrs, setMyAddrs] = useState<Set<string>>(new Set());
  const [activeWalletAddr, setActiveWalletAddr] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [takeTarget, setTakeTarget] = useState<SwapOrderRow | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeSwap, setActiveSwap] = useState<ActiveSwap | null>(null);
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
                  />
                )}
                {!activeSwap && (
                  <div
                    className="card p-4 text-xs"
                    style={{
                      border: '1px solid rgba(110,198,255,0.18)',
                      color: 'rgba(238,240,255,0.55)',
                      lineHeight: 1.6,
                    }}
                  >
                    <div
                      className="font-display font-semibold text-sm mb-1"
                      style={{ color: 'var(--t1)' }}
                    >
                      How {activePair.label} swaps work
                    </div>
                    <ol
                      className="list-decimal pl-4 space-y-1"
                      style={{ color: 'rgba(238,240,255,0.65)' }}
                    >
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
