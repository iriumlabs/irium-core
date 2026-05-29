import { useEffect, useMemo, useState } from 'react';
import { Plus, Star, Loader2, ShieldCheck, ArrowRight, Activity, Lock, CreditCard } from 'lucide-react';
import { offers, reputation } from '../../lib/tauri';
import type { Offer } from '../../lib/types';
import { formatIRM, timeAgo } from '../../lib/types';

// Price-sorted offer book. Polls offers.list() every 10s. Each row is a
// card showing order id / IRM amount / unit + total price (USDT) /
// seller / payment method / created timestamp / escrow-verified badge.
// Header has sort controls and a Create Order button (Fix 2/3/4).
//
// Per-seller reputation is fetched from reputation.show(seller) and
// cached with a 60s TTL so the badges light up without spamming the
// wallet sidecar each poll.

type ReputationSummary = {
  stars: number;     // 1..5
  completed: number; // total satisfied agreements
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

// Best-effort parse of the offer's free-text asset_reference (e.g.
// "50 USDT", "0.001 BTC", "200 EUR") into a numeric total + unit. Used
// to derive the per-unit price column. Falls back to null when the
// value is unparseable so the card shows "—".
function parsePrice(raw: string | undefined | null): { total: number; unit: string } | null {
  if (!raw) return null;
  const m = raw.match(/^\s*([\d]+(?:[.,]\d+)?)\s*([A-Za-z]{1,8})?\s*/);
  if (!m) return null;
  const total = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(total) || total <= 0) return null;
  const unit = (m[2] ?? 'USDT').toUpperCase();
  return { total, unit };
}

function StarBadge({ rep }: { rep: ReputationSummary | null }) {
  if (!rep) {
    return (
      <span className="text-[10px]" style={{ color: 'rgba(238,240,255,0.35)' }}>
        no rep
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-display"
      style={{
        background: 'rgba(252,211,77,0.10)',
        color: '#fbbf24',
        border: '1px solid rgba(252,211,77,0.25)',
      }}
      title={`${rep.completed} completed trades`}
    >
      <Star size={9} fill="currentColor" />
      {rep.stars} · {rep.completed}
    </span>
  );
}

function VerifiedBadge({ rep }: { rep: ReputationSummary | null }) {
  // "Escrow verified" — the seller has at least one satisfied agreement
  // on record on this node, so the on-chain escrow flow has actually
  // been driven to release by someone before. This is intentionally
  // conservative: a fresh seller does NOT get the badge, which keeps
  // the badge meaningful.
  const verified = !!rep && rep.completed > 0;
  if (!verified) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-display font-semibold uppercase tracking-wide"
      style={{
        background: 'rgba(34,197,94,0.12)',
        color: '#22c55e',
        border: '1px solid rgba(34,197,94,0.30)',
      }}
      title="This seller has previously released escrow on a completed trade."
    >
      <ShieldCheck size={10} />
      Escrow Verified
    </span>
  );
}

type SortKey = 'price_asc' | 'price_desc' | 'newest' | 'best_rep';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  // Short labels keep the dropdown rendering at native width without
  // truncating "Best reputation" on the platforms that don't expand the
  // closed-state select to the longest option (most non-mac Webview2).
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

