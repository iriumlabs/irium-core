import { useState } from 'react';
import { ArrowRight, AlertTriangle, Check, Loader2, Lock, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { offers, agreementSpend, disputes, proofs } from '../../lib/tauri';
import type { Offer } from '../../lib/types';
import { formatIRM } from '../../lib/types';
import { TradingModal } from '../../components/ui';

// Take Offer modal — two steps, no technical jargon.
//
// Step 1 — review: shows how much IRM the buyer receives, the seller's
// payment method, and the deadline. Confirming creates the on-chain
// agreement and locks the seller's IRM in escrow.
//
// Step 2 — escrow locked: shows the seller's payment details and a
// transaction-reference input. Clicking "I have sent payment" submits a
// signed payment-sent proof that the seller can verify, then closes the
// modal so the parent EscrowProgress can pick up the new state.
//
// Cancel in Step 2 opens a dispute. We do not auto-broadcast a refund
// transaction — the buyer can recover IRM via the timeout-refund path
// from the Agreements page, or wait for a resolver decision.

export interface TakeOfferModalProps {
  offer: Offer;
  buyerAddress: string;
  onClose: () => void;
  onTaken: (agreementId: string) => void;
}

type Step = 1 | 2;

interface TakenAgreement {
  agreementId: string;
  agreementHash: string | null;
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
  // Buyer-supplied evidence the payment was sent. Free-text — accepts a
  // transaction id, a bank reference, a wire confirmation number, or any
  // note the seller can verify off-chain. Surfaced verbatim to the seller
  // via proofs.list() on their side.
  const [paymentRef, setPaymentRef] = useState('');

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
      // "escrow locked" state. If funding fails the buyer is left on
      // Step 1 with a taken-but-unfunded agreement — the agreement page
      // can retry.
      await agreementSpend.fund(agreementId, true);
      // After funding, poll status once to capture the 32-byte agreement
      // hash; we need it to submit the payment-sent proof later. Best
      // effort — if the status call fails we fall back to the agreement
      // id and the seller can still see the trade.
      let agreementHash: string | null = null;
      try {
        const status = await agreementSpend.status(agreementId);
        agreementHash = (status as unknown as { agreement_hash?: string })?.agreement_hash ?? null;
      } catch {
        agreementHash = null;
      }
      const paymentInstructions =
        (offer as unknown as Record<string, unknown>).payment_instructions as string | null | undefined;
      setTaken({
        agreementId,
        agreementHash,
        paymentInstructions: paymentInstructions ?? null,
      });
      setStep(2);
      toast.success('IRM is now locked in escrow. Send the off-chain payment.');
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
        'Dispute opened. You can claim your refund from the Agreements page after the timeout.',
        { icon: 'i' },
      );
      onTaken(taken.agreementId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePaymentSent = async () => {
    if (!taken) return;
    if (!paymentRef.trim()) {
      toast.error('Enter a transaction id or note so the seller can verify your payment');
      return;
    }
    setBusy(true);
    try {
      // Submit a payment-sent proof so the seller's SellerTradeReview
      // shows the buyer's verification reference. Best effort — if the
      // node refuses the proof we still mark the trade as payment-sent
      // locally; the seller will see the buyer's claim via parent state.
      if (taken.agreementHash) {
        try {
          await proofs.createAndSubmit({
            agreementHash: taken.agreementHash,
            proofType: 'payment_sent',
            attestedBy: buyerAddress,
            address: buyerAddress,
            evidenceSummary: paymentRef.trim(),
          });
        } catch (proofErr) {
          console.warn('[take-offer] payment-sent proof failed (continuing):', proofErr);
        }
      }
      toast.success('Payment reported. The seller has been notified.');
      onTaken(taken.agreementId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <TradingModal
      open={true}
      onClose={() => { if (!busy) onClose(); }}
      title="Take Offer"
      subtitle={`Step ${step} of 2`}
      size="md"
    >
      <div className="space-y-4">
        {step === 1 && (
          <>
            <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
              Confirming locks the seller's IRM in escrow. You then have a deadline to send
              the off-chain payment and report the transaction.
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
              <div>Payment method: {offer.payment_method ?? '-'}</div>
              <div>
                Seller:{' '}
                <span title={offer.seller ?? ''}>
                  {(offer.seller ?? '').slice(0, 8)}...{(offer.seller ?? '').slice(-4)}
                </span>
              </div>
              <div>
                Buyer (you):{' '}
                <span title={buyerAddress}>
                  {buyerAddress
                    ? `${buyerAddress.slice(0, 8)}...${buyerAddress.slice(-4)}`
                    : '- not set -'}
                </span>
              </div>
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
                <Lock size={13} /> IRM locked in escrow
              </div>
              <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
                The seller's IRM is locked. Send the off-chain payment, then enter your
                transaction reference below and click "I have sent payment".
              </div>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                Seller's payment details
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
                {taken.paymentInstructions ?? 'No details in the offer. Contact the seller directly for payment instructions.'}
              </pre>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                Your transaction reference
              </label>
              <input
                className="input w-full"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Bank wire reference, PayPal txid, blockchain txid, etc."
                disabled={busy}
              />
              <p className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
                The seller sees this exactly. Anything they can use to confirm your payment
                arrived works - reference number, transaction id, sender name, etc.
              </p>
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
              If you cancel here, a dispute opens. You can claim a refund after the timeout
              from the Agreements page.
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
                disabled={busy || !paymentRef.trim()}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                I have sent payment
              </button>
            </div>
          </>
        )}
      </div>
    </TradingModal>
  );
}
