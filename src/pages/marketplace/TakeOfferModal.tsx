import { useState } from 'react';
import { X, ArrowRight, AlertTriangle, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { offers, agreementSpend, disputes } from '../../lib/tauri';
import type { Offer } from '../../lib/types';
import { formatIRM } from '../../lib/types';

// Two-step take flow. Step 1 = review and confirm; Step 2 = escrow
// funded, show payment instructions, "I sent payment" advances to the
// EscrowProgress tracker on the parent page. Step-2 Cancel calls
// disputes.open() with reason="buyer cancelled before payment" — the
// agreement enters the dispute-pending state; the user can still
// recover IRM via the timeout/refund path but we do not auto-broadcast
// a refund tx (user's explicit decision: let the user decide).

export interface TakeOfferModalProps {
  offer: Offer;
  buyerAddress: string;
  onClose: () => void;
  onTaken: (agreementId: string) => void;
}

type Step = 1 | 2;

interface TakenAgreement {
  agreementId: string;
  paymentInstructions: string | null;
}

export default function TakeOfferModal({
  offer,
  buyerAddress,
  onClose,
  onTaken,
}: TakeOfferModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<TakenAgreement | null>(null);

  const handleConfirmTake = async () => {
    if (!buyerAddress) {
      toast.error('Set your buyer address first');
      return;
    }
    setBusy(true);
    try {
      const result = await offers.take(offer.id, buyerAddress);
      const agreementId = (result as unknown as Record<string, unknown>)?.agreement_id as string | undefined;
      if (!agreementId) {
        throw new Error('Offer taken but agreement id missing in response');
      }
      // Fund + broadcast in the same step so the user only sees one
      // "Escrow Funded" state. If funding fails the user is left at
      // step 1 with the taken-but-unfunded agreement on the node — the
      // toast surfaces the reason; the agreement can be retried from
      // the Agreements page.
      await agreementSpend.fund(agreementId, true);
      const paymentInstructions =
        (offer as unknown as Record<string, unknown>).payment_instructions as string | null | undefined;
      setTaken({
        agreementId,
        paymentInstructions: paymentInstructions ?? null,
      });
      setStep(2);
      toast.success('Escrow funded — send the off-chain payment now');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelStep2 = async () => {
    if (!taken) return;
    setBusy(true);
    try {
      await disputes.open(taken.agreementId, 'buyer cancelled before payment');
      toast(
        'Marked as dispute-pending. Use the Agreements page to claim refund after the timeout.',
        { icon: 'ℹ️' },
      );
      onTaken(taken.agreementId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePaymentSent = () => {
    if (!taken) return;
    onTaken(taken.agreementId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(2,5,14,0.78)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg card p-5 space-y-4"
        style={{ border: '1px solid rgba(110,198,255,0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-display font-semibold" style={{ color: 'var(--t1)' }}>
            Take Offer · Step {step} of 2
          </div>
          <button onClick={onClose} className="btn-secondary px-2 py-1">
            <X size={14} />
          </button>
        </div>

        {step === 1 && (
          <>
            <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
              Review the details. Confirming will create an on-chain agreement and lock the seller's
              IRM in escrow. You then have a deadline to send the off-chain payment.
            </div>
            <div
              className="p-3 rounded space-y-2 text-xs"
              style={{
                background: 'rgba(0,0,0,0.25)',
                fontFamily: '"JetBrains Mono", monospace',
                color: 'var(--t1)',
              }}
            >
              <div>You receive: <span style={{ color: '#34d399' }}>{formatIRM(offer.amount ?? 0)}</span></div>
              <div>Payment method: {offer.payment_method ?? '—'}</div>
              <div>Seller: {offer.seller ?? '—'}</div>
              <div>Buyer (you): {buyerAddress || '— not set —'}</div>
              <div>Timeout height: {offer.timeout_height ?? '—'}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleConfirmTake}
                disabled={busy || !buyerAddress}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Confirm Take
                {!busy && <ArrowRight size={13} />}
              </button>
            </div>
          </>
        )}

        {step === 2 && taken && (
          <>
            <div
              className="p-3 rounded space-y-2"
              style={{
                background: 'rgba(34,197,94,0.10)',
                border: '1px solid rgba(34,197,94,0.25)',
              }}
            >
              <div className="inline-flex items-center gap-2 text-xs font-display font-semibold" style={{ color: '#22c55e' }}>
                <Check size={13} /> Escrow funded
              </div>
              <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
                The seller's IRM is locked on-chain. Send the off-chain payment now.
              </div>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                Payment instructions
              </label>
              <pre
                className="p-3 rounded text-xs whitespace-pre-wrap"
                style={{
                  background: 'rgba(0,0,0,0.25)',
                  color: '#eef0ff',
                  border: '1px solid rgba(255,255,255,0.06)',
                  fontFamily: '"JetBrains Mono", monospace',
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {taken.paymentInstructions ?? 'No instructions in the offer. Contact the seller for payment details.'}
              </pre>
            </div>

            <div
              className="p-2 rounded text-xs inline-flex items-center gap-2"
              style={{
                background: 'rgba(252,211,77,0.10)',
                color: '#fbbf24',
                border: '1px solid rgba(252,211,77,0.25)',
              }}
            >
              <AlertTriangle size={12} />
              Cancelling now marks this agreement as dispute-pending. You can claim a refund after the timeout.
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCancelStep2}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                Cancel and dispute
              </button>
              <button
                onClick={handlePaymentSent}
                disabled={busy}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                I sent payment <ArrowRight size={13} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
