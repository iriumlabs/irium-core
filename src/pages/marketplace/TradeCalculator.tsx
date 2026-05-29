import { useMemo, useState } from 'react';
import { Calculator, ArrowRight } from 'lucide-react';
import type { Offer } from '../../lib/types';
import { SATS_PER_IRM, formatIRM } from '../../lib/types';

// Trade calculator — user inputs the amount of off-chain stable currency
// they want to spend (default USDT) and the calculator picks the cheapest
// open offer that covers that amount. Reputation is shown alongside so
// the user can override to a better-rep seller if they prefer.
//
// We don't have a USDT/IRM oracle in irium-core, so the offer's own
// price_note (free-form text) is the price hint. For the simple match
// case we use offer-amount-as-IRM and assume 1:1 pricing — the seller
// expresses the offer in IRM and the calculator just shows the IRM
// they'd receive. A future iteration can parse price_note for explicit
// rate hints.

export interface TradeCalculatorProps {
  offers: Offer[];
  onSelectOffer: (offer: Offer) => void;
  reputationStars: Record<string, number | null>;
}

export default function TradeCalculator({
  offers,
  onSelectOffer,
  reputationStars,
}: TradeCalculatorProps) {
  const [usdtAmount, setUsdtAmount] = useState('');

  const openOffers = useMemo(
    () => offers.filter((o) => o.status === 'open'),
    [offers],
  );

  const numericUsdt = useMemo(() => {
    const n = Number(usdtAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [usdtAmount]);

  // Cheapest-first match. We don't have a market-wide rate, so we
  // present the cheapest available offer that the user could likely
  // afford with their input; secondary signal is reputation.
  const cheapest = useMemo(() => {
    const sorted = [...openOffers].sort(
      (a, b) => (a.amount ?? 0) - (b.amount ?? 0),
    );
    return sorted[0] ?? null;
  }, [openOffers]);

  const bestReputation = useMemo(() => {
    let best: { offer: Offer; stars: number } | null = null;
    for (const o of openOffers) {
      const stars = reputationStars[o.seller ?? ''] ?? 0;
      if (stars == null) continue;
      if (!best || stars > best.stars) {
        best = { offer: o, stars };
      }
    }
    return best;
  }, [openOffers, reputationStars]);

  const estimatedIrm =
    cheapest && cheapest.amount
      ? (cheapest.amount / SATS_PER_IRM).toString()
      : '0';

  return (
    <div className="card p-4 space-y-4" style={{ border: '1px solid rgba(167,139,250,0.18)' }}>
      <div className="flex items-center gap-2">
        <Calculator size={14} style={{ color: '#A78BFA' }} />
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
          Trade Calculator
        </h3>
      </div>

      <div className="space-y-2">
        <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
          You spend
        </label>
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            value={usdtAmount}
            onChange={(e) => setUsdtAmount(e.target.value)}
            placeholder="100"
            inputMode="decimal"
          />
          <span className="text-xs px-2 py-1 rounded" style={{
            background: 'rgba(238,240,255,0.06)',
            color: 'rgba(238,240,255,0.65)',
          }}>USDT</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
          You receive (cheapest match)
        </label>
        <div
          className="px-3 py-2 rounded text-sm tabular-nums"
          style={{
            background: 'rgba(0,0,0,0.25)',
            color: '#eef0ff',
            border: '1px solid rgba(255,255,255,0.06)',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {cheapest ? formatIRM(cheapest.amount ?? 0) : '— no offers —'}
        </div>
        <p className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
          {numericUsdt > 0
            ? `Estimated at the cheapest seller's quote. Confirm exact rate in the offer's price note before paying.`
            : 'Enter a USDT amount to see matching offers.'}
        </p>
      </div>

      {cheapest && (
        <div
          className="p-3 rounded space-y-2"
          style={{
            background: 'rgba(110,198,255,0.05)',
            border: '1px solid rgba(110,198,255,0.18)',
          }}
        >
          <div className="text-xs font-display font-semibold" style={{ color: 'var(--t1)' }}>
            Cheapest seller
          </div>
          <div className="text-xs space-y-1" style={{ color: 'rgba(238,240,255,0.65)', fontFamily: '"JetBrains Mono", monospace' }}>
            <div>amount: <span style={{ color: '#34d399' }}>{formatIRM(cheapest.amount ?? 0)}</span></div>
            <div>seller: {(cheapest.seller ?? '').slice(0, 10)}…</div>
            <div>rep: {reputationStars[cheapest.seller ?? ''] ?? '?'} ★</div>
            <div>payment: {cheapest.payment_method ?? '—'}</div>
          </div>
          <button
            onClick={() => onSelectOffer(cheapest)}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 text-xs"
          >
            Take this offer <ArrowRight size={12} />
          </button>
        </div>
      )}

      {bestReputation && cheapest && bestReputation.offer.id !== cheapest.id && (
        <div
          className="p-3 rounded space-y-2"
          style={{
            background: 'rgba(252,211,77,0.06)',
            border: '1px solid rgba(252,211,77,0.18)',
          }}
        >
          <div className="text-xs font-display font-semibold" style={{ color: '#fbbf24' }}>
            Top reputation alternative
          </div>
          <div className="text-xs space-y-1" style={{ color: 'rgba(238,240,255,0.65)', fontFamily: '"JetBrains Mono", monospace' }}>
            <div>amount: {formatIRM(bestReputation.offer.amount ?? 0)}</div>
            <div>seller: {(bestReputation.offer.seller ?? '').slice(0, 10)}…</div>
            <div>rep: {bestReputation.stars} ★</div>
          </div>
          <button
            onClick={() => onSelectOffer(bestReputation.offer)}
            className="btn-secondary w-full inline-flex items-center justify-center gap-2 text-xs"
          >
            Take this instead <ArrowRight size={12} />
          </button>
        </div>
      )}

      <div className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
        Estimated IRM if 1:1 quote: <span className="tabular-nums">{estimatedIrm}</span>
      </div>
    </div>
  );
}
