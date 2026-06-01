import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, ShieldCheck, ArrowRight, Activity, Star } from 'lucide-react';
import { offers, reputation } from '../../lib/tauri';
import type { Offer } from '../../lib/types';
import { formatIRM, timeAgo } from '../../lib/types';
import { Pill, Table, THead, TBody, TR, TH, TD } from '../../components/ui';

// Dense Binance-style order book. Polls offers.list() every 10s. Each
// row is a single 32 px table line: order # / amount / price-per-IRM /
// total / payment / seller (truncated 8…4) / reputation / age. Click
// the row to load the trade panel; click "Take" to open the take modal.
//
// All polling, sort, filter, and reputation-cache machinery is preserved
// verbatim from the prior card-layout version; only the render output
// rotates to the dense table.

type ReputationSummary = {
  stars: number;
  completed: number;
};

const REP_CACHE = new Map<string, { fetched: number; rep: ReputationSummary | null }>();

const POLL_INTERVAL_MS = 10_000;
const REP_TTL_MS = 60_000;

function risk_signal_to_stars(risk: string | undefined): number {
  switch (risk) {
    case 'low': return 5;
    case 'moderate': return 4;
    case 'high': return 2;
    case 'very_high': return 1;
    default: return 3;
  }
}

async function fetchReputation(addr: string): Promise<ReputationSummary | null> {
  const now = Date.now();
  const cached = REP_CACHE.get(addr);
  if (cached && now - cached.fetched < REP_TTL_MS) return cached.rep;
  try {
    const rep = await reputation.show(addr);
    const summary: ReputationSummary = {
      stars: risk_signal_to_stars((rep as unknown as Record<string, unknown>)?.risk as string | undefined),
      completed: Number((rep as unknown as Record<string, unknown>)?.satisfied ?? 0),
    };
    REP_CACHE.set(addr, { fetched: now, rep: summary });
    return summary;
  } catch {
    REP_CACHE.set(addr, { fetched: now, rep: null });
    return null;
  }
}

function parsePrice(raw: string | undefined | null): { total: number; unit: string } | null {
  if (!raw) return null;
  const m = raw.match(/^\s*([\d]+(?:[.,]\d+)?)\s*([A-Za-z]{1,8})?\s*/);
  if (!m) return null;
  const total = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(total) || total <= 0) return null;
  const unit = (m[2] ?? 'USDT').toUpperCase();
  return { total, unit };
}

type SortKey = 'price_asc' | 'price_desc' | 'newest' | 'best_rep';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'price_asc',  label: 'Price ↑' },
  { key: 'price_desc', label: 'Price ↓' },
  { key: 'newest',     label: 'Newest' },
  { key: 'best_rep',   label: 'Best Rep' },
];

export interface OrderBookProps {
  onTakeOffer: (offer: Offer) => void;
  onCreateOrder: () => void;
  selectedOfferId: string | null;
}

