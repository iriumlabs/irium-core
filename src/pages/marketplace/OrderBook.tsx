import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Star, Loader2 } from 'lucide-react';
import { offers, reputation } from '../../lib/tauri';
import type { Offer } from '../../lib/types';
import { formatIRM, SATS_PER_IRM } from '../../lib/types';

// Price-sorted offer book. Polls offers.list() every 10s and renders
// rows sorted by IRM amount ascending (cheapest first). Open-only by
// default; toggle reveals recently-taken rows so a buyer can gauge
// market activity before committing.
//
// Reputation per seller is derived from reputation.show(seller). We
// cache results in a sessionStorage-backed Map so we don't refetch on
// every poll; the score is shown as a 1–5 star badge derived from
// risk_signal + completed agreement count.

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
      stars: risk_signal_to_stars((rep as unknown as Record<string, unknown>)?.risk_signal as string | undefined),
      completed: Number((rep as unknown as Record<string, unknown>)?.satisfied_count ?? 0),
    };
    REP_CACHE.set(addr, { fetched: now, rep: summary });
    return summary;
  } catch {
    REP_CACHE.set(addr, { fetched: now, rep: null });
    return null;
  }
}

function StarBadge({ rep }: { rep: ReputationSummary | null }) {
  if (!rep) {
    return (
      <span className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
        no rep
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-display"
      style={{
        background: 'rgba(252,211,77,0.10)',
        color: '#fbbf24',
        border: '1px solid rgba(252,211,77,0.25)',
      }}
      title={`${rep.completed} completed trades`}
    >
      <Star size={10} fill="currentColor" />
      {rep.stars} · {rep.completed}
    </span>
  );
}

export interface OrderBookProps {
  onTakeOffer: (offer: Offer) => void;
  selectedOfferId: string | null;
}

export default function OrderBook({ onTakeOffer, selectedOfferId }: OrderBookProps) {
  const [allOffers, setAllOffers] = useState<Offer[]>([]);
  const [reps, setReps] = useState<Record<string, ReputationSummary | null>>({});
  const [showTaken, setShowTaken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch once on mount + every POLL_INTERVAL_MS.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        setLoading(true);
        const list = await offers.list({ sort: 'amount' });
        if (cancelled) return;
        setAllOffers(list ?? []);
        setError(null);
        // Background fan-out for reputations. Don't await — let badges
        // light up as each call returns. The cache prevents spamming.
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
    return allOffers.filter((o) => {
      if (showTaken) return o.status === 'open' || o.status === 'taken';
      return o.status === 'open';
    });
  }, [allOffers, showTaken]);

  return (
    <div className="card p-4 space-y-3" style={{ border: '1px solid rgba(110,198,255,0.12)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
            Order Book
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(238,240,255,0.45)' }}>
            {rows.length} offers · sorted by amount
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
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

      <div
        className="overflow-y-auto"
        style={{ maxHeight: 480, fontFamily: '"JetBrains Mono", monospace' }}
      >
        {rows.length === 0 && !loading && (
          <div className="text-xs py-6 text-center" style={{ color: 'rgba(238,240,255,0.35)' }}>
            No offers in the book yet. Try refreshing or expand the toggle above.
          </div>
        )}
        {rows.map((o) => {
          const rep = reps[o.seller ?? ''] ?? null;
          const irm = (o.amount ?? 0) / SATS_PER_IRM;
          const isSelected = o.id === selectedOfferId;
          const taken = o.status === 'taken';
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => !taken && onTakeOffer(o)}
              disabled={taken}
              className="w-full text-left grid items-center gap-2 px-2 py-1.5 rounded transition-colors"
              style={{
                gridTemplateColumns: '5rem 1fr 6rem 4rem 5rem',
                background: isSelected ? 'rgba(110,198,255,0.10)' : 'transparent',
                color: taken ? 'rgba(238,240,255,0.35)' : 'var(--t1)',
                fontSize: 12,
                cursor: taken ? 'default' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!taken) e.currentTarget.style.background = 'rgba(110,198,255,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isSelected ? 'rgba(110,198,255,0.10)' : 'transparent';
              }}
            >
              <span className="tabular-nums">{formatIRM(o.amount ?? 0)}</span>
              <span className="truncate">{o.payment_method ?? 'unknown'}</span>
              <span className="truncate">{(o.seller ?? '').slice(0, 8)}…</span>
              <StarBadge rep={rep} />
              <span className="inline-flex items-center justify-end gap-1 text-xs" style={{ color: taken ? 'rgba(238,240,255,0.35)' : '#34d399' }}>
                {taken ? 'taken' : 'Take'}
                {!taken && <ArrowRight size={11} />}
              </span>
            </button>
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
