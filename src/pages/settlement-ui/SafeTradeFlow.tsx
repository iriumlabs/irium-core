import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  TrendingDown, TrendingUp, Loader2, Lock, Send, AlertTriangle, Scale, AlertCircle,
} from 'lucide-react';
import { settlement, agreements, agreementSpend, proofs, disputes } from '../../lib/tauri';
import { useIriumEvents } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { SATS_PER_IRM, formatIRM } from '../../lib/types';
import type { Agreement } from '../../lib/types';
import WizardShell from '../../components/settlement-ui/WizardShell';
import AmountInput from '../../components/settlement-ui/AmountInput';
import AddressInput from '../../components/settlement-ui/AddressInput';
import DurationPicker from '../../components/settlement-ui/DurationPicker';
import DealCode from '../../components/settlement-ui/DealCode';
import EscrowProgress from '../marketplace/EscrowProgress';
import SellerTradeReview from '../marketplace/SellerTradeReview';
import ResolverPicker from '../marketplace/ResolverPicker';

// SafeTradeFlow - direct-counterparty OTC settlement, plain-language
// edition. Two parties who already know each other (no public order
// book) set up an escrow via a deal code. The wizard collects the
// minimum details, locks the seller's IRM, and then drops the user
// into the shared 4-step Locked / Payment Sent / Confirmed / Complete
// tracker used by the marketplace flow.
//
// Step 3 (the "live trade" screen) reuses the same components as the
// public marketplace so a user moving between the two surfaces sees
// the same vocabulary, the same confirm + dispute actions, and the
// same resolver picker:
//
//   * EscrowProgress     - the 4-icon lifecycle pill
//   * SellerTradeReview  - seller verify-and-release with the buyer's
//                          payment proof rendered verbatim
//   * ResolverPicker     - modal listing nominated + registered
//                          resolvers when a dispute is open
//
// No HTLC / preimage / secret hash / agreement hash / policy talk
// surfaces anywhere in this file's user-visible strings. Amounts are
// formatted via formatIRM(sats); addresses are shortened 8...4 at the
// call site where they appear.

type Side = 'selling' | 'buying';
type WizardStep = 0 | 1 | 2 | 3;

interface AgreementStatusShape {
  agreement_hash?: string;
  lifecycle?: {
    state?: string;
  };
}

function shortAddr(addr: string | undefined | null): string {
  if (!addr) return '-';
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
}