function shortAddr(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

export default function OrderBook({ onTakeOffer, onCreateOrder, selectedOfferId }: OrderBookProps) {
  const [allOffers, setAllOffers] = useState<Offer[]>([]);
  const [reps, setReps] = useState<Record<string, ReputationSummary | null>>({});
  const [showTaken, setShowTaken] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('price_asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        setLoading(true);
        const list = await offers.list({ sort: 'amount' });
        if (cancelled) return;
        setAllOffers(list ?? []);
        setLastUpdated(Math.floor(Date.now() / 1000));
        setError(null);
        const sellers = Array.from(new Set((list ?? []).map((o) => o.seller).filter(Boolean) as string[]));
        for (const addr of sellers) {
          fetchReputation(addr).then((rep) => {
            if (cancelled) return;
            setReps((prev) => ({ ...prev, [addr]: rep }));
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
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
  }, []);

  const [totalRaw, setTotalRaw] = useState(0);

  const rows = useMemo(() => {
    const filtered = allOffers.filter((o) => {
      if (showTaken) return o.status === 'open' || o.status === 'taken';
      return o.status === 'open';
    });
    const enriched = filtered.map((o) => {
      const parsed = parsePrice((o.asset_reference as string | undefined) ?? null);
      const stars = reps[o.seller ?? '']?.stars ?? 0;
      const created = (o.created_at ?? 0) as number;
      return { offer: o, parsedPrice: parsed, stars, created };
    }).filter(({ offer, parsedPrice }) => {
      if (parsedPrice == null) return false;
      if (!offer.amount || offer.amount <= 0) return false;
      if (!offer.payment_method || !offer.payment_method.trim()) return false;
      if (!offer.seller || !offer.seller.trim()) return false;
      return true;
    });
    enriched.sort((a, b) => {
      switch (sortKey) {
        case 'price_asc': {
          const ap = a.parsedPrice?.total ?? Number.POSITIVE_INFINITY;
          const bp = b.parsedPrice?.total ?? Number.POSITIVE_INFINITY;
          if (ap !== bp) return ap - bp;
          return (a.offer.amount ?? 0) - (b.offer.amount ?? 0);
        }
        case 'price_desc': {
          const ap = a.parsedPrice?.total ?? Number.NEGATIVE_INFINITY;
          const bp = b.parsedPrice?.total ?? Number.NEGATIVE_INFINITY;
          if (ap !== bp) return bp - ap;
          return (b.offer.amount ?? 0) - (a.offer.amount ?? 0);
        }
        case 'newest':
          return b.created - a.created;
        case 'best_rep':
          if (a.stars !== b.stars) return b.stars - a.stars;
          return (a.parsedPrice?.total ?? Number.POSITIVE_INFINITY) - (b.parsedPrice?.total ?? Number.POSITIVE_INFINITY);
        default:
          return 0;
      }
    });
    return enriched;
  }, [allOffers, reps, showTaken, sortKey]);

  useEffect(() => {
    setTotalRaw(allOffers.filter((o) => showTaken ? (o.status === 'open' || o.status === 'taken') : o.status === 'open').length);
  }, [allOffers, showTaken]);
  const filteredCount = Math.max(0, totalRaw - rows.length);

  return (
    <div className="bg-[#181a20] border border-[#2b3139] rounded-lg flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-[#2b3139]">
        <h3 className="text-[13px] font-semibold text-[#eaecef]">Order Book</h3>
        <button
          onClick={onCreateOrder}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12px] font-semibold bg-[#fcd535] text-[#0b0e11] hover:bg-[#f0c020] transition-colors"
        >
          <Plus size={12} /> Create Order
        </button>
      </div>

      {/* Stats + filter bar */}
      <div className="px-4 py-2 flex items-center justify-between gap-3 text-[11px] text-[#5e6673] border-b border-[#2b3139] font-mono">
        <span className="inline-flex items-center gap-1.5">
          <Activity size={11} className="text-[#0ecb81]" />
          <span className="text-[#b7bdc6]">{rows.length}</span> offer{rows.length === 1 ? '' : 's'}
          {filteredCount > 0 && (
            <span title={`${filteredCount} offer${filteredCount === 1 ? '' : 's'} hidden because they had no quoted price`}>
              · {filteredCount} hidden
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#b7bdc6]">
            <input
              type="checkbox"
              checked={showTaken}
              onChange={(e) => setShowTaken(e.target.checked)}
              className="accent-[#fcd535]"
            />
            Show taken
          </label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-6 px-2 rounded bg-[#0b0e11] border border-[#2b3139] text-[#eaecef] font-sans text-[11px]"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key} className="bg-[#181a20]">
                {opt.label}
              </option>
            ))}
          </select>
          <span>{lastUpdated ? `Updated ${timeAgo(lastUpdated)}` : 'Refreshing…'}</span>
        </span>
      </div>

      {error && (
        <div className="px-4 py-2 text-[11px] text-[#f0b90b] bg-[rgba(240,185,11,0.06)] border-b border-[#2b3139]">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-y-auto flex-1" style={{ maxHeight: 620 }}>
        {rows.length === 0 && !loading ? (
          <div className="text-[12px] py-10 text-center text-[#5e6673] px-4">
            No offers in the book yet. Click <span className="text-[#eaecef] font-medium">Create Order</span> to post the first one.
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH align="left"  className="w-[44px]">#</TH>
                <TH align="right">Amount IRM</TH>
                <TH align="right">Price / IRM</TH>
                <TH align="right">Total</TH>
                <TH align="left">Payment</TH>
                <TH align="left">Seller</TH>
                <TH align="right">Rep</TH>
                <TH align="right">Age</TH>
                <TH align="right" className="pr-3">{/* action */}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map(({ offer: o, parsedPrice }, idx) => {
                const rep = reps[o.seller ?? ''] ?? null;
                const isSelected = o.id === selectedOfferId;
                const taken = o.status === 'taken';
                const amountIrm = (o.amount ?? 0) / 1e8;
                const pricePerUnit = parsedPrice && amountIrm > 0
                  ? (parsedPrice.total / amountIrm)
                  : 0;
                return (
                  <TR
                    key={o.id}
                    selected={isSelected}
                    onClick={() => !taken && onTakeOffer(o)}
                    className={taken ? 'opacity-50' : ''}
                  >
                    <TD align="left" className="text-[#5e6673] font-mono">
                      {idx + 1}
                    </TD>
                    <TD align="right" mono className="text-[#eaecef] font-semibold">
                      {formatIRM(o.amount ?? 0)}
                    </TD>
                    <TD align="right" mono className="text-[#b7bdc6]">
                      {pricePerUnit.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                      <span className="text-[#5e6673] text-[10px] ml-1">{parsedPrice!.unit}</span>
                    </TD>
                    <TD align="right" mono className="text-[#b7bdc6]">
                      {parsedPrice!.total.toLocaleString('en-US')}
                      <span className="text-[#5e6673] text-[10px] ml-1">{parsedPrice!.unit}</span>
                    </TD>
                    <TD>
                      <Pill intent="info" size="xs">{o.payment_method}</Pill>
                    </TD>
                    <TD mono className="text-[#b7bdc6]" title={o.seller ?? ''}>
                      {shortAddr(o.seller ?? '')}
                    </TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1 text-[#f0b90b] font-mono tabular-nums" title={rep ? `${rep.stars} of 5, ${rep.completed} completed` : 'No reputation'}>
                        {rep ? (
                          <>
                            <Star size={10} fill="currentColor" />
                            <span>{rep.stars}</span>
                            {rep.completed > 0 && (
                              <ShieldCheck size={10} className="text-[#0ecb81] ml-0.5" />
                            )}
                          </>
                        ) : (
                          <span className="text-[#474d57]">—</span>
                        )}
                      </span>
                    </TD>
                    <TD align="right" className="text-[#5e6673] font-mono">
                      {o.created_at ? timeAgo(o.created_at) : '—'}
                    </TD>
                    <TD align="right" className="pr-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!taken) onTakeOffer(o);
                        }}
                        disabled={taken}
                        className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold transition-colors ${
                          taken
                            ? 'bg-transparent text-[#474d57] cursor-not-allowed border border-[#2b3139]'
                            : 'bg-[rgba(14,203,129,0.15)] text-[#0ecb81] border border-[rgba(14,203,129,0.30)] hover:bg-[rgba(14,203,129,0.25)]'
                        }`}
                      >
                        {taken ? 'Taken' : <>Take <ArrowRight size={10} /></>}
                      </button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      {loading && (
        <div className="px-4 py-1.5 text-[11px] flex items-center gap-2 text-[#5e6673] border-t border-[#2b3139]">
          <Loader2 size={11} className="animate-spin" /> refreshing…
        </div>
      )}
    </div>
  );
}
