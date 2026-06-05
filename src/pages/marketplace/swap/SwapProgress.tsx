import { useEffect, useState } from 'react';
import { Check, FileText, Loader2, Send, ShieldCheck, Trophy } from 'lucide-react';
import type { SwapPairConfig } from './pairs/types';
import ProofSubmitInline from './ProofSubmitInline';

// 4-step progress tracker for an active swap.
//   1. Order Created   — escrow tx confirmed on the Irium side
//   2. Payment Sent    — taker has reported they sent the foreign payment
//   3. Proof Submitted — the foreign payment proof has been submitted on Irium
//   4. IRM Received    — the IRM has landed in the recipient wallet
//
// The lifecycle the node reports for a swap mirrors the on-chain state:
//   funded     → step 1
//   payment_sent (taker-reported, off-chain flag)
//                 → step 2
//   partially_released (proof submitted, awaiting maturity)
//                 → step 3
//   released   → step 4
// Terminal failure states (refunded / expired / cancelled / disputed_*)
// flag the active step yellow and surface a plain-language banner.

const POLL_INTERVAL_MS = 5_000;

export type SwapLifecycle =
  | 'draft'
  | 'proposed'
  | 'funded'
  | 'partially_released'
  | 'released'
  | 'refunded'
  | 'expired'
  | 'cancelled'
  | 'disputed_metadata_only'
  | 'unknown';

export interface SwapProgressProps {
  pair: SwapPairConfig;
  swapOutpoint: { txid: string; vout: number };
  paymentSent: boolean;
  // FIX 2: true between handleOrderCreated firing and the post-create
  // polling useEffect seeing the new outpoint in listOrders. When true the
  // status sentence overrides the "Escrow is locked..." copy with a
  // user-facing "Waiting for confirmation (~2 min)" message. Defaults to
  // false so existing callers that don't track post-create confirmation
  // continue to render the pre-FIX-2 copy.
  pendingConfirmation?: boolean;
  fetchStatus?: (outpoint: { txid: string; vout: number }) => Promise<{ lifecycle?: SwapLifecycle }>;
  // FIX BUG 3: taker's Irium address, needed by the inline proof
  // submission panel so it can populate the destination_address field on
  // claim{Btc,Ltc,Doge}Swap. Optional — when missing, the inline panel
  // surfaces a "no wallet loaded yet" error instead of submitting.
  takerIriumdAddress?: string;
  // Whether the current user is the maker (posted the sell/buy order)
  // or the taker (filled someone else's order). Drives the status-sentence
  // copy and whether the inline proof-submission panel renders. Default
  // 'taker' preserves the pre-role-fix behaviour for any caller that
  // hasn't been updated; SwapPanel always sets this explicitly post-fix.
  role?: 'maker' | 'taker';
}

interface StepDef {
  label: string;
  Icon: typeof FileText;
}

function stepFor(life: SwapLifecycle, paymentSent: boolean):
  { step: 1 | 2 | 3 | 4; terminal: boolean; failed: boolean } {
  switch (life) {
    case 'draft':
    case 'proposed':
    case 'funded':
      return { step: paymentSent ? 2 : 1, terminal: false, failed: false };
    case 'partially_released':
      return { step: 3, terminal: false, failed: false };
    case 'released':
      return { step: 4, terminal: true, failed: false };
    case 'refunded':
    case 'expired':
    case 'cancelled':
    case 'disputed_metadata_only':
      return { step: paymentSent ? 3 : 1, terminal: true, failed: true };
    default:
      return { step: 1, terminal: false, failed: false };
  }
}

function statusSentence(
  life: SwapLifecycle,
  paymentSent: boolean,
  pair: SwapPairConfig,
  pendingConfirmation: boolean,
  role: 'maker' | 'taker',
): string {
  // FIX 2: until the freshly-broadcast order is observed in listOrders,
  // surface a clear "Waiting for confirmation (~2 min)" message instead of
  // the post-confirmation "Escrow is locked..." copy. Only override for
  // the pre-payment family of lifecycle states; once partially_released /
  // released / refunded / expired / cancelled / disputed kick in, the
  // lifecycle-specific copy below is correct and should win. Role-aware
  // so the maker doesn't see "Your fill transaction" copy and vice versa.
  if (pendingConfirmation &&
      (life === 'draft' || life === 'proposed' || life === 'funded' || life === 'unknown')) {
    return role === 'maker'
      ? `Your sell order is broadcasting. Waiting for confirmation (~2 min) before it appears in the order book.`
      : `Waiting for confirmation (~2 min). Your fill transaction will land in an Irium block shortly.`;
  }
  switch (life) {
    case 'draft':
    case 'proposed':
    case 'funded':
      // Maker has no foreign payment to send — they posted the order
      // and just wait. Taker is responsible for sending the foreign
      // payment and submitting on-chain proof.
      if (role === 'maker') {
        return `Your sell order is live in the order book. Waiting for a buyer to fill it. When that happens, the buyer sends ${pair.quote.code} to your address and submits the on-chain proof — your IRM releases to them automatically and you receive ${pair.quote.code} at your address. You don't need to do anything else.`;
      }
      return paymentSent
        ? `Waiting for the ${pair.quote.code} payment to confirm on the ${pair.quote.network ?? pair.quote.name} side.`
        // FIX BUG 3: previous copy referred to a non-existent "trade
        // screen". Now points the user at the ProofSubmitInline panel
        // rendered immediately below this status sentence.
        : `Escrow is locked. Send the ${pair.quote.code} payment to the seller, then submit the proof below.`;
    case 'partially_released':
      return role === 'maker'
        ? `Buyer submitted the ${pair.quote.code} payment proof. The IRM is being released to them — your ${pair.quote.code} payment is on its way to your address.`
        : `${pair.quote.code} payment proof has been submitted. The IRM is on its way to the recipient.`;
    case 'released':
      return role === 'maker'
        ? `Swap complete. The ${pair.quote.code} payment has been delivered to your address.`
        : `Swap complete. The IRM has been delivered.`;
    case 'refunded':
      return role === 'maker'
        ? `The trade timed out and the IRM has been refunded to you.`
        : `The trade was refunded to the seller.`;
    case 'expired':
      return role === 'maker'
        ? `The trade expired without releasing. Your IRM is being returned to you.`
        : `The trade expired without releasing. The IRM has been returned to the seller.`;
    case 'cancelled':
      return `The trade was cancelled.`;
    case 'disputed_metadata_only':
      return `A dispute has been opened. A resolver will decide who receives the IRM.`;
    default:
      return `Status pending. The node has not yet reported this trade.`;
  }
}

