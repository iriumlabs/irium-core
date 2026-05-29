import { useEffect, useMemo, useState } from 'react';
import { Plus, Star, Loader2, ShieldCheck, ArrowRight, Activity, AlertCircle } from 'lucide-react';
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

  const rows = useMemo(() => {
    const filtered = allOffers.filter((o) => {
      if (showTaken) return o.status === 'open' || o.status === 'taken';
      return o.status === 'open';
    });
    // Client-side sort. We base price ordering on the parsed
    // asset_reference total — offers without a parseable price sink to
    // the end of the list under price sorts but stay sorted by IRM
    // amount among themselves so the UI stays predictable.
    const enriched = filtered.map((o) => {
      const parsed = parsePrice((o.asset_reference as string | undefined) ?? null);
      const stars = reps[o.seller ?? '']?.stars ?? 0;
      const created = (o.created_at ?? 0) as number;
      return { offer: o, parsedPrice: parsed, stars, created };
    });
    enriched.sort((a, b) => {
      // Unpriced offers always sink to the end regardless of sort key.
      // A "Price not set" row is information the buyer can't act on
      // without contacting the seller — keeping them at the bottom
      // means the actionable rows render in the visible scroll window.
      const aHasPrice = a.parsedPrice != null;
      const bHasPrice = b.parsedPrice != null;
      if (aHasPrice !== bHasPrice) return aHasPrice ? -1 : 1;

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

      {/* Network stats bar (Fix 5) — total offers count + last-updated
          timestamp. Refreshed by the same /offer-list poll that powers
          the rows below. */}
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
          const pricePerUnit = parsedPrice && amountIrm > 0
            ? (parsedPrice.total / amountIrm)
            : null;
          // Sequential display number — derived from the sorted position
          // so the user sees ORDER #1, #2, #3 in the order they're shown
          // rather than the opaque base58 / gossip id fragment.
          const orderNumber = idx + 1;
          // Fix 3 — open offers get a strong green left-border accent so
          // the row is visually delimited as "actionable". Taken rows
          // keep the same structure but with a muted left border so the
          // group reads as inactive without losing visual rhythm.
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
                padding: 14,
                opacity: taken ? 0.55 : 1,
              }}
              onMouseEnter={(e) => {
                if (!taken && !isSelected) e.currentTarget.style.background = 'rgba(110,198,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isSelected ? 'rgba(110,198,255,0.10)' : 'rgba(255,255,255,0.02)';
              }}
            >
              {/* Row 1 — Order # as a prominent header + badges */}
              <div
                className="flex items-center justify-between gap-2 pb-2 mb-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span
                  className="font-display font-bold uppercase tracking-wide"
                  style={{
                    color: taken ? 'rgba(238,240,255,0.50)' : '#eef0ff',
                    fontSize: 13,
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

              {/* Row 2 — IRM amount + total price + per-unit price.
                  When the offer has no parseable price, the Total +
                  Per IRM cells collapse into a single span-2 amber
                  "Contact seller for price" badge (Fix 2). */}
              <div className="grid grid-cols-3 gap-2" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                <div>
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(238,240,255,0.40)' }}>IRM</div>
                  <div className="text-sm tabular-nums" style={{ color: '#eef0ff' }}>{formatIRM(o.amount ?? 0)}</div>
                </div>
                {parsedPrice ? (
                  <>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(238,240,255,0.40)' }}>Total</div>
                      <div className="text-sm tabular-nums" style={{ color: '#34d399' }}>
                        {parsedPrice.total.toLocaleString('en-US')} {parsedPrice.unit}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(238,240,255,0.40)' }}>Per IRM</div>
                      <div className="text-sm tabular-nums" style={{ color: pricePerUnit != null ? 'rgba(238,240,255,0.85)' : 'rgba(238,240,255,0.45)' }}>
                        {pricePerUnit != null
                          ? `${pricePerUnit.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${parsedPrice.unit}`
                          : '—'}
                      </div>
                    </div>
                  </>
                ) : (
                  <div
                    className="col-span-2 inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] self-end"
                    style={{
                      background: 'rgba(252,211,77,0.08)',
                      color: '#fbbf24',
                      border: '1px solid rgba(252,211,77,0.20)',
                      fontFamily: '"Space Grotesk", sans-serif',
                    }}
                    title="The seller did not include a quoted price. Use the payment method below to ask them directly."
                  >
                    <AlertCircle size={11} />
                    Contact seller for price
                  </div>
                )}
              </div>

              {/* Row 3 — seller + payment + created + action */}
              <div className="flex items-center justify-between gap-2 text-[11px] mt-3 pt-2" style={{ color: 'rgba(238,240,255,0.65)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span title={o.seller ?? ''} style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                    {(o.seller ?? '').slice(0, 8)}…{(o.seller ?? '').slice(-4)}
                  </span>
                  <span style={{ color: 'rgba(238,240,255,0.35)' }}>·</span>
                  <span>{o.payment_method ?? 'unknown'}</span>
                  <span style={{ color: 'rgba(238,240,255,0.35)' }}>·</span>
                  <span title={o.created_at ? new Date(o.created_at * 1000).toISOString() : ''}>
                    {o.created_at ? timeAgo(o.created_at) : 'just now'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => !taken && onTakeOffer(o)}
                  disabled={taken}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px]"
                  style={{
                    color: taken ? 'rgba(238,240,255,0.35)' : '#34d399',
                    background: taken ? 'transparent' : 'rgba(34,197,94,0.12)',
                    border: '1px solid ' + (taken ? 'rgba(255,255,255,0.08)' : 'rgba(34,197,94,0.25)'),
                    cursor: taken ? 'default' : 'pointer',
                  }}
                >
                  {taken ? 'taken' : 'Take'}
                  {!taken && <ArrowRight size={11} />}
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
