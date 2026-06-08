import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useStore } from '../lib/store';
import { offers, agreements, reputation, wallet } from '../lib/tauri';
import type { Offer, Agreement, AddressInfo } from '../lib/types';
import { formatIRM } from '../lib/types';
import NodeOfflineBanner from '../components/NodeOfflineBanner';
import OrderBook from './marketplace/OrderBook';
import TradeCalculator from './marketplace/TradeCalculator';
import TakeOfferModal from './marketplace/TakeOfferModal';
import EscrowProgress from './marketplace/EscrowProgress';
import CreateOrderModal from './marketplace/CreateOrderModal';
import OrderTypePickerModal, { type OrderTypeChoice } from './marketplace/OrderTypePickerModal';
import SellerTradeReview from './marketplace/SellerTradeReview';
import ResolverPicker from './marketplace/ResolverPicker';
import SwapPanel from './marketplace/swap/SwapPanel';
import { Pill, Tabs } from '../components/ui';

type MyTradesTab = 'active' | 'completed' | 'all';
type MarketplaceMode = 'otc' | 'swap';

const ACTIVE_LIFECYCLE_STATES = new Set([
  'draft', 'proposed', 'funded', 'partially_released',
]);
const COMPLETED_LIFECYCLE_STATES = new Set([
  'released', 'refunded', 'expired', 'cancelled', 'disputed_metadata_only',
]);

// Marketplace — Binance-style trading surface.
//
// Top header: page title + ticker-context strip + Tabs selector for
// OTC / Swap mode. Body: three-pane grid (OrderBook | TradeCalculator +
// active trade widgets | My Trades).
//
// Polling cadences and RPC calls are unchanged from the prior design;
// only presentation tokens, layout, and primitive components rotate.

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

// Lifecycle → status pill. The visual intent line groups the lifecycle
// states into the four buckets the trade UI surfaces: warn (in flight),
// success (released), danger (disputed/failed), neutral (drafting).
function statusPillFor(state: string, t: (key: string) => string) {
  if (state === 'released') return { intent: 'success' as const, label: t('marketplace.trade_status.released') };
  if (state === 'refunded') return { intent: 'danger' as const, label: t('marketplace.trade_status.refunded') };
  if (state === 'expired') return { intent: 'danger' as const, label: t('marketplace.trade_status.expired') };
  if (state === 'cancelled') return { intent: 'danger' as const, label: t('marketplace.trade_status.cancelled') };
  if (state === 'disputed_metadata_only') return { intent: 'danger' as const, label: t('marketplace.trade_status.disputed') };
  if (state === 'partially_released') return { intent: 'warn' as const, label: t('marketplace.trade_status.confirming') };
  if (state === 'funded') return { intent: 'warn' as const, label: t('marketplace.trade_status.locked') };
  if (state === 'proposed') return { intent: 'info' as const, label: t('marketplace.trade_status.proposed') };
  if (state === 'draft') return { intent: 'neutral' as const, label: t('marketplace.trade_status.drafting') };
  return { intent: 'neutral' as const, label: state };
}

