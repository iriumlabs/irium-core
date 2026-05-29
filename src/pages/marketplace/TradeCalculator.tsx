import { useMemo, useState } from 'react';
import { Calculator, ArrowRight, Star, ShieldCheck, Info } from 'lucide-react';
import type { Offer } from '../../lib/types';
import { formatIRM } from '../../lib/types';

// Trade calculator — user inputs the amount of off-chain stable currency
// they want to spend (default USDT) and the calculator picks the
// cheapest open offer and a "best reputation" alternative. Reputation
// stars beside each card let the user override to a better-rep seller
// if they prefer.
//
// We don't have a USDT/IRM oracle in irium-core, so the offer's
// asset_reference (free-form, e.g. "50 USDT") is parsed and surfaced as
// the explicit price. Offers without a parseable price are still shown
// but the "You pay" field renders "Price not set" rather than a misleading
// numeric estimate.

export interface TradeCalculatorProps {
  offers: Offer[];
  onSelectOffer: (offer: Offer) => void;
  reputationStars: Record<string, number | null>;
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

function StarLine({ stars }: { stars: number | null }) {
  if (stars == null) {
    return (
      <span className="text-[11px]" style={{ color: 'rgba(238,240,255,0.35)' }}>
        no reputation yet
      </span>
    );
  }
  // Render 5-star scale with filled / hollow icons so the badge is
  // immediately readable at a glance.
  const cells = [1, 2, 3, 4, 5].map((i) => {
    const filled = i <= stars;
    return (
      <Star
        key={i}
        size={11}
        fill={filled ? 'currentColor' : 'none'}
        strokeWidth={1.5}
      />
    );
  });
  return (
    <span
      className="inline-flex items-center gap-0.5"
      style={{ color: '#fbbf24' }}
      title={`${stars} of 5`}
    >
      {cells}
    </span>
  );
}

function OfferCard({
  title,
  accent,
  offer,
  stars,
  onSelect,
  ctaLabel,
}: {
  title: string;
  accent: string;
  offer: Offer;
  stars: number | null;
  onSelect: () => void;
  ctaLabel: string;
}) {
  const price = parsePrice((offer.asset_reference as string | undefined) ?? null);
  const verified = (stars ?? 0) >= 4;
  return (
    <div
      className="p-3 rounded space-y-3"
      style={{
        background: `${accent}10`,
        border: `1px solid ${accent}33`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-wide font-display font-semibold"
          style={{ color: accent }}
        >
          {title}
        </span>
        <div className="inline-flex items-center gap-1.5">
          <StarLine stars={stars} />
          {verified && (
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-display font-semibold uppercase tracking-wide"
              style={{
                background: 'rgba(34,197,94,0.12)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.30)',
              }}
              title="Seller has previously released escrow on a completed trade."
            >
              <ShieldCheck size={9} /> Verified
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(238,240,255,0.45)' }}>
            You receive
          </span>
          <span className="text-sm tabular-nums" style={{ color: '#34d399' }}>
            {formatIRM(offer.amount ?? 0)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'rgba(238,240,255,0.45)' }}>
            You pay
          </span>
          <span
            className="text-sm tabular-nums"
            style={{ color: price ? '#eef0ff' : 'rgba(238,240,255,0.45)' }}
          >
            {price ? `${price.total.toLocaleString('en-US')} ${price.unit}` : 'Price not set'}
          </span>
        </div>
        <div
          className="text-[11px] flex items-center gap-2 pt-1"
          style={{ color: 'rgba(238,240,255,0.55)' }}
        >
          <span title={offer.seller ?? ''}>
            {(offer.seller ?? '').slice(0, 8)}…{(offer.seller ?? '').slice(-4)}
          </span>
          <span style={{ color: 'rgba(238,240,255,0.30)' }}>·</span>
          <span>{offer.payment_method ?? '—'}</span>
        </div>
      </div>

      <button
        onClick={onSelect}
        className="btn-primary w-full inline-flex items-center justify-center gap-2 text-xs"
      >
        {ctaLabel} <ArrowRight size={12} />
      </button>
    </div>
  );
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

  const userHasBudget = numericUsdt > 0;

  // Fix 1 / Fix 6 — detect whether ANY visible offer has a parseable
  // quote. If none do, the entire "cheapest seller / top reputation"
  // section would otherwise render two cards both labelled "Price not
  // set" — visually identical to a real price, just wrong. Instead we
  // surface a single informational notice explaining the situation.
  const cheapestPrice = parsePrice((cheapest?.asset_reference as string | undefined) ?? null);
  const bestRepPrice = parsePrice(
    (bestReputation?.offer.asset_reference as string | undefined) ?? null,
  );
  const anyPricedOffer = useMemo(
    () => openOffers.some((o) => parsePrice((o.asset_reference as string | undefined) ?? null) != null),
    [openOffers],
  );
  const showNoPricesNotice = openOffers.length > 0 && !anyPricedOffer;

  return (
    <div className="card p-4 space-y-4" style={{ border: '1px solid rgba(167,139,250,0.18)' }}>
      <div className="flex items-center gap-2">
        <Calculator size={14} style={{ color: '#A78BFA' }} />
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
          Trade Calculator
        </h3>
      </div>

      {/* You spend — Fix 4: prominent label + large input.
          The USDT budget is the primary affordance of this panel,
          so the label is sized up to heading weight and the input is
          tall enough that the figure dominates the panel visually. */}
      <div className="space-y-2">
        <label
          className="font-display font-bold uppercase block"
          style={{
            color: '#eef0ff',
            fontSize: 13,
            letterSpacing: '0.08em',
          }}
        >
          You spend
        </label>
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            value={usdtAmount}
            onChange={(e) => setUsdtAmount(e.target.value)}
            placeholder="100"
            inputMode="decimal"
            style={{
              fontSize: 22,
              padding: '12px 14px',
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
            }}
          />
          <span
            className="rounded font-display font-semibold"
            style={{
              background: 'rgba(238,240,255,0.06)',
              color: '#eef0ff',
              padding: '12px 14px',
              fontSize: 14,
            }}
          >
            USDT
          </span>
        </div>
      </div>

      {/* You receive — conditional. Only shows a real IRM amount once
          the user has entered a USDT budget. Before that, the field is
          a clear prompt rather than a misleading "1 IRM" anchor pulled
          from the cheapest row. Fix 4 — bumped label + display size to
          match the YOU SPEND hierarchy. */}
      <div className="space-y-2">
        <label
          className="font-display font-bold uppercase block"
          style={{
            color: '#eef0ff',
            fontSize: 13,
            letterSpacing: '0.08em',
          }}
        >
          You receive (cheapest match)
        </label>
        <div
          className="px-3 rounded tabular-nums"
          style={{
            background: 'rgba(0,0,0,0.25)',
            color: userHasBudget && cheapest ? '#34d399' : 'rgba(238,240,255,0.45)',
            border: '1px solid rgba(255,255,255,0.06)',
            fontFamily: '"JetBrains Mono", monospace',
            fontStyle: userHasBudget && cheapest ? 'normal' : 'italic',
            fontSize: userHasBudget && cheapest ? 20 : 14,
            fontWeight: userHasBudget && cheapest ? 600 : 400,
            padding: '12px 14px',
          }}
        >
          {userHasBudget
            ? (cheapest ? formatIRM(cheapest.amount ?? 0) : '— no matching offer —')
            : 'Enter a USDT amount above'}
        </div>
        <p className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
          {userHasBudget
            ? "Estimated at the cheapest seller's quote. Confirm exact rate in the offer's price note before paying."
            : 'Enter your USDT budget above to see how much IRM you will receive.'}
        </p>
      </div>

      {/* Fix 1 — when there are offers but none have prices, surface a
          single informational notice instead of two "Price not set"
          OfferCards. This explains to the user what they're seeing and
          steers them to the payment-method contact path. */}
      {showNoPricesNotice && (
        <div
          className="p-3 rounded inline-flex items-start gap-2"
          style={{
            background: 'rgba(252,211,77,0.08)',
            border: '1px solid rgba(252,211,77,0.25)',
          }}
        >
          <Info size={14} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
          <div className="text-xs" style={{ color: 'rgba(238,240,255,0.78)', lineHeight: 1.5 }}>
            The current offers do not have prices set. Contact sellers directly via the
            payment method shown.
          </div>
        </div>
      )}

      {/* Cheapest seller card — Fix 6: only visible when there is a
          valid parseable price AND the user has entered a USDT amount.
          Before either is true we show no offer card at all (the
          notice above + the "You receive" field carry the UI). */}
      {cheapest && cheapestPrice && userHasBudget && (
        <OfferCard
          title="Cheapest seller"
          accent="#6EC6FF"
          offer={cheapest}
          stars={reputationStars[cheapest.seller ?? ''] ?? null}
          onSelect={() => onSelectOffer(cheapest)}
          ctaLabel="Take this offer"
        />
      )}

      {/* Top reputation alternative — same gating as the cheapest
          card (Fix 6) plus the existing "don't duplicate the cheapest"
          rule. */}
      {bestReputation && cheapest && bestReputation.offer.id !== cheapest.id && bestRepPrice && userHasBudget && (
        <OfferCard
          title="Top reputation alternative"
          accent="#FBBF24"
          offer={bestReputation.offer}
          stars={bestReputation.stars}
          onSelect={() => onSelectOffer(bestReputation.offer)}
          ctaLabel="Take this instead"
        />
      )}
    </div>
  );
}