export default function OrderBook({ onTakeOffer, onCreateOrder, selectedOfferId }: OrderBookProps) {
  const [allOffers, setAllOffers] = useState<Offer[]>([]);
  const [reps, setReps] = useState<Record<string, ReputationSummary | null>>({});
  const [showTaken, setShowTaken] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('price_asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wall-clock timestamp of the last successful /offer-list response.
  // Surfaced in the network-stats bar so the user can see at a glance
  // whether the panel is fresh or hung on a stale poll.
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

  // Total offer counters — surfaced in the stats bar so the user can see
  // when offers were silently filtered out. `totalVisible` is the number
  // of rows after the strict "complete offer" filter below; `totalRaw`
  // is the number of offers the node returned. The gap is offers that
  // failed the Marketplace Fix 1 quality bar.
  const [totalRaw, setTotalRaw] = useState(0);

  const rows = useMemo(() => {
    const filtered = allOffers.filter((o) => {
      if (showTaken) return o.status === 'open' || o.status === 'taken';
      return o.status === 'open';
    });
    // Marketplace Fix 1 — strict offer-quality filter. An offer is only
    // shown when it has all four pieces a buyer actually needs to take a
    // decision: a real IRM amount, a parseable price (per the same regex
    // we use to sort), a payment method, and a non-empty seller. Test
    // offers that surfaced with `Price not set` previously fail the
    // parsePrice check and disappear. The pre-filter count is captured
    // so the stats bar can disclose what was filtered.
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

  // Keep the raw-count state in sync with the latest poll result so the
  // stats bar can disclose how many offers were filtered out.
  useEffect(() => {
    setTotalRaw(allOffers.filter((o) => showTaken ? (o.status === 'open' || o.status === 'taken') : o.status === 'open').length);
  }, [allOffers, showTaken]);
  const filteredCount = Math.max(0, totalRaw - rows.length);

  return (
    <div className="card p-4 space-y-3" style={{ border: '1px solid rgba(110,198,255,0.12)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
          Order Book
        </h3>
        <button
          onClick={onCreateOrder}
          className="btn-primary inline-flex items-center gap-1.5 text-xs px-3 py-1.5"
          title="Post a new sell offer to the order book."
        >
          <Plus size={12} /> Create Order
        </button>
      </div>

      {/* Network stats bar — total visible offers + filtered count +
          last-updated. Disclosing the filtered count keeps users from
          wondering whether the book is broken when a known-bad test
          offer disappears post-Fix-1. */}
      <div
        className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded"
        style={{
          background: 'rgba(110,198,255,0.05)',
          border: '1px solid rgba(110,198,255,0.12)',
          color: 'rgba(238,240,255,0.55)',
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Activity size={11} style={{ color: '#6EC6FF' }} />
          {rows.length} offer{rows.length === 1 ? '' : 's'} in book
          {filteredCount > 0 && (
            <span title={`${filteredCount} offer${filteredCount === 1 ? '' : 's'} hidden because they had no quoted price`} style={{ color: 'rgba(238,240,255,0.35)' }}>
              · {filteredCount} hidden
            </span>
          )}
        </span>
        <span>
          {lastUpdated ? `Updated ${timeAgo(lastUpdated)}` : 'Refreshing…'}
        </span>
      </div>

      {/* Sort + filter controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'rgba(238,240,255,0.55)' }}>
        <label className="inline-flex items-center gap-1.5">
          <span>Sort by:</span>
          <select
            className="input"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={{ height: 28, fontSize: 12, minWidth: 110 }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key} style={{ background: '#0f0f23' }}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 ml-auto">
          <input
            type="checkbox"
            checked={showTaken}
            onChange={(e) => setShowTaken(e.target.checked)}
          />
          Show recently taken
        </label>
      </div>

      {error && (
        <div className="text-xs" style={{ color: '#fbbf24' }}>
          {error}
        </div>
      )}

      {/* Rows */}
      <div className="overflow-y-auto space-y-2" style={{ maxHeight: 540 }}>
        {rows.length === 0 && !loading && (
          <div className="text-xs py-6 text-center" style={{ color: 'rgba(238,240,255,0.35)' }}>
            No offers in the book yet. Click Create Order above to post the first one.
          </div>
        )}
        {rows.map(({ offer: o, parsedPrice }, idx) => {
          const rep = reps[o.seller ?? ''] ?? null;
          const isSelected = o.id === selectedOfferId;
          const taken = o.status === 'taken';
          const amountIrm = (o.amount ?? 0) / 1e8;
          // Fix 1's enriched filter guarantees parsedPrice is non-null
          // here. Compute price-per-IRM directly — no nullable arm.
          const pricePerUnit = parsedPrice && amountIrm > 0
            ? (parsedPrice.total / amountIrm)
            : 0;
          const orderNumber = idx + 1;
          // Marketplace Fix 2 — BTCC-style card layout. The IRM amount
          // is the lead figure (the thing a buyer wants to scan first).
          // Order number sits as a small chip in the top-left, badges
          // top-right. Price block sits under the IRM amount, payment
          // method becomes a proper chip, and the bottom row carries
          // the seller-id + age + Escrow Protected status + Take CTA.
          const accentColor = taken ? 'rgba(255,255,255,0.18)' : '#22c55e';
          return (
            <div
              key={o.id}
              className="rounded transition-colors"
              style={{
                background: isSelected ? 'rgba(110,198,255,0.10)' : 'rgba(255,255,255,0.02)',
                borderTop: '1px solid ' + (isSelected ? 'rgba(110,198,255,0.30)' : 'rgba(255,255,255,0.06)'),
                borderRight: '1px solid ' + (isSelected ? 'rgba(110,198,255,0.30)' : 'rgba(255,255,255,0.06)'),
                borderBottom: '1px solid ' + (isSelected ? 'rgba(110,198,255,0.30)' : 'rgba(255,255,255,0.06)'),
                borderLeft: `3px solid ${accentColor}`,
                padding: 16,
                opacity: taken ? 0.55 : 1,
              }}
              onMouseEnter={(e) => {
                if (!taken && !isSelected) e.currentTarget.style.background = 'rgba(110,198,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isSelected ? 'rgba(110,198,255,0.10)' : 'rgba(255,255,255,0.02)';
              }}
            >
              {/* Row 1 — Order-number chip on the left, reputation +
                  verified badges on the right. */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded font-display font-bold tracking-wide"
                  style={{
                    color: taken ? 'rgba(238,240,255,0.50)' : '#6EC6FF',
                    background: 'rgba(110,198,255,0.10)',
                    border: '1px solid rgba(110,198,255,0.25)',
                    fontSize: 11,
                    letterSpacing: '0.06em',
                  }}
                  title={o.id ?? ''}
                >
                  ORDER #{orderNumber}
                </span>
                <div className="inline-flex items-center gap-1.5">
                  <StarBadge rep={rep} />
                  <VerifiedBadge rep={rep} />
                </div>
              </div>

              {/* Row 2 — large prominent IRM amount + price subtitle.
                  Mirrors the BTCC OTC order-card hierarchy: lead amount
                  in a 24px monospace headline, with the total + per-unit
                  price as a single muted subtitle below. */}
              <div className="mb-3" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                <div
                  className="tabular-nums"
                  style={{
                    color: '#eef0ff',
                    fontSize: 26,
                    fontWeight: 700,
                    lineHeight: 1.1,
                  }}
                >
                  {formatIRM(o.amount ?? 0)}
                </div>
                <div
                  className="tabular-nums mt-1"
                  style={{ color: '#34d399', fontSize: 13 }}
                >
                  {parsedPrice!.total.toLocaleString('en-US')} {parsedPrice!.unit}
                  <span style={{ color: 'rgba(238,240,255,0.35)' }}> · </span>
                  <span style={{ color: 'rgba(238,240,255,0.65)' }}>
                    {pricePerUnit.toLocaleString('en-US', { maximumFractionDigits: 6 })} {parsedPrice!.unit}/IRM
                  </span>
                </div>
              </div>

              {/* Row 3 — payment method chip + Escrow Protected badge.
                  Both are status signals, so they share a row above the
                  identity/age/CTA row to keep the card scannable. */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
                  style={{
                    background: 'rgba(167,139,250,0.10)',
                    color: '#A78BFA',
                    border: '1px solid rgba(167,139,250,0.25)',
                  }}
                  title={`Payment method: ${o.payment_method}`}
                >
                  <CreditCard size={10} />
                  {o.payment_method}
                </span>
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-display font-semibold"
                  style={{
                    background: 'rgba(34,197,94,0.10)',
                    color: '#22c55e',
                    border: '1px solid rgba(34,197,94,0.28)',
                  }}
                  title="Your funds are protected. IRM is locked the moment a buyer commits, and only releases when both sides confirm or a resolver decides."
                >
                  <Lock size={10} />
                  Escrow Protected
                </span>
              </div>

              {/* Row 4 — identity + age on the left, Take CTA on the
                  right. Address shortened to 8…4 to keep the row from
                  wrapping under the action button on narrow viewports. */}
              <div
                className="flex items-center justify-between gap-2 text-[11px] pt-2"
                style={{ color: 'rgba(238,240,255,0.65)', borderTop: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span title={o.seller ?? ''} style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {(o.seller ?? '').slice(0, 8)}…{(o.seller ?? '').slice(-4)}
                  </span>
                  <span style={{ color: 'rgba(238,240,255,0.30)' }}>·</span>
                  <span title={o.created_at ? new Date(o.created_at * 1000).toISOString() : ''}>
                    {o.created_at ? timeAgo(o.created_at) : 'just now'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => !taken && onTakeOffer(o)}
                  disabled={taken}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-[12px] font-display font-semibold"
                  style={{
                    color: taken ? 'rgba(238,240,255,0.35)' : '#22c55e',
                    background: taken ? 'transparent' : 'rgba(34,197,94,0.12)',
                    border: '1px solid ' + (taken ? 'rgba(255,255,255,0.08)' : 'rgba(34,197,94,0.30)'),
                    cursor: taken ? 'default' : 'pointer',
                  }}
                >
                  {taken ? 'Taken' : 'Take Offer'}
                  {!taken && <ArrowRight size={12} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="text-xs flex items-center gap-2" style={{ color: 'rgba(238,240,255,0.35)' }}>
          <Loader2 size={11} className="animate-spin" /> refreshing…
        </div>
      )}
    </div>
  );
}
