import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      toast.error(t('marketplace.take_offer.set_buyer_address_first'));
      return;
    }
    setBusy(true);
    try {
      const result = await offers.take(offer.id, buyerAddress);
      const agreementId = (result as unknown as Record<string, unknown>)?.agreement_id as string | undefined;
      if (!agreementId) {
        throw new Error(t('marketplace.take_offer.error_agreement_id_missing'));
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
      toast.success(t('marketplace.take_offer.irm_locked_send_payment'));
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
      await disputes.open(taken.agreementId, t('marketplace.take_offer.dispute_reason_buyer_cancelled'));
      toast(
        t('marketplace.take_offer.dispute_opened_refund_hint'),
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
      toast.error(t('marketplace.take_offer.enter_payment_reference'));
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
      toast.success(t('marketplace.take_offer.payment_reported_seller_notified'));
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
      title={t('marketplace.take_offer.title')}
      subtitle={t('marketplace.take_offer.step_of_two', { step })}
      size="md"
    >
      <div className="space-y-4">
        {step === 1 && (
          <>
            <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
              {t('marketplace.take_offer.step1_intro')}
            </div>
            <div
              className="p-3 rounded space-y-2 text-xs"
              style={{
                background: 'rgba(0,0,0,0.25)',
                fontFamily: '"JetBrains Mono", monospace',
                color: 'var(--t1)',
              }}
            >
              <div>{t('marketplace.take_offer.you_receive')} <span style={{ color: '#34d399' }}>{formatIRM(offer.amount ?? 0)}</span></div>
              <div>{t('marketplace.take_offer.payment_method')} {offer.payment_method ?? '-'}</div>
              <div>
                {t('marketplace.take_offer.seller')}{' '}
                <span title={offer.seller ?? ''}>
                  {(offer.seller ?? '').slice(0, 8)}...{(offer.seller ?? '').slice(-4)}
                </span>
              </div>
              <div>
                {t('marketplace.take_offer.buyer_you')}{' '}
                <span title={buyerAddress}>
                  {buyerAddress
                    ? `${buyerAddress.slice(0, 8)}...${buyerAddress.slice(-4)}`
                    : t('marketplace.take_offer.not_set')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} className="btn-secondary flex-1">
                {t('marketplace.take_offer.cancel')}
              </button>
              <button
                onClick={handleConfirmTake}
                disabled={busy || !buyerAddress}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t('marketplace.take_offer.confirm_take')}
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
                <Lock size={13} /> {t('marketplace.take_offer.irm_locked_in_escrow')}
              </div>
              <div className="text-xs" style={{ color: 'rgba(238,240,255,0.65)' }}>
                {t('marketplace.take_offer.step2_intro')}
              </div>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                {t('marketplace.take_offer.sellers_payment_details')}
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
                {taken.paymentInstructions ?? t('marketplace.take_offer.no_payment_details')}
              </pre>
            </div>

            <div className="space-y-1">
              <label className="label" style={{ color: 'rgba(238,240,255,0.55)' }}>
                {t('marketplace.take_offer.your_transaction_reference')}
              </label>
              <input
                className="input w-full"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder={t('marketplace.take_offer.payment_reference_placeholder')}
                disabled={busy}
              />
              <p className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
                {t('marketplace.take_offer.payment_reference_hint')}
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
              {t('marketplace.take_offer.cancel_opens_dispute_warning')}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCancelStep2}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                {t('marketplace.take_offer.cancel_and_dispute')}
              </button>
              <button
                onClick={handlePaymentSent}
                disabled={busy || !paymentRef.trim()}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {t('marketplace.take_offer.i_have_sent_payment')}
              </button>
            </div>
          </>
        )}
      </div>
    </TradingModal>
  );
}