const STEPS: StepDef[] = [
  { label: 'Order Created', Icon: FileText },
  { label: 'Payment Sent', Icon: Send },
  { label: 'Proof Submitted', Icon: ShieldCheck },
  { label: 'IRM Received', Icon: Trophy },
];

export default function SwapProgress({
  pair,
  swapOutpoint,
  paymentSent,
  pendingConfirmation = false,
  fetchStatus,
  takerIriumdAddress,
  role = 'taker',
}: SwapProgressProps) {
  const [life, setLife] = useState<SwapLifecycle>('unknown');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fetchStatus) {
      // No status fetcher wired — leave the tracker on its initial step
      // and let the parent flow update paymentSent as needed.
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await fetchStatus(swapOutpoint);
        if (cancelled) return;
        setLife((s?.lifecycle ?? 'unknown') as SwapLifecycle);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchStatus, swapOutpoint]);

  const { step, terminal, failed } = stepFor(life, paymentSent);

  return (
    <div
      className="card p-4 space-y-3"
      style={{ border: `1px solid ${pair.accent.glow}` }}
    >
      <div className="flex items-center justify-between">
        <h3
          className="font-display font-semibold text-sm"
          style={{ color: 'var(--t1)' }}
        >
          {pair.label} swap progress
        </h3>
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((spec, idx) => {
          const i = (idx + 1) as 1 | 2 | 3 | 4;
          const done = i < step || (terminal && !failed);
          const active = i === step && !terminal;
          const fail = terminal && failed && i === step;
          const color = fail
            ? '#fbbf24'
            : done
            ? '#22c55e'
            : active
            ? pair.accent.primary
            : 'rgba(238,240,255,0.25)';
          const Icon = spec.Icon;
          return (
            <div key={spec.label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{
                  border: `2px solid ${color}`,
                  color,
                  background: done || active ? 'rgba(0,0,0,0.25)' : 'transparent',
                }}
              >
                {done ? (
                  <Check size={13} />
                ) : active ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Icon size={12} />
                )}
              </div>
              <span
                className="text-[11px] font-display font-semibold text-center"
                style={{ color }}
              >
                {spec.label}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="px-3 py-2 rounded text-xs"
        style={{
          background: failed ? 'rgba(252,211,77,0.10)' : 'rgba(0,0,0,0.20)',
          border: `1px solid ${failed ? 'rgba(252,211,77,0.25)' : 'rgba(255,255,255,0.06)'}`,
          color: failed ? '#fbbf24' : 'rgba(238,240,255,0.72)',
          lineHeight: 1.5,
        }}
      >
        {statusSentence(life, paymentSent, pair, pendingConfirmation, role)}
      </div>

      {/* Inline proof-submission panel — ONLY for the taker. The
          maker has nothing foreign to submit; they just wait for the
          taker's claim to release their IRM. Rendering this for a
          maker would falsely prompt them for a BTC tx they never sent
          (iriumd would reject the claim anyway, but the prompt itself
          is the bug). Hidden while the post-create confirmation poll
          hasn't seen the order yet (pendingConfirmation) and after the
          lifecycle transitions out of funded. */}
      {role === 'taker' &&
        !pendingConfirmation &&
        (life === 'funded' || life === 'draft' || life === 'proposed') &&
        !terminal && (
          <ProofSubmitInline
            pair={pair}
            swapOutpoint={swapOutpoint}
            takerIriumdAddress={takerIriumdAddress ?? ''}
          />
        )}

      {error && (
        <div className="text-xs" style={{ color: '#fbbf24' }}>
          {error}
        </div>
      )}
    </div>
  );
}
