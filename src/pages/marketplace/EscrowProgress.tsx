import { useEffect, useState } from 'react';
import { Check, Loader2, Lock, Send, CheckCircle2, Trophy } from 'lucide-react';
import { agreementSpend } from '../../lib/tauri';

// Plain-language 4-step tracker for an active trade. Polls
// agreementSpend.status() every 5s and maps lifecycle states to a
// jargon-free progression the user can read at a glance:
//
//   1. Locked        - seller's IRM is held in escrow (lifecycle == funded)
//   2. Payment Sent  - buyer has reported they paid off-chain
//                      (paymentSent prop set by the parent take flow)
//   3. Confirmed     - seller has confirmed and released (partially_released)
//   4. Complete      - the trade settled, IRM is with the buyer (released)
//
// Terminal failure states (refunded / expired / cancelled / disputed_*)
// surface as a single banner so the user can find the path forward in
// the Agreements page.

const POLL_INTERVAL_MS = 5_000;

export interface EscrowProgressProps {
  agreementId: string;
  paymentSent: boolean;
}

type Lifecycle =
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

interface AgreementStatusShape {
  agreement_hash?: string;
  lifecycle?: {
    state?: Lifecycle;
    funding?: {
      txid?: string;
    };
  };
}

function stepFor(life: Lifecycle, paymentSent: boolean): { step: 1 | 2 | 3 | 4; terminal: boolean; failed: boolean } {
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
      return { step: 4, terminal: true, failed: true };
    default:
      return { step: 1, terminal: false, failed: false };
  }
}

const STEPS: { label: string; Icon: typeof Lock }[] = [
  { label: 'Locked',       Icon: Lock },
  { label: 'Payment Sent', Icon: Send },
  { label: 'Confirmed',    Icon: CheckCircle2 },
  { label: 'Complete',     Icon: Trophy },
];

// Plain-language human-readable status for the banner under the tracker.
function statusSentence(life: Lifecycle, paymentSent: boolean): string {
  switch (life) {
    case 'draft':
    case 'proposed':
    case 'funded':
      return paymentSent
        ? 'Waiting for the seller to confirm your payment and release the IRM.'
        : 'Your funds are protected. Send the off-chain payment and report it from the take screen.';
    case 'partially_released':
      return 'The seller has confirmed payment and started the release.';
    case 'released':
      return 'The trade is complete. The IRM has been delivered to the buyer.';
    case 'refunded':
      return 'The trade was refunded to the seller.';
    case 'expired':
      return 'The trade expired without releasing. The IRM is returned to the seller.';
    case 'cancelled':
      return 'The trade was cancelled.';
    case 'disputed_metadata_only':
      return 'A dispute has been opened. A resolver will decide who receives the IRM.';
    default:
      return 'Status pending. The node has not yet reported this trade.';
  }
}

export default function EscrowProgress({ agreementId, paymentSent }: EscrowProgressProps) {
  const [status, setStatus] = useState<AgreementStatusShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await agreementSpend.status(agreementId);
        if (cancelled) return;
        setStatus(s as AgreementStatusShape);
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
  }, [agreementId]);

  const life = (status?.lifecycle?.state ?? 'unknown') as Lifecycle;
  const { step, terminal, failed } = stepFor(life, paymentSent);

  return (
    <div className="card p-4 space-y-3" style={{ border: '1px solid rgba(110,198,255,0.18)' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
          Trade progress
        </h3>
      </div>

      {/* Four-step pill tracker. Each step gets its own icon: Lock for
          "Locked", Send for "Payment Sent", CheckCircle2 for "Confirmed",
          Trophy for "Complete". Done steps turn green, the active step
          spins a Loader2 icon, future steps stay muted. */}
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
            ? '#A78BFA'
            : 'rgba(238,240,255,0.25)';
          const StepIcon = spec.Icon;
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
                {done ? <Check size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : <StepIcon size={12} />}
              </div>
              <span className="text-[11px] font-display font-semibold" style={{ color, textAlign: 'center' }}>
                {spec.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Plain-language status banner — describes where the trade is in
          the user's mental model rather than the chain's lifecycle. */}
      <div
        className="px-3 py-2 rounded text-xs"
        style={{
          background: failed ? 'rgba(252,211,77,0.10)' : 'rgba(0,0,0,0.20)',
          border: `1px solid ${failed ? 'rgba(252,211,77,0.25)' : 'rgba(255,255,255,0.06)'}`,
          color: failed ? '#fbbf24' : 'rgba(238,240,255,0.72)',
          lineHeight: 1.5,
        }}
      >
        {statusSentence(life, paymentSent)}
      </div>

      {error && (
        <div className="text-xs" style={{ color: '#fbbf24' }}>
          {error}
        </div>
      )}
    </div>
  );
}
