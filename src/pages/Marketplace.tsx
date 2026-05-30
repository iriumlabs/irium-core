import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useStore } from '../lib/store';
import { offers, agreements, reputation, wallet } from '../lib/tauri';
import type { Offer, Agreement, AddressInfo } from '../lib/types';
import { formatIRM, SATS_PER_IRM, truncateAddr } from '../lib/types';
import NodeOfflineBanner from '../components/NodeOfflineBanner';
import OrderBook from './marketplace/OrderBook';
import TradeCalculator from './marketplace/TradeCalculator';
import TakeOfferModal from './marketplace/TakeOfferModal';
import EscrowProgress from './marketplace/EscrowProgress';
import CreateOrderModal from './marketplace/CreateOrderModal';
import SellerTradeReview from './marketplace/SellerTradeReview';
import ResolverPicker from './marketplace/ResolverPicker';
import SwapPanel from './marketplace/swap/SwapPanel';

type MyTradesTab = 'active' | 'completed' | 'all';
type MarketplaceMode = 'otc' | 'swap';

const ACTIVE_LIFECYCLE_STATES = new Set([
  'draft', 'proposed', 'funded', 'partially_released',
]);
const COMPLETED_LIFECYCLE_STATES = new Set([
  'released', 'refunded', 'expired', 'cancelled', 'disputed_metadata_only',
]);

// OTC marketplace — three-pane container. Order book on the left, trade
// calculator in the middle, my-trades on the right. Taking an offer
// opens the TakeOfferModal (max 2 confirmation clicks). The escrow
// progress tracker mounts under the calculator once a trade is active.
// All hex / agreement JSON / policy detail lives behind the "Details"
// expander inside EscrowProgress; this page stays jargon-free.

const OFFERS_POLL_MS = 10_000;
const AGREEMENTS_POLL_MS = 15_000;

function risk_signal_to_stars(risk: string | undefined): number {
  switch (risk) {
    case 'low': return 5;
    case 'moderate': return 4;
    case 'high': return 2;
    case 'very_high': return 1;
    default: return 3;
  }
}

interface MyTradeRow {
  agreement: Agreement;
  side: 'buying' | 'selling';
}

function classifyTrades(agreementsList: Agreement[], myAddrs: Set<string>): MyTradeRow[] {
  const rows: MyTradeRow[] = [];
  for (const a of agreementsList) {
    // Agreement parties shape varies (typed under Agreement). We probe
    // the common fields: buyer / seller / parties[].
    const probe = a as unknown as {
      buyer?: string;
      seller?: string;
      parties?: { role?: string; address?: string }[];
    };
    if (probe.buyer && myAddrs.has(probe.buyer)) {
      rows.push({ agreement: a, side: 'buying' });
      continue;
    }
    if (probe.seller && myAddrs.has(probe.seller)) {
      rows.push({ agreement: a, side: 'selling' });
      continue;
    }
    if (Array.isArray(probe.parties)) {
      for (const p of probe.parties) {
        const addr = (p.address ?? '').trim();
        if (!addr || !myAddrs.has(addr)) continue;
        const role = (p.role ?? '').toLowerCase();
        if (role === 'buyer' || role === 'payer' || role === 'client') {
          rows.push({ agreement: a, side: 'buying' });
        } else if (role === 'seller' || role === 'payee' || role === 'contractor') {
          rows.push({ agreement: a, side: 'selling' });
        } else {
          rows.push({ agreement: a, side: 'buying' });
        }
        break;
      }
    }
  }
  return rows;
}

function SideBadge({ side }: { side: 'buying' | 'selling' }) {
  const colour = side === 'buying' ? '#6EC6FF' : '#A78BFA';
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-display font-semibold uppercase tracking-wide"
      style={{
        background: `${colour}1f`,
        color: colour,
        border: `1px solid ${colour}33`,
      }}
    >
      {side}
    </span>
  );
}

