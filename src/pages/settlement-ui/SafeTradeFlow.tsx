import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { TrendingDown, TrendingUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { settlement, agreements, agreementSpend, proofs } from '../../lib/tauri';
import { useIriumEvents } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { SATS_PER_IRM, formatIRM } from '../../lib/types';
import type { AgreementStatusResult, Agreement } from '../../lib/types';
import WizardShell from '../../components/settlement-ui/WizardShell';
import AmountInput from '../../components/settlement-ui/AmountInput';
import AddressInput from '../../components/settlement-ui/AddressInput';
import DurationPicker from '../../components/settlement-ui/DurationPicker';
import DealCode from '../../components/settlement-ui/DealCode';
import TechnicalDetails from '../../components/settlement-ui/TechnicalDetails';
import StatusBadge from '../../components/settlement-ui/StatusBadge';
import { plainStatusFromStatusResult } from '../../components/settlement-ui/PlainStatus';
import { mapErrorToKey } from '../../components/settlement-ui/ErrorMapper';

type Side = 'selling' | 'buying';
type WizardStep = 0 | 1 | 2 | 3;

const POLL_MS = 5000;

export default function SafeTradeFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selfAddress = addresses[activeAddrIdx]?.address ?? '';

  const [step, setStep] = useState<WizardStep>(0);
  const [side, setSide] = useState<Side | null>(null);

  // Selling-path state
  const [sBuyerAddr, setSBuyerAddr] = useState('');
  const [sAmountIrm, setSAmountIrm] = useState('');
  const [sReceiving, setSReceiving] = useState('');
  const [sDeadlineHours, setSDeadlineHours] = useState(24);
  const [sErrors, setSErrors] = useState<Record<string, string>>({});
  const [sCreating, setSCreating] = useState(false);
  const [sAgreementId, setSAgreementId] = useState<string | null>(null);
  // sAgreementHash holds the 64-hex SHA256 returned by settlement.otc(). The
  // proof-create-and-submit backend command requires this hash specifically
  // (NOT the agreement_id label), so we store it separately the moment
  // creation completes and use it in handleConfirmReceived below.
  const [sAgreementHash, setSAgreementHash] = useState<string | null>(null);
  const [sReleasing, setSReleasing] = useState(false);

  // Buying-path state
  const [bAgreementId, setBAgreementId] = useState<string | null>(null);
  // Full imported Agreement after agreement.unpack() so the review step can
  // show amount + seller before the user funds. Null while the show() call
  // is in flight or if it fails (review still shows a fallback note).
  const [bImportedAgreement, setBImportedAgreement] = useState<Agreement | null>(null);
  const [bFunding, setBFunding] = useState(false);

  // Shared poll state — used by Step 4 of both paths.
  const [status, setStatus] = useState<AgreementStatusResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveAgreementId = side === 'selling' ? sAgreementId : bAgreementId;

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const s = await agreementSpend.status(id);
        if (s) setStatus(s);
      } catch { /* offline */ }
    };
    tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Phase 5 event push — refresh status immediately when the WS bridge
  // reports any agreement.* event for our agreement.
  useIriumEvents((event) => {
    if (!liveAgreementId) return;
    if (event.type.startsWith('agreement.')) {
      const evtId = (event.data as Record<string, unknown>)?.agreement_id;
      if (evtId === liveAgreementId) {
        agreementSpend.status(liveAgreementId).then((s) => { if (s) setStatus(s); }).catch(() => {});
      }
    }
  });

  // Navigation when the user clicks Back on each step.
  const handleBack = (prev: number) => {
    if (prev < 0) { navigate('/settlement'); return; }
    setStep(prev as WizardStep);
  };

  const validateSellingStep1 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!sBuyerAddr.trim()) errs.buyer = t('settlement_ui.safe_trade.errors.buyer_required');
    if (!sAmountIrm.trim() || isNaN(parseFloat(sAmountIrm)) || parseFloat(sAmountIrm) <= 0) {
      errs.amount = t('settlement_ui.safe_trade.errors.amount_required');
    }
    if (!sReceiving.trim()) errs.receiving = t('settlement_ui.safe_trade.errors.receiving_required');
    setSErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateAgreement = async () => {
    setSCreating(true);
    let res: { agreement_id?: string; hash?: string } | null = null;
    try {
      res = await settlement.otc({
        buyer: sBuyerAddr.trim(),
        seller: selfAddress,
        amount_sats: Math.round(parseFloat(sAmountIrm) * SATS_PER_IRM),
        deadline_hours: sDeadlineHours,
        asset_reference: sReceiving.trim(),
        payment_method: sReceiving.trim(),
      });
      if (!res?.agreement_id) throw new Error('No agreement id returned');
    } catch (e) {
      console.error('[safe-trade] create failed:', e);
      toast.error(t(mapErrorToKey(e, 'create')));
      setSCreating(false);
      return;
    }
    // S3 fix: split create from fund so a fund failure shows the
    // orphan-recovery toast instead of a generic create error. The
    // agreement is on-chain at this point; user can finish funding via
    // /agreements.
    try {
      await agreementSpend.fund(res.agreement_id!, true);
    } catch (fundErr) {
      console.error('[safe-trade] fund failed (agreement orphaned):', fundErr);
      toast.error('Agreement created but funding failed. Find it in your Agreements page to retry funding.');
      setTimeout(() => navigate('/agreements'), 3000);
      setSCreating(false);
      return;
    }
    setSAgreementId(res.agreement_id!);
    if (res.hash) setSAgreementHash(res.hash);
    startPolling(res.agreement_id!);
    setStep(3);
    setSCreating(false);
  };

  const handleConfirmReceived = async () => {
    if (!sAgreementId) return;
    setSReleasing(true);
    try {
      // Submit the delivery_confirmed proof. The seller is the attester
      // (they're confirming they got their off-chain money). After
      // proof_final the policy is satisfied and release_eligible flips.
      //
      // agreementHash MUST be the 64-hex hash, not the agreement_id
      // label. Prefer status.agreement_hash (post-poll), fall back to
      // the hash captured at creation time. Refuse to submit if neither
      // is available — sending an agreement_id as the hash silently
      // fails backend validation.
      const agreementHash = status?.agreement_hash ?? sAgreementHash;
      if (!agreementHash) {
        toast.error(t('settlement_ui.errors.generic'));
        return;
      }
      await proofs.createAndSubmit({
        agreementHash,
        proofType: 'delivery_confirmed',
        attestedBy: selfAddress,
        address: selfAddress,
      }).catch((e) => {
        // If a proof already exists (idempotent retry), continue — we
        // still want to attempt the release.
        console.warn('[safe-trade] proof submit failed (continuing):', e);
      });
      // Attempt the release. If proof isn't yet final, the backend will
      // refuse with a release_not_ready error — we map that to a clear
      // "wait for confirmations" toast.
      try {
        const secret = await agreements.getSecret(sAgreementId);
        await agreements.release(sAgreementId, secret, true);
        toast.success(t('settlement_ui.safe_trade.toast_released'));
      } catch (releaseErr) {
        const key = mapErrorToKey(releaseErr, 'release');
        if (key === 'settlement_ui.errors.release_not_ready') {
          toast(t('settlement_ui.safe_trade.toast_release_pending'));
        } else {
          toast.error(t(key));
        }
      }
    } finally {
      setSReleasing(false);
    }
  };

  const handleFundAsBuyer = async () => {
    if (!bAgreementId) return;
    setBFunding(true);
    try {
      await agreementSpend.fund(bAgreementId, true);
      toast.success(t('settlement_ui.safe_trade.toast_funded'));
      startPolling(bAgreementId);
      setStep(3);
    } catch (e) {
      console.error('[safe-trade] buyer fund failed:', e);
      toast.error(t(mapErrorToKey(e, 'fund')));
    } finally {
      setBFunding(false);
    }
  };

  const totalSteps = 4;

  // Step 1 — common entry for either side.
  const renderStep1 = () => (
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
          <div className="font-display font-bold text-lg text-white">{t('settlement_ui.safe_trade.selling_button')}</div>
          <div className="text-white/45 text-sm mt-2 leading-relaxed">{t('settlement_ui.safe_trade.selling_subtitle')}</div>
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
          <div className="font-display font-bold text-lg text-white">{t('settlement_ui.safe_trade.buying_button')}</div>
          <div className="text-white/45 text-sm mt-2 leading-relaxed">{t('settlement_ui.safe_trade.buying_subtitle')}</div>
        </div>
      </motion.button>
    </div>
  );

  // Selling Step 2 — collect trade details.
  const renderSellingStep2 = () => (
    <div className="card p-6 space-y-5">
      <div className="space-y-1">
        <AddressInput
          value={sBuyerAddr}
          onChange={(v) => { setSBuyerAddr(v); if (sErrors.buyer) setSErrors((p) => { const n = { ...p }; delete n.buyer; return n; }); }}
          label={t('settlement_ui.safe_trade.selling.buyer_address_label')}
          error={sErrors.buyer}
        />
        <p className="text-xs text-white/35">
          You need the buyer's address so the escrow knows who receives the IRM once you confirm payment received.
        </p>
      </div>
      <AmountInput
        value={sAmountIrm}
        onChange={(v) => { setSAmountIrm(v); if (sErrors.amount) setSErrors((p) => { const n = { ...p }; delete n.amount; return n; }); }}
        label={t('settlement_ui.safe_trade.selling.amount_label')}
        helper={t('settlement_ui.safe_trade.selling.amount_helper')}
        error={sErrors.amount}
      />
      <div className="space-y-1">
        <label className="label">{t('settlement_ui.safe_trade.selling.receiving_label')}</label>
        <input
          type="text"
          value={sReceiving}
          onChange={(e) => { setSReceiving(e.target.value); if (sErrors.receiving) setSErrors((p) => { const n = { ...p }; delete n.receiving; return n; }); }}
          placeholder={t('settlement_ui.safe_trade.selling.receiving_placeholder')}
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
        label={t('settlement_ui.safe_trade.selling.deadline_label')}
        helper={t('settlement_ui.safe_trade.selling.deadline_helper')}
      />
      <button
        onClick={() => { if (validateSellingStep1()) setStep(2); }}
        className="btn-primary w-full cursor-pointer"
      >
        {t('common.continue')}
      </button>
    </div>
  );

  // Selling Step 3 — review.
  const renderSellingStep3 = () => {
    const sats = Math.round((parseFloat(sAmountIrm) || 0) * SATS_PER_IRM);
    return (
      <div className="card p-6 space-y-5">
        <div className="space-y-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.safe_trade.review.you_lock')}</div>
            <div className="font-display font-bold text-2xl gradient-text">{formatIRM(sats)}</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.safe_trade.review.buyer_sends')}</div>
            <div className="text-sm text-white">{sReceiving}</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.safe_trade.review.deadline')}</div>
            <div className="text-sm text-white">
              {t('settlement_ui.safe_trade.review.deadline_value', { hours: sDeadlineHours })}
            </div>
          </div>
        </div>
        <button
          onClick={handleCreateAgreement}
          disabled={sCreating}
          className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {sCreating ? <Loader2 size={15} className="animate-spin" /> : null}
          {t('settlement_ui.safe_trade.review.lock_funds')}
        </button>
        <p className="text-xs text-white/35 text-center">{t('settlement_ui.safe_trade.review.tx_note')}</p>
      </div>
    );
  };

  // Selling Step 4 — share deal code + wait + release.
  const renderSellingStep4 = () => {
    const plain = plainStatusFromStatusResult(status);
    // A4 fix: previously allowed release when EITHER funded or release_eligible
    // was true, which let the user click Release before proof was final and
    // get a "release_not_ready" error. Both must be true now — funded gates
    // the on-chain prerequisite, release_eligible gates policy satisfaction.
    const canRelease = status?.release_eligible === true && status?.funded === true;
    return (
      <div className="space-y-5">
        <div className="card p-6 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-white">{t('settlement_ui.safe_trade.share.title')}</h3>
            <p className="text-sm text-white/55 mt-1">{t('settlement_ui.safe_trade.share.subtitle')}</p>
          </div>
          {sAgreementId && <DealCode mode="display" agreementId={sAgreementId} />}
        </div>

        <div className="card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-white">{t('settlement_ui.safe_trade.status_title')}</h3>
            {status && <StatusBadge status={plain} />}
          </div>
          <p className="text-sm text-white/65 leading-relaxed">
            {!status
              ? t('settlement_ui.safe_trade.status_initial')
              : status.release_eligible
              ? t('settlement_ui.safe_trade.status_ready_release')
              : status.funded
              ? t('settlement_ui.safe_trade.status_waiting_payment')
              : t('settlement_ui.safe_trade.status_waiting_verify')}
          </p>
          <button
            onClick={handleConfirmReceived}
            disabled={!canRelease || sReleasing}
            className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            style={canRelease && !sReleasing ? { background: 'rgba(16,185,129,0.85)', borderColor: 'rgba(16,185,129,0.6)' } : undefined}
          >
            {sReleasing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {t('settlement_ui.safe_trade.selling.release_button')}
          </button>
        </div>

        {sAgreementId && <TechnicalDetails status={status ?? undefined} extra={[{ label: 'agreement_id', value: sAgreementId }]} />}
      </div>
    );
  };

  // Buying Step 2 — paste & verify deal code. On unpack-success we also
  // fetch the full Agreement so the review step can show amount + seller.
  const renderBuyingStep2 = () => (
    <div className="card p-6 space-y-4">
      <DealCode
        mode="input"
        onSuccess={async (id) => {
          setBAgreementId(id);
          setBImportedAgreement(null);
          try {
            const a = await agreements.show(id);
            setBImportedAgreement(a);
          } catch (e) {
            // Non-fatal — review step has a fallback for the "details
            // unavailable" case. Log raw for power-user debug.
            console.warn('[safe-trade] post-unpack show failed:', e);
          }
          setStep(2);
        }}
      />
    </div>
  );

  // Buying Step 3 — review and fund. Shows the imported Agreement's
  // amount + seller so the buyer can sanity-check before locking IRM.
  const renderBuyingStep3 = () => (
    <div className="card p-6 space-y-5">
      <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
        <p className="text-sm text-white/65 leading-relaxed">{t('settlement_ui.safe_trade.buying.review_intro')}</p>
      </div>

      {bImportedAgreement ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.safe_trade.buying.seller_locks')}</div>
            <div className="font-display font-bold text-2xl gradient-text">{formatIRM(bImportedAgreement.amount)}</div>
          </div>
          {bImportedAgreement.seller && (
            <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
              <div className="text-xs text-white/40 mb-1">{t('settlement_ui.safe_trade.buying.seller_label')}</div>
              <div className="font-mono text-xs text-white break-all">{bImportedAgreement.seller}</div>
            </div>
          )}
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.safe_trade.buying.trade_id_label')}</div>
            <div className="font-mono text-[11px] text-white/70 break-all">{bImportedAgreement.id}</div>
          </div>
        </div>
      ) : bAgreementId ? (
        <div className="rounded-lg bg-amber-500/8 border border-amber-500/25 p-4 space-y-2">
          <p className="text-xs text-amber-200 leading-relaxed">{t('settlement_ui.safe_trade.buying.details_unavailable')}</p>
          <div className="font-mono text-[11px] text-white/70 break-all">{bAgreementId}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => { setBAgreementId(null); setBImportedAgreement(null); setStep(1); }}
          className="btn-secondary w-full cursor-pointer"
        >
          {t('settlement_ui.safe_trade.buying.cancel_button')}
        </button>
        <button
          onClick={handleFundAsBuyer}
          disabled={bFunding || !bAgreementId}
          className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {bFunding ? <Loader2 size={15} className="animate-spin" /> : null}
          {t('settlement_ui.safe_trade.buying.confirm_button')}
        </button>
      </div>
    </div>
  );

  // Buying Step 4 — wait for seller to release.
  const renderBuyingStep4 = () => {
    const plain = plainStatusFromStatusResult(status);
    const isComplete = status?.status === 'released';
    return (
      <div className="space-y-5">
        <div className="card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-white">{t('settlement_ui.safe_trade.status_title')}</h3>
            {status && <StatusBadge status={plain} />}
          </div>
          <p className="text-sm text-white/65 leading-relaxed">
            {isComplete
              ? t('settlement_ui.safe_trade.buying.status_complete')
              : status?.release_eligible
              ? t('settlement_ui.safe_trade.buying.status_releasing')
              : t('settlement_ui.safe_trade.buying.status_waiting')}
          </p>
          {isComplete && (
            <button
              onClick={() => navigate('/agreements')}
              className="btn-primary w-full cursor-pointer"
            >
              {t('settlement_ui.safe_trade.buying.view_agreements')}
            </button>
          )}
        </div>
        {bAgreementId && <TechnicalDetails status={status ?? undefined} extra={[{ label: 'agreement_id', value: bAgreementId }]} />}
      </div>
    );
  };

  // Step title + subtitle by current screen.
  const getHeader = (): { title: string; subtitle?: string } => {
    if (step === 0) {
      return {
        title: t('settlement_ui.safe_trade.step1_title'),
        subtitle: t('settlement_ui.safe_trade.step1_subtitle'),
      };
    }
    if (side === 'selling') {
      if (step === 1) return { title: t('settlement_ui.safe_trade.selling.step2_title'), subtitle: t('settlement_ui.safe_trade.selling.step2_subtitle') };
      if (step === 2) return { title: t('settlement_ui.safe_trade.selling.step3_title'), subtitle: t('settlement_ui.safe_trade.selling.step3_subtitle') };
      if (step === 3) return { title: t('settlement_ui.safe_trade.selling.step4_title'), subtitle: t('settlement_ui.safe_trade.selling.step4_subtitle') };
    }
    if (side === 'buying') {
      if (step === 1) return { title: t('settlement_ui.safe_trade.buying.step2_title'), subtitle: t('settlement_ui.safe_trade.buying.step2_subtitle') };
      if (step === 2) return { title: t('settlement_ui.safe_trade.buying.step3_title'), subtitle: t('settlement_ui.safe_trade.buying.step3_subtitle') };
      if (step === 3) return { title: t('settlement_ui.safe_trade.buying.step4_title'), subtitle: t('settlement_ui.safe_trade.buying.step4_subtitle') };
    }
    return { title: '' };
  };

  const header = getHeader();

  return (
    <WizardShell
      totalSteps={totalSteps}
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
          {step === 0 && renderStep1()}
          {step === 1 && side === 'selling' && renderSellingStep2()}
          {step === 2 && side === 'selling' && renderSellingStep3()}
          {step === 3 && side === 'selling' && renderSellingStep4()}
          {step === 1 && side === 'buying' && renderBuyingStep2()}
          {step === 2 && side === 'buying' && renderBuyingStep3()}
          {step === 3 && side === 'buying' && renderBuyingStep4()}
        </motion.div>
      </AnimatePresence>
    </WizardShell>
  );
}