export default function SafeTradeFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selfAddress = addresses[activeAddrIdx]?.address ?? '';

  const [step, setStep] = useState<WizardStep>(0);
  const [side, setSide] = useState<Side | null>(null);

  // Selling-path state.
  const [sBuyerAddr, setSBuyerAddr] = useState('');
  const [sAmountIrm, setSAmountIrm] = useState('');
  const [sReceiving, setSReceiving] = useState('');
  const [sDeadlineHours, setSDeadlineHours] = useState(24);
  const [sErrors, setSErrors] = useState<Record<string, string>>({});
  const [sCreating, setSCreating] = useState(false);
  const [sAgreementId, setSAgreementId] = useState<string | null>(null);
  // Full Agreement object after `agreements.show()` succeeds. Fed into
  // SellerTradeReview as a one-element array so the seller verify pane
  // surfaces the buyer's payment-sent proof and the Confirm/Dispute
  // buttons against this single trade. Also passed to ResolverPicker if
  // a dispute is opened from the inline panel.
  const [sAgreement, setSAgreement] = useState<Agreement | null>(null);

  // Buying-path state.
  const [bAgreementId, setBAgreementId] = useState<string | null>(null);
  const [bAgreement, setBAgreement] = useState<Agreement | null>(null);
  const [bFunding, setBFunding] = useState(false);
  // Buyer-side payment reporting. Mirrors TakeOfferModal's Step 2 -
  // the buyer types a transaction reference (bank wire ref, txid,
  // paypal id) and clicking "I have sent payment" submits it as a
  // payment_sent proof so the seller's verify inbox lights up.
  const [bPaymentRef, setBPaymentRef] = useState('');
  const [bPaymentSent, setBPaymentSent] = useState(false);
  const [bSubmittingProof, setBSubmittingProof] = useState(false);
  const [bDisputing, setBDisputing] = useState(false);

  // ResolverPicker modal. Holds the agreement to display. When either
  // side opens a dispute or just wants to see who can resolve, we set
  // this to the live agreement object.
  const [resolverPickerAgreement, setResolverPickerAgreement] = useState<Agreement | null>(null);

  // Live status snapshot. EscrowProgress polls on its own cadence, but
  // we also poll once here so the wizard knows when to enable the
  // buyer's payment-sent button (after lifecycle reaches 'funded') and
  // when a dispute has been opened.
  const [statusSnapshot, setStatusSnapshot] = useState<AgreementStatusShape | null>(null);

  const liveAgreementId = side === 'selling' ? sAgreementId : bAgreementId;
  const liveAgreement = side === 'selling' ? sAgreement : bAgreement;

  // Light-weight 8s poll for the lifecycle snapshot used by the wizard
  // itself. EscrowProgress runs its own 5s poll for the visible UI; we
  // intentionally do not bridge state between them to keep the
  // components decoupled.
  useEffect(() => {
    if (!liveAgreementId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await agreementSpend.status(liveAgreementId);
        if (!cancelled) setStatusSnapshot(s as AgreementStatusShape);
      } catch {
        // best effort
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveAgreementId]);

  // Phase-5 WS push - refresh the snapshot immediately when any
  // agreement.* event names our agreement.
  useIriumEvents((event) => {
    if (!liveAgreementId) return;
    if (event.type.startsWith('agreement.')) {
      const evtId = (event.data as Record<string, unknown>)?.agreement_id;
      if (evtId === liveAgreementId) {
        agreementSpend.status(liveAgreementId).then((s) => {
          if (s) setStatusSnapshot(s as AgreementStatusShape);
        }).catch(() => {});
      }
    }
  });

  const handleBack = (prev: number) => {
    if (prev < 0) { navigate('/settlement'); return; }
    setStep(prev as WizardStep);
  };

  const validateSellingForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!sBuyerAddr.trim()) errs.buyer = 'Buyer address is required';
    const parsed = parseFloat(sAmountIrm);
    if (!sAmountIrm.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      errs.amount = 'Enter the amount of IRM you want to sell';
    }
    if (!sReceiving.trim()) errs.receiving = 'Tell the buyer what you want in return (e.g. 50 USDT)';
    setSErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateAgreement = async () => {
    setSCreating(true);
    let agreementId: string | null = null;
    try {
      // settlement.otc creates the OTC agreement; sats input is converted
      // back from the human-friendly IRM input here so the rest of the
      // form never has to think about denominations.
      const res = await settlement.otc({
        buyer: sBuyerAddr.trim(),
        seller: selfAddress,
        amount_sats: Math.round(parseFloat(sAmountIrm) * SATS_PER_IRM),
        deadline_hours: sDeadlineHours,
        asset_reference: sReceiving.trim(),
        payment_method: sReceiving.trim(),
      });
      agreementId = res?.agreement_id ?? null;
      if (!agreementId) throw new Error('Agreement creation returned no id');
    } catch (e) {
      console.error('[safe-trade] create failed:', e);
      toast.error(e instanceof Error ? e.message : String(e));
      setSCreating(false);
      return;
    }
    // Fund + broadcast inside the same step so the user sees a single
    // "Your IRM is now locked" confirmation. If funding fails the
    // agreement is on-chain but orphaned; we surface that explicitly
    // and route the user to the Agreements page to retry.
    try {
      await agreementSpend.fund(agreementId, true);
    } catch (fundErr) {
      console.error('[safe-trade] fund failed (agreement orphaned):', fundErr);
      toast.error('Agreement created but funding failed. Open the Agreements page to retry.');
      setTimeout(() => navigate('/agreements'), 3000);
      setSCreating(false);
      return;
    }
    setSAgreementId(agreementId);
    // Pull the full Agreement object so the seller verify pane and the
    // resolver picker can read primary/fallback resolver fields,
    // amounts, parties, etc.
    try {
      const full = await agreements.show(agreementId);
      if (full) setSAgreement(full);
    } catch (e) {
      console.warn('[safe-trade] agreements.show after create failed:', e);
    }
    setStep(3);
    setSCreating(false);
  };

  const handleFundAsBuyer = async () => {
    if (!bAgreementId) return;
    setBFunding(true);
    try {
      await agreementSpend.fund(bAgreementId, true);
      toast.success('Your side is now linked to the trade. Send the off-chain payment to the seller.');
      setStep(3);
    } catch (e) {
      console.error('[safe-trade] buyer fund failed:', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBFunding(false);
    }
  };

  const handleBuyerSendPayment = async () => {
    if (!bAgreementId) return;
    if (!bPaymentRef.trim()) {
      toast.error('Enter a transaction reference so the seller can verify your payment.');
      return;
    }
    setBSubmittingProof(true);
    try {
      const hash = statusSnapshot?.agreement_hash ?? null;
      if (hash) {
        try {
          await proofs.createAndSubmit({
            agreementHash: hash,
            proofType: 'payment_sent',
            attestedBy: selfAddress,
            address: selfAddress,
            evidenceSummary: bPaymentRef.trim(),
          });
        } catch (proofErr) {
          // Non-fatal - we still mark the trade as payment-sent
          // locally so the wizard's progress tracker advances; the
          // seller may need a manual nudge if the proof submission
          // failed.
          console.warn('[safe-trade] payment-sent proof submit failed:', proofErr);
        }
      }
      setBPaymentSent(true);
      toast.success('Payment reported. Waiting for the seller to confirm.');
    } finally {
      setBSubmittingProof(false);
    }
  };

  const handleBuyerOpenDispute = async () => {
    if (!bAgreementId) return;
    setBDisputing(true);
    try {
      await disputes.open(bAgreementId, 'buyer cannot complete the trade');
      toast.success('Dispute opened. A resolver will review the evidence.');
      // Pop the resolver picker immediately so the buyer can see the
      // nominated resolvers and the public registry.
      if (bAgreement) setResolverPickerAgreement(bAgreement);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBDisputing(false);
    }
  };

  // ============================================================
  // Renderers
  // ============================================================

  const renderStep0 = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => { setSide('selling'); setStep(1); }}
        className="card-interactive p-8 text-left flex flex-col gap-4 cursor-pointer min-h-[180px]"
      >
        <div className="p-3 rounded-xl w-fit bg-emerald-500/15 border border-emerald-500/30">
          <TrendingUp size={22} className="text-emerald-400" />
        </div>
        <div>
          <div className="font-display font-bold text-lg text-white">I am selling IRM</div>
          <div className="text-white/45 text-sm mt-2 leading-relaxed">
            Lock your IRM in escrow. The buyer pays you off-chain, then you release.
          </div>
        </div>
      </motion.button>
      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => { setSide('buying'); setStep(1); }}
        className="card-interactive p-8 text-left flex flex-col gap-4 cursor-pointer min-h-[180px]"
      >
        <div className="p-3 rounded-xl w-fit bg-irium-500/15 border border-irium-500/30">
          <TrendingDown size={22} className="text-irium-400" />
        </div>
        <div>
          <div className="font-display font-bold text-lg text-white">I am buying IRM</div>
          <div className="text-white/45 text-sm mt-2 leading-relaxed">
            Paste the seller's deal code. Send them payment, then confirm to receive IRM.
          </div>
        </div>
      </motion.button>
    </div>
  );

  // SELLING Step 1 - plain form, four fields.
  const renderSellingStep1 = () => (
    <div className="card p-6 space-y-5">
      <div className="space-y-1">
        <AddressInput
          value={sBuyerAddr}
          onChange={(v) => { setSBuyerAddr(v); if (sErrors.buyer) setSErrors((p) => { const n = { ...p }; delete n.buyer; return n; }); }}
          label="Buyer's address"
          error={sErrors.buyer}
        />
        <p className="text-xs text-white/35">
          The address that receives the IRM when you confirm the buyer paid.
        </p>
      </div>
      <AmountInput
        value={sAmountIrm}
        onChange={(v) => { setSAmountIrm(v); if (sErrors.amount) setSErrors((p) => { const n = { ...p }; delete n.amount; return n; }); }}
        label="Amount of IRM to sell"
        helper="Held in escrow until you confirm the buyer's payment."
        error={sErrors.amount}
      />
      <div className="space-y-1">
        <label className="label">What you receive in return</label>
        <input
          type="text"
          value={sReceiving}
          onChange={(e) => { setSReceiving(e.target.value); if (sErrors.receiving) setSErrors((p) => { const n = { ...p }; delete n.receiving; return n; }); }}
          placeholder="e.g. 50 USDT via SEPA bank transfer"
          className={`input ${sErrors.receiving ? 'border-red-500/50' : ''}`}
        />
        {sErrors.receiving && (
          <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
            <AlertCircle size={11} />{sErrors.receiving}
          </p>
        )}
      </div>
      <DurationPicker
        value={sDeadlineHours}
        onChange={setSDeadlineHours}
        label="Deadline for the buyer to pay"
        helper="If no payment arrives by the deadline you can claim a refund."
      />
      <button
        onClick={() => { if (validateSellingForm()) setStep(2); }}
        className="btn-primary w-full cursor-pointer"
      >
        Continue
      </button>
    </div>
  );

  // SELLING Step 2 - review and lock.
  const renderSellingStep2 = () => {
    const sats = Math.round((parseFloat(sAmountIrm) || 0) * SATS_PER_IRM);
    return (
      <div className="card p-6 space-y-5">
        <div className="space-y-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">You lock</div>
            <div className="font-display font-bold text-2xl gradient-text">{formatIRM(sats)}</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">Buyer pays you</div>
            <div className="text-sm text-white">{sReceiving}</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">Payment deadline</div>
            <div className="text-sm text-white">{sDeadlineHours} hours from now</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">Buyer's address</div>
            <div
              className="text-sm text-white"
              title={sBuyerAddr}
              style={{ fontFamily: '"JetBrains Mono", monospace' }}
            >
              {shortAddr(sBuyerAddr)}
            </div>
          </div>
        </div>
        <button
          onClick={handleCreateAgreement}
          disabled={sCreating}
          className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {sCreating ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
          Lock my IRM
        </button>
        <p className="text-xs text-white/35 text-center">
          A blockchain transaction will be broadcast. This may take a moment to confirm.
        </p>
      </div>
    );
  };

  // SELLING Step 3 - live trade. Hero confirmation + EscrowProgress +
  // SellerTradeReview (single trade) + deal-code share for the buyer.
  const renderSellingStep3 = () => {
    return (
      <div className="space-y-4">
        {/* Hero confirmation - plain language, the central reassurance
            of the entire flow. */}
        <div
          className="rounded p-4 inline-flex items-start gap-3 w-full"
          style={{
            background: 'rgba(34,197,94,0.10)',
            border: '1px solid rgba(34,197,94,0.30)',
          }}
        >
          <Lock size={18} style={{ color: '#22c55e', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className="font-display font-bold text-white text-sm">
              Your IRM is now locked and protected
            </div>
            <div className="text-xs text-white/65 mt-1 leading-relaxed">
              The buyer cannot take it without your confirmation. Share the deal code below
              so they can join, then wait for their payment.
            </div>
          </div>
        </div>

        {/* Lifecycle pill - shared component from the marketplace
            flow. Polls status internally; paymentSent is always false
            from the seller's perspective since the buyer reports it. */}
        {sAgreementId && (
          <EscrowProgress agreementId={sAgreementId} paymentSent={false} />
        )}

        {/* Deal code for the seller to send to the buyer. */}
        {sAgreementId && (
          <div
            className="card p-4 space-y-3"
            style={{ border: '1px solid rgba(110,198,255,0.18)' }}
          >
            <div>
              <h3 className="font-display font-semibold text-sm text-white">Share this deal code</h3>
              <p className="text-xs text-white/55 mt-1">
                The buyer pastes this code in their wallet to join the trade.
              </p>
            </div>
            <DealCode mode="display" agreementId={sAgreementId} />
          </div>
        )}

        {/* Seller verify-and-release pane - one-element trades array so
            the marketplace component renders this single trade. When
            the buyer submits a payment-sent proof it surfaces here;
            Confirm and Open-dispute live inside the component. */}
        <SellerTradeReview
          sellingTrades={sAgreement ? [{ agreement: sAgreement, side: 'selling' }] : []}
          onDisputeOpened={() => {
            if (sAgreement) setResolverPickerAgreement(sAgreement);
          }}
        />

        {/* Manual "Open resolvers" link in case the seller wants to
            inspect candidates before raising a dispute. */}
        {sAgreement && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setResolverPickerAgreement(sAgreement)}
              className="inline-flex items-center gap-1.5 text-xs"
              style={{ color: 'rgba(252,211,77,0.85)' }}
            >
              <Scale size={11} /> View available resolvers
            </button>
          </div>
        )}
      </div>
    );
  };

  // BUYING Step 1 - paste deal code.
  const renderBuyingStep1 = () => (
    <div className="card p-6 space-y-4">
      <DealCode
        mode="input"
        onSuccess={async (id) => {
          setBAgreementId(id);
          setBAgreement(null);
          try {
            const a = await agreements.show(id);
            setBAgreement(a);
          } catch (e) {
            console.warn('[safe-trade] post-unpack show failed:', e);
          }
          setStep(2);
        }}
      />
    </div>
  );

  // BUYING Step 2 - review and link to the trade.
  const renderBuyingStep2 = () => (
    <div className="card p-6 space-y-5">
      <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
        <p className="text-sm text-white/65 leading-relaxed">
          Confirm the trade details below. By continuing, you commit to this trade. After this
          step, send the off-chain payment to the seller and report it from the next screen.
        </p>
      </div>

      {bAgreement ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">Seller is locking</div>
            <div className="font-display font-bold text-2xl gradient-text">
              {formatIRM(bAgreement.amount)}
            </div>
          </div>
          {bAgreement.seller && (
            <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
              <div className="text-xs text-white/40 mb-1">Seller</div>
              <div
                className="text-sm text-white"
                title={bAgreement.seller}
                style={{ fontFamily: '"JetBrains Mono", monospace' }}
              >
                {shortAddr(bAgreement.seller)}
              </div>
            </div>
          )}
        </div>
      ) : bAgreementId ? (
        <div className="rounded-lg bg-amber-500/8 border border-amber-500/25 p-4 space-y-2">
          <p className="text-xs text-amber-200 leading-relaxed">
            Trade details did not load. You can still continue, but verify the IRM amount
            with the seller before paying.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => { setBAgreementId(null); setBAgreement(null); setStep(1); }}
          className="btn-secondary w-full cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleFundAsBuyer}
          disabled={bFunding || !bAgreementId}
          className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {bFunding ? <Loader2 size={15} className="animate-spin" /> : null}
          Continue and link
        </button>
      </div>
    </div>
  );

  // BUYING Step 3 - live trade. Lifecycle tracker + report payment +
  // dispute fallback + resolver inspection link.
  const renderBuyingStep3 = () => {
    const lifecycle = statusSnapshot?.lifecycle?.state ?? 'unknown';
    const isComplete = lifecycle === 'released';
    return (
      <div className="space-y-4">
        <div
          className="rounded p-4 inline-flex items-start gap-3 w-full"
          style={{
            background: isComplete ? 'rgba(34,197,94,0.10)' : 'rgba(110,198,255,0.08)',
            border: isComplete ? '1px solid rgba(34,197,94,0.30)' : '1px solid rgba(110,198,255,0.25)',
          }}
        >
          <Lock size={18} style={{ color: isComplete ? '#22c55e' : '#6EC6FF', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className="font-display font-bold text-white text-sm">
              {isComplete
                ? 'Trade complete'
                : 'The seller\'s IRM is locked for you'}
            </div>
            <div className="text-xs text-white/65 mt-1 leading-relaxed">
              {isComplete
                ? 'The IRM has arrived in your wallet.'
                : 'Send the off-chain payment to the seller, then report your transaction reference below.'}
            </div>
          </div>
        </div>

        {bAgreementId && (
          <EscrowProgress agreementId={bAgreementId} paymentSent={bPaymentSent} />
        )}

        {/* Buyer payment-report panel. Mirrors TakeOfferModal step 2
            but inline. Disabled once the buyer has clicked
            "I have sent payment" so they cannot double-submit. */}
        {!isComplete && (
          <div
            className="card p-4 space-y-3"
            style={{ border: '1px solid rgba(167,139,250,0.20)' }}
          >
            <div>
              <h3 className="font-display font-semibold text-sm text-white">
                Report your payment
              </h3>
              <p className="text-xs text-white/55 mt-1 leading-relaxed">
                After you send the off-chain payment, paste any reference the seller can use
                to confirm it arrived - bank wire reference, PayPal transaction id, etc.
              </p>
            </div>
            <input
              className="input w-full"
              value={bPaymentRef}
              onChange={(e) => setBPaymentRef(e.target.value)}
              placeholder="Bank wire reference, PayPal txid, blockchain txid, etc."
              disabled={bPaymentSent || bSubmittingProof}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={handleBuyerOpenDispute}
                disabled={bDisputing}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-display font-semibold"
                style={{
                  color: '#fbbf24',
                  background: 'rgba(252,211,77,0.10)',
                  border: '1px solid rgba(252,211,77,0.30)',
                  cursor: bDisputing ? 'wait' : 'pointer',
                }}
              >
                {bDisputing ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />}
                Cancel and open dispute
              </button>
              <button
                onClick={handleBuyerSendPayment}
                disabled={bSubmittingProof || bPaymentSent || !bPaymentRef.trim()}
                className="btn-primary inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {bSubmittingProof ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {bPaymentSent ? 'Payment reported' : 'I have sent payment'}
              </button>
            </div>
          </div>
        )}

        {isComplete && (
          <button
            onClick={() => navigate('/agreements')}
            className="btn-primary w-full cursor-pointer"
          >
            View in Agreements
          </button>
        )}

        {bAgreement && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setResolverPickerAgreement(bAgreement)}
              className="inline-flex items-center gap-1.5 text-xs"
              style={{ color: 'rgba(252,211,77,0.85)' }}
            >
              <Scale size={11} /> View available resolvers
            </button>
          </div>
        )}
      </div>
    );
  };

  // Page header per step.
  const getHeader = (): { title: string; subtitle?: string } => {
    if (step === 0) {
      return {
        title: t('settlement_ui.safe_trade.step1_title'),
        subtitle: t('settlement_ui.safe_trade.step1_subtitle'),
      };
    }
    if (side === 'selling') {
      if (step === 1) return { title: 'Set up your sell trade', subtitle: 'Tell us who the buyer is and how much IRM you want to sell.' };
      if (step === 2) return { title: 'Review and lock', subtitle: 'Confirm the details. Locking sends the IRM to escrow.' };
      if (step === 3) return { title: 'Your trade is live', subtitle: 'Share the deal code with the buyer and wait for their payment.' };
    }
    if (side === 'buying') {
      if (step === 1) return { title: 'Paste the seller\'s deal code', subtitle: 'The seller will have sent you a code after they locked their IRM.' };
      if (step === 2) return { title: 'Review the trade', subtitle: 'Make sure the amount and seller match what you expect.' };
      if (step === 3) return { title: 'Your trade is live', subtitle: 'Send the off-chain payment, then report it so the seller can release the IRM.' };
    }
    return { title: '' };
  };

  const header = getHeader();

  return (
    <>
      <WizardShell
        totalSteps={4}
        currentStep={step}
        onBack={handleBack}
        title={header.title}
        subtitle={header.subtitle}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${side ?? 'choose'}-${step}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && renderStep0()}
            {step === 1 && side === 'selling' && renderSellingStep1()}
            {step === 2 && side === 'selling' && renderSellingStep2()}
            {step === 3 && side === 'selling' && renderSellingStep3()}
            {step === 1 && side === 'buying' && renderBuyingStep1()}
            {step === 2 && side === 'buying' && renderBuyingStep2()}
            {step === 3 && side === 'buying' && renderBuyingStep3()}
          </motion.div>
        </AnimatePresence>
      </WizardShell>

      {resolverPickerAgreement && (
        <ResolverPicker
          agreement={resolverPickerAgreement}
          onClose={() => setResolverPickerAgreement(null)}
        />
      )}
    </>
  );
}