export default function MarketplacePage() {
  const [offerList, setOfferList] = useState<Offer[]>([]);
  const [myTrades, setMyTrades] = useState<MyTradeRow[]>([]);
  const [myAddrs, setMyAddrs] = useState<Set<string>>(new Set());
  const [activeWalletAddr, setActiveWalletAddr] = useState<string>('');
  const [reputationStars, setReputationStars] = useState<Record<string, number | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  // Create Order modal state — tied only to local UI, no need to persist
  // in zustand since reopening the page should land on a clean modal.
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  // My Trades tab filter (Fix 5). Defaults to active so the user lands
  // on the rows that actually need attention.
  const [myTradesTab, setMyTradesTab] = useState<MyTradesTab>('active');
  // Resolver-picker modal state. Set to a non-null Agreement when the
  // seller-side dispute action fires; the modal then displays the
  // agreement's nominated resolvers + the public registry.
  const [resolverPickerAgreement, setResolverPickerAgreement] = useState<Agreement | null>(null);
  // Top-level mode: OTC (the existing peer-to-peer fiat marketplace) or
  // Swap (multi-pair atomic swap marketplace). Each mode owns a distinct
  // panel; only the mode-strip and page header are shared.
  const [mode, setMode] = useState<MarketplaceMode>('otc');

  const view = useStore((s) => s.marketplaceView);
  const setMarketplaceSelectedOffer = useStore((s) => s.setMarketplaceSelectedOffer);
  const setMarketplaceTakeModalOffer = useStore((s) => s.setMarketplaceTakeModalOffer);
  const setMarketplaceActiveTrade = useStore((s) => s.setMarketplaceActiveTrade);
  const setMarketplaceTradePaymentSent = useStore((s) => s.setMarketplaceTradePaymentSent);

  // Wallet bootstrap. Active wallet address goes to the take-offer
  // buyer field; the full address set is used to classify which side of
  // a stored agreement is "mine".
  useEffect(() => {
    let cancelled = false;
    wallet.listAddresses().then((list: AddressInfo[] | null) => {
      if (cancelled) return;
      const arr = (list ?? []).map((a) => (a.address ?? '').trim()).filter(Boolean);
      setMyAddrs(new Set(arr));
      setActiveWalletAddr(arr[0] ?? '');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Offers poll. Identical cadence to the OrderBook poll, but the
  // OrderBook keeps its own copy so it can render warm cached rows
  // while this top-level fetch updates. We use this list for the
  // TradeCalculator and the seller-reputation lookups.
  useEffect(() => {
    let cancelled = false;
    const tick = async (silent: boolean) => {
      if (cancelled) return;
      if (!silent) setRefreshing(true);
      try {
        const list = await offers.list({ sort: 'amount' });
        if (cancelled) return;
        setOfferList(list ?? []);
        // Background reputation fan-out (cached 60s inside the helper).
        const sellers = Array.from(new Set((list ?? []).map((o) => o.seller).filter(Boolean) as string[]));
        for (const addr of sellers) {
          reputation.show(addr).then((rep) => {
            if (cancelled) return;
            const stars = risk_signal_to_stars((rep as unknown as { risk?: string })?.risk);
            setReputationStars((prev) => (prev[addr] === stars ? prev : { ...prev, [addr]: stars }));
          }).catch(() => undefined);
        }
      } catch { /* silent fail; the OrderBook also surfaces its own errors */ }
      finally {
        if (!silent && !cancelled) setRefreshing(false);
      }
    };
    tick(false);
    const id = setInterval(() => tick(true), OFFERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // My Trades poll.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const list = await agreements.list();
        if (cancelled) return;
        setMyTrades(classifyTrades(list ?? [], myAddrs));
      } catch { /* silent */ }
    };
    tick();
    const id = setInterval(tick, AGREEMENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [myAddrs]);

  const takeModalOffer = useMemo(() => {
    if (!view.takeModalOfferId) return null;
    return offerList.find((o) => o.id === view.takeModalOfferId) ?? null;
  }, [view.takeModalOfferId, offerList]);

  const handleTake = (offer: Offer) => {
    setMarketplaceSelectedOffer(offer.id);
    setMarketplaceTakeModalOffer(offer.id);
  };

  const handleTaken = (agreementId: string) => {
    setMarketplaceActiveTrade(agreementId);
    setMarketplaceTradePaymentSent(true);
    setMarketplaceTakeModalOffer(null);
  };

  const sortedTrades = useMemo(() => {
    const order: Record<string, number> = {
      proposed: 0, funded: 1, partially_released: 2, released: 3,
      refunded: 4, expired: 5, cancelled: 6,
    };
    return [...myTrades].sort((a, b) => {
      const aState = (a.agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown';
      const bState = (b.agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown';
      return (order[aState] ?? 99) - (order[bState] ?? 99);
    });
  }, [myTrades]);

  return (
    <div className="w-full h-full overflow-y-auto px-8 py-6">
      <div className="reading-col" style={{ maxWidth: 1400 }}>
        <NodeOfflineBanner />

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="page-title">Marketplace</h1>
            <p className="page-subtitle">
              {mode === 'otc'
                ? 'Peer-to-peer OTC. Lock IRM in escrow, swap for anything.'
                : 'Atomic swaps between IRM and other chains. Trustless. No bridge.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {refreshing && mode === 'otc' && (
              <RefreshCw
                size={13}
                className="animate-spin"
                style={{ color: 'rgba(238,240,255,0.55)' }}
              />
            )}
            <Link
              to="/settlement-hub"
              className="text-xs inline-flex items-center gap-1.5"
              style={{ color: 'rgba(110,198,255,0.85)' }}
              title="Open the lower-level settlement flows (custom escrow templates, share packages, manual dispute resolution)."
            >
              Advanced flows <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {/* Top-level mode strip — OTC vs Swap. Each mode owns a fully
            distinct panel below; the page header is the only shared chrome. */}
        <div
          className="inline-flex rounded mb-4 text-xs font-display font-semibold"
          style={{
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {(['otc', 'swap'] as MarketplaceMode[]).map((m) => {
            const active = m === mode;
            const accent = m === 'otc' ? '#A78BFA' : '#F7931A';
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="px-4 py-1.5 uppercase tracking-wide transition-colors"
                style={{
                  color: active ? accent : 'rgba(238,240,255,0.55)',
                  background: active
                    ? m === 'otc'
                      ? 'rgba(167,139,250,0.15)'
                      : 'rgba(247,147,26,0.15)'
                    : 'transparent',
                }}
              >
                {m === 'otc' ? 'OTC' : 'Swap'}
              </button>
            );
          })}
        </div>

        {mode === 'swap' ? (
          <SwapPanel />
        ) : (
        <>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)' }}
        >
          {/* LEFT — Order book */}
          <OrderBook
            onTakeOffer={handleTake}
            onCreateOrder={() => setShowCreateOrder(true)}
            selectedOfferId={view.selectedOfferId}
          />

          {/* MIDDLE — Trade calculator + active trade tracker + seller
              verify-and-release inbox. The SellerTradeReview pane
              renders its own empty state when the user has no incoming
              trades, so unconditional mounting is safe. */}
          <div className="space-y-3">
            <TradeCalculator
              offers={offerList}
              onSelectOffer={handleTake}
              reputationStars={reputationStars}
            />
            {view.activeTradeAgreementId && (
              <EscrowProgress
                agreementId={view.activeTradeAgreementId}
                paymentSent={view.tradePaymentSent}
              />
            )}
            <SellerTradeReview
              sellingTrades={myTrades.filter((t) => t.side === 'selling')}
              onDisputeOpened={(agreementId) => {
                const agr = myTrades.find(({ agreement }) => {
                  const id = (agreement as unknown as { agreement_id?: string; id?: string }).agreement_id
                    ?? (agreement as unknown as { id?: string }).id ?? '';
                  return id === agreementId;
                })?.agreement ?? null;
                setResolverPickerAgreement(agr);
              }}
            />
          </div>

          {/* RIGHT — My Trades */}
          <div className="card p-4 space-y-3" style={{ border: '1px solid rgba(167,139,250,0.18)' }}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>My Trades</h3>
              <div className="inline-flex rounded text-[10px] font-display font-semibold" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {(['active', 'completed', 'all'] as MyTradesTab[]).map((tab) => {
                  const isActive = tab === myTradesTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setMyTradesTab(tab)}
                      className="px-2 py-1 uppercase tracking-wide transition-colors"
                      style={{
                        color: isActive ? '#A78BFA' : 'rgba(238,240,255,0.45)',
                        background: isActive ? 'rgba(167,139,250,0.15)' : 'transparent',
                      }}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
            </div>
            {(() => {
              const tabFiltered = sortedTrades.filter(({ agreement }) => {
                if (myTradesTab === 'all') return true;
                const state = ((agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown') as string;
                if (myTradesTab === 'active') return ACTIVE_LIFECYCLE_STATES.has(state);
                return COMPLETED_LIFECYCLE_STATES.has(state);
              });
              if (tabFiltered.length === 0) {
                return (
                  <div className="text-xs py-6 text-center" style={{ color: 'rgba(238,240,255,0.35)' }}>
                    {myTradesTab === 'active'
                      ? 'No active trades. Take an offer from the order book to start.'
                      : myTradesTab === 'completed'
                        ? 'No completed trades yet.'
                        : 'No trades yet. Take an offer from the order book to start.'}
                  </div>
                );
              }
              return (
              <div className="space-y-1.5">
                {tabFiltered.slice(0, 20).map(({ agreement, side }) => {
                  const id = (agreement as unknown as { agreement_id?: string; id?: string }).agreement_id
                    ?? (agreement as unknown as { id?: string }).id ?? '';
                  const state = (agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown';
                  const amount = (agreement as unknown as { total_amount?: number; amount?: number }).total_amount
                    ?? (agreement as unknown as { amount?: number }).amount ?? 0;
                  const active = id === view.activeTradeAgreementId;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMarketplaceActiveTrade(id)}
                      className="w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs transition-colors"
                      style={{
                        background: active ? 'rgba(167,139,250,0.10)' : 'transparent',
                        color: 'var(--t1)',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(167,139,250,0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'rgba(167,139,250,0.10)' : 'transparent'; }}
                    >
                      <SideBadge side={side} />
                      <span className="tabular-nums" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                        {formatIRM(amount)}
                      </span>
                      <span style={{ color: 'rgba(238,240,255,0.45)' }}>{truncateAddr(id || '—')}</span>
                      <span style={{ color: 'rgba(238,240,255,0.55)', fontVariantCaps: 'small-caps' }}>{state}</span>
                    </button>
                  );
                })}
              </div>
              );
            })()}
          </div>
        </div>

        {showCreateOrder && (
          <CreateOrderModal
            sellerAddress={activeWalletAddr}
            onClose={() => setShowCreateOrder(false)}
            onCreated={() => {
              // Trigger a refresh on the next poll tick — the OrderBook
              // and offerList poll on their own cadences, so we don't
              // need to fire a manual fetch here.
            }}
          />
        )}

        {takeModalOffer && (
          <TakeOfferModal
            offer={takeModalOffer}
            buyerAddress={activeWalletAddr}
            onClose={() => setMarketplaceTakeModalOffer(null)}
            onTaken={handleTaken}
          />
        )}

        {resolverPickerAgreement && (
          <ResolverPicker
            agreement={resolverPickerAgreement}
            onClose={() => setResolverPickerAgreement(null)}
          />
        )}
        </>
        )}
      </div>
    </div>
  );
}