function shortId(s: string): string {
  if (!s) return '—';
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export default function MarketplacePage() {
  const { t } = useTranslation();
  const [offerList, setOfferList] = useState<Offer[]>([]);
  const [myTrades, setMyTrades] = useState<MyTradeRow[]>([]);
  const [myAddrs, setMyAddrs] = useState<Set<string>>(new Set());
  const [activeWalletAddr, setActiveWalletAddr] = useState<string>('');
  const [reputationStars, setReputationStars] = useState<Record<string, number | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showOrderTypePicker, setShowOrderTypePicker] = useState(false);
  // Pair id requested from the OrderTypePickerModal (swap-btc / swap-ltc).
  // Forwarded to <SwapPanel> so it switches to the matching pair on the next
  // render. Bumping a counter on every pick (even if the same pair was already
  // active) would be overkill — SwapPanel's effect handles duplicate ids as a
  // no-op.
  const [requestedSwapPairId, setRequestedSwapPairId] = useState<string | undefined>(undefined);
  const [myTradesTab, setMyTradesTab] = useState<MyTradesTab>('active');
  const [resolverPickerAgreement, setResolverPickerAgreement] = useState<Agreement | null>(null);
  const [mode, setMode] = useState<MarketplaceMode>('otc');

  const handleOrderTypePicked = (choice: OrderTypeChoice) => {
    setShowOrderTypePicker(false);
    if (choice === 'otc') {
      setShowCreateOrder(true);
      return;
    }
    // Swap option: switch mode + pre-select pair. LTC lands on the Coming
    // Soon overlay until its activation height; BTC lands on the live order book.
    const pairId = choice === 'swap-btc' ? 'IRM_BTC' : 'IRM_LTC';
    setRequestedSwapPairId(pairId);
    setMode('swap');
  };

  const view = useStore((s) => s.marketplaceView);
  const setMarketplaceSelectedOffer = useStore((s) => s.setMarketplaceSelectedOffer);
  const setMarketplaceTakeModalOffer = useStore((s) => s.setMarketplaceTakeModalOffer);
  const setMarketplaceActiveTrade = useStore((s) => s.setMarketplaceActiveTrade);
  const setMarketplaceTradePaymentSent = useStore((s) => s.setMarketplaceTradePaymentSent);

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

  useEffect(() => {
    let cancelled = false;
    const tick = async (silent: boolean) => {
      if (cancelled) return;
      if (!silent) setRefreshing(true);
      try {
        const list = await offers.list({ sort: 'amount' });
        if (cancelled) return;
        setOfferList(list ?? []);
        const sellers = Array.from(new Set((list ?? []).map((o) => o.seller).filter(Boolean) as string[]));
        for (const addr of sellers) {
          reputation.show(addr).then((rep) => {
            if (cancelled) return;
            const stars = risk_signal_to_stars((rep as unknown as { risk?: string })?.risk);
            setReputationStars((prev) => (prev[addr] === stars ? prev : { ...prev, [addr]: stars }));
          }).catch(() => undefined);
        }
      } catch { /* silent */ }
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

  const tabFiltered = useMemo(() => sortedTrades.filter(({ agreement }) => {
    if (myTradesTab === 'all') return true;
    const state = ((agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown') as string;
    if (myTradesTab === 'active') return ACTIVE_LIFECYCLE_STATES.has(state);
    return COMPLETED_LIFECYCLE_STATES.has(state);
  }), [sortedTrades, myTradesTab]);

  const activeCount = sortedTrades.filter(({ agreement }) =>
    ACTIVE_LIFECYCLE_STATES.has(((agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? '') as string),
  ).length;

  return (
    <div
      className="w-full h-full overflow-y-auto"
      style={{ background: 'var(--bg-elev-1)', color: 'var(--t1)' }}
    >
      <div className="mx-auto px-6 py-5" style={{ maxWidth: 1600 }}>
        <NodeOfflineBanner />

        {/* Top header — flat strip, no gradients. Tab strip immediately
            below pulls double-duty as the section divider. */}
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold tracking-tight text-[#eaecef]">{t('marketplace.page_title')}</h1>
            <p className="text-[12px] text-[#b7bdc6] mt-0.5">
              {mode === 'otc'
                ? t('marketplace.header.subtitle_otc')
                : t('marketplace.header.subtitle_swap')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {refreshing && mode === 'otc' && (
              <RefreshCw size={13} className="animate-spin text-[#5e6673]" />
            )}
            <Link
              to="/settlement"
              className="text-[12px] inline-flex items-center gap-1.5 text-[#b7bdc6] hover:text-[#eaecef] transition-colors"
              title={t('marketplace.header.advanced_flows_tooltip')}
            >
              {t('marketplace.header.advanced_flows')} <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {/* Mode tabs — replaces the old purple/orange pill strip with the
            neutral underline tab primitive used across the redesign. */}
        <div className="mb-4">
          <Tabs<MarketplaceMode>
            variant="underline"
            value={mode}
            onChange={setMode}
            tabs={[
              { id: 'otc',  label: t('marketplace.mode_tabs.otc') },
              { id: 'swap', label: t('marketplace.mode_tabs.swap') },
            ]}
          />
        </div>

        {mode === 'swap' ? (
          <SwapPanel requestedPairId={requestedSwapPairId} />
        ) : (
        <>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr) minmax(0, 1fr)' }}
        >
          {/* LEFT — Order book */}
          <OrderBook
            onTakeOffer={handleTake}
            onCreateOrder={() => setShowOrderTypePicker(true)}
            selectedOfferId={view.selectedOfferId}
          />

          {/* MIDDLE — Trade calculator + active trade + seller verify */}
          <div className="space-y-3 min-w-0">
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

          {/* RIGHT — My Trades. Dense table-style list using the new
              Pill primitive for sides + lifecycle. */}
          <div className="bg-[#181a20] border border-[#2b3139] rounded-lg p-4 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-[13px] font-semibold text-[#eaecef]">{t('marketplace.my_trades.title')}</h3>
              <Tabs<MyTradesTab>
                variant="pill"
                size="sm"
                value={myTradesTab}
                onChange={setMyTradesTab}
                tabs={[
                  { id: 'active',    label: t('marketplace.my_trades.tab_active'), count: activeCount },
                  { id: 'completed', label: t('marketplace.my_trades.tab_completed') },
                  { id: 'all',       label: t('marketplace.my_trades.tab_all') },
                ]}
              />
            </div>
            {tabFiltered.length === 0 ? (
              <div className="text-[12px] py-8 text-center text-[#5e6673]">
                {myTradesTab === 'active'
                  ? t('marketplace.my_trades.empty_active')
                  : myTradesTab === 'completed'
                    ? t('marketplace.my_trades.empty_completed')
                    : t('marketplace.my_trades.empty_all')}
              </div>
            ) : (
              <div className="space-y-0.5 -mx-2">
                {tabFiltered.slice(0, 20).map(({ agreement, side }) => {
                  const id = (agreement as unknown as { agreement_id?: string; id?: string }).agreement_id
                    ?? (agreement as unknown as { id?: string }).id ?? '';
                  const state = (agreement as unknown as { lifecycle?: { state?: string } })?.lifecycle?.state ?? 'unknown';
                  const amount = (agreement as unknown as { total_amount?: number; amount?: number }).total_amount
                    ?? (agreement as unknown as { amount?: number }).amount ?? 0;
                  const active = id === view.activeTradeAgreementId;
                  const status = statusPillFor(state, t);
                  const actionable = state === 'funded' || state === 'partially_released';
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMarketplaceActiveTrade(id)}
                      className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${
                        active ? 'bg-[#2b3139]' : 'hover:bg-[#1e2026]'
                      } ${actionable ? 'border-l-2 border-l-[#fcd535]' : ''}`}
                    >
                      <Pill intent={side === 'buying' ? 'buy' : 'sell'} size="xs">
                        {side === 'buying' ? t('marketplace.my_trades.side_buy') : t('marketplace.my_trades.side_sell')}
                      </Pill>
                      <span className="font-mono tabular-nums text-[#eaecef] truncate">
                        {formatIRM(amount)}
                      </span>
                      <span className="font-mono text-[#5e6673] truncate" title={id}>
                        {shortId(id)}
                      </span>
                      <Pill intent={status.intent} size="xs" dot>
                        {status.label}
                      </Pill>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {showOrderTypePicker && (
          <OrderTypePickerModal
            onClose={() => setShowOrderTypePicker(false)}
            onSelect={handleOrderTypePicked}
          />
        )}

        {showCreateOrder && (
          <CreateOrderModal
            sellerAddress={activeWalletAddr}
            onClose={() => setShowCreateOrder(false)}
            onCreated={() => { /* polls refresh on cadence */ }}
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
