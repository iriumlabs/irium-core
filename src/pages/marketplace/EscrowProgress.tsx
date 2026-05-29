import { useEffect, useState } from 'react';
import { Check, Circle, ChevronDown, ChevronUp, ExternalLink, Loader2 } from 'lucide-react';
import { agreementSpend, agreements } from '../../lib/tauri';

// 4-step pill tracker for an active trade. Polls agreementSpend.status()
// every 5s and maps lifecycle states to step positions:
//
//   1. Offer Created       — lifecycle.state in {draft, proposed}
//   2. Escrow Funded       — lifecycle.state == 'funded'
//   3. Payment Sent        — user has clicked "I sent payment" (parent
//                            page passes paymentSent=true; we don't
//                            persist this on-chain since the payment
//                            itself is off-chain)
//   4. Trade Complete      — lifecycle.state == 'released'
//
// Anything ending in {refunded, expired, cancelled, disputed_*}
// surfaces as a single banner so the buyer knows the path forward.
//
// The Details expander reveals the hex agreement_hash, the funding
// txid, and a "View on Agreements page" link. Hidden by default to
// keep the new marketplace UX free of jargon.

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
      return { step: 1, terminal: false, failed: false };
    case 'funded':
      return { step: paymentSent ? 3 : 2, terminal: false, failed: false };
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

const STEP_LABELS = ['Offer Created', 'Escrow Funded', 'Payment Sent', 'Trade Complete'];

export default function EscrowProgress({ agreementId, paymentSent }: EscrowProgressProps) {
  const [status, setStatus] = useState<AgreementStatusShape | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busyRefund, setBusyRefund] = useState(false);
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
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: 'rgba(238,240,255,0.55)' }}
        >
          Details {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, idx) => {
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
          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{
                  border: `2px solid ${color}`,
                  color,
                  background: done || active ? 'rgba(0,0,0,0.25)' : 'transparent',
                }}
              >
                {done ? <Check size={12} /> : active ? <Loader2 size={12} className="animate-spin" /> : <Circle size={8} />}
              </div>
              <span className="text-xs" style={{ color, textAlign: 'center' }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {failed && (
        <div
          className="p-2 rounded text-xs"
          style={{
            background: 'rgba(252,211,77,0.10)',
            color: '#fbbf24',
            border: '1px solid rgba(252,211,77,0.25)',
          }}
        >
          State: <code>{life}</code>. The trade did not complete. Use the Agreements page to act on this.
        </div>
      )}

      {error && (
        <div className="text-xs" style={{ color: '#fbbf24' }}>
          {error}
        </div>
      )}

      {expanded && (
        <div
          className="p-3 rounded text-xs space-y-1"
          style={{
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(238,240,255,0.65)',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <div>agreement_id: {agreementId}</div>
          <div>agreement_hash: {status?.agreement_hash ?? '—'}</div>
          <div>funding_txid: {status?.lifecycle?.funding?.txid ?? '—'}</div>
          <div>lifecycle: {life}</div>
          <div>
            <a
              href={`/agreements?id=${agreementId}`}
              className="inline-flex items-center gap-1"
              style={{ color: '#6EC6FF', textDecoration: 'underline' }}
            >
              Open in Agreements <ExternalLink size={10} />
            </a>
          </div>
          {!terminal && (
            <button
              onClick={async () => {
                setBusyRefund(true);
                try {
                  const r = await agreementSpend.refundEligibility(agreementId);
                  // eslint-disable-next-line no-alert
                  window.alert(
                    `Refund eligibility:\n${JSON.stringify(r, null, 2)}`,
                  );
                } catch (e) {
                  // eslint-disable-next-line no-alert
                  window.alert(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusyRefund(false);
                }
              }}
              disabled={busyRefund}
              className="btn-secondary text-xs"
            >
              {busyRefund ? <Loader2 size={11} className="animate-spin" /> : 'Check refund eligibility'}
            </button>
          )}
          {terminal && !failed && (
            <button
              onClick={async () => {
                try {
                  await agreements.audit(agreementId);
                  // eslint-disable-next-line no-alert
                  window.alert('Audit fetched — see browser devtools console for the full record.');
                } catch (e) {
                  // eslint-disable-next-line no-alert
                  window.alert(e instanceof Error ? e.message : String(e));
                }
              }}
              className="btn-secondary text-xs"
            >
              Fetch audit record
            </button>
          )}
        </div>
      )}
    </div>
  );
}
