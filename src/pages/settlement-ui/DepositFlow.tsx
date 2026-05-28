import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { settlement, agreements, agreementSpend } from '../../lib/tauri';
import { useIriumEvents } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { SATS_PER_IRM, formatIRM } from '../../lib/types';
import type { AgreementStatusResult } from '../../lib/types';
import WizardShell from '../../components/settlement-ui/WizardShell';
import AmountInput from '../../components/settlement-ui/AmountInput';
import AddressInput from '../../components/settlement-ui/AddressInput';
import DurationPicker from '../../components/settlement-ui/DurationPicker';
import TechnicalDetails from '../../components/settlement-ui/TechnicalDetails';
import StatusBadge from '../../components/settlement-ui/StatusBadge';
import { plainStatusFromStatusResult } from '../../components/settlement-ui/PlainStatus';
import { mapErrorToKey } from '../../components/settlement-ui/ErrorMapper';

type WizardStep = 0 | 1 | 2;

const POLL_MS = 5000;

export default function DepositFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selfAddress = addresses[activeAddrIdx]?.address ?? '';

  const [step, setStep] = useState<WizardStep>(0);
  const [recipient, setRecipient] = useState('');
  const [amountIrm, setAmountIrm] = useState('');
  const [purpose, setPurpose] = useState('');
  const [deadlineHours, setDeadlineHours] = useState(720); // 30 days default
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [status, setStatus] = useState<AgreementStatusResult | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useIriumEvents((event) => {
    if (!agreementId) return;
    if (event.type.startsWith('agreement.')) {
      const evtId = (event.data as Record<string, unknown>)?.agreement_id;
      if (evtId === agreementId) {
        agreementSpend.status(agreementId).then((s) => { if (s) setStatus(s); }).catch(() => {});
      }
    }
  });

  const handleBack = (prev: number) => {
    if (prev < 0) { navigate('/settlement'); return; }
    setStep(prev as WizardStep);
  };

  const validateSetup = (): boolean => {
    const errs: Record<string, string> = {};
    if (!recipient.trim()) errs.recipient = t('settlement_ui.deposit.errors.recipient_required');
    if (!amountIrm.trim() || isNaN(parseFloat(amountIrm)) || parseFloat(amountIrm) <= 0) {
      errs.amount = t('settlement_ui.deposit.errors.amount_required');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    setCreating(true);
    let res: { agreement_id?: string } | null = null;
    try {
      res = await settlement.deposit({
        depositor: selfAddress,
        recipient: recipient.trim(),
        amount_sats: Math.round(parseFloat(amountIrm) * SATS_PER_IRM),
        deadline_hours: deadlineHours,
        // C3 fix: surface the purpose memo to the backend so the user's
        // free-text note actually persists with the deposit instead of
        // being silently dropped at submission. Empty trims to undefined
        // so the wallet still defaults to its "Deposit" label.
        purpose: purpose.trim() || undefined,
      });
      if (!res?.agreement_id) throw new Error('No agreement id returned');
    } catch (e) {
      console.error('[deposit] create failed:', e);
      toast.error(t(mapErrorToKey(e, 'create')));
      setCreating(false);
      return;
    }
    // S3 fix: split fund from create so a fund failure no longer surfaces
    // as a generic create error. The agreement IS on-chain at this point;
    // tell the user to find it on /agreements and retry funding there.
    try {
      await agreementSpend.fund(res.agreement_id!, true);
    } catch (fundErr) {
      console.error('[deposit] fund failed (agreement orphaned):', fundErr);
      toast.error('Agreement created but funding failed. Find it in your Agreements page to retry funding.');
      setTimeout(() => navigate('/agreements'), 3000);
      setCreating(false);
      return;
    }
    setAgreementId(res.agreement_id!);
    startPolling(res.agreement_id!);
    setStep(2);
    setCreating(false);
  };

  const handleRelease = async () => {
    if (!agreementId) return;
    setReleasing(true);
    try {
      const secret = await agreements.getSecret(agreementId);
      await agreements.release(agreementId, secret, true);
      toast.success(t('settlement_ui.deposit.toast_released'));
    } catch (e) {
      toast.error(t(mapErrorToKey(e, 'release')));
    } finally {
      setReleasing(false);
    }
  };

  const handleClaimBack = async () => {
    if (!agreementId) return;
    setRefunding(true);
    try {
      await agreements.refund(agreementId, true);
      toast.success(t('settlement_ui.deposit.toast_refunded'));
    } catch (e) {
      toast.error(t(mapErrorToKey(e, 'refund')));
    } finally {
      setRefunding(false);
    }
  };

  // Step 1 — setup form.
  const renderStep1 = () => (
    <div className="card p-6 space-y-5">
      <AddressInput
        value={recipient}
        onChange={(v) => { setRecipient(v); if (errors.recipient) setErrors((p) => { const n = { ...p }; delete n.recipient; return n; }); }}
        label={t('settlement_ui.deposit.recipient_label')}
        error={errors.recipient}
      />
      <AmountInput
        value={amountIrm}
        onChange={(v) => { setAmountIrm(v); if (errors.amount) setErrors((p) => { const n = { ...p }; delete n.amount; return n; }); }}
        label={t('settlement_ui.deposit.amount_label')}
        error={errors.amount}
      />
      <div className="space-y-1">
        <label className="label">{t('settlement_ui.deposit.purpose_label')}</label>
        <input
          type="text"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder={t('settlement_ui.deposit.purpose_placeholder')}
          maxLength={100}
          className="input"
        />
        <p className="text-xs text-white/35">{t('settlement_ui.deposit.purpose_helper')}</p>
      </div>
      <DurationPicker
        value={deadlineHours}
        onChange={setDeadlineHours}
        label={t('settlement_ui.deposit.deadline_label')}
        helper={t('settlement_ui.deposit.deadline_helper')}
        presets={[
          { hours: 24, labelKey: 'settlement_ui.duration.preset_24h' },
          { hours: 168, labelKey: 'settlement_ui.duration.preset_1w' },
          { hours: 720, labelKey: 'settlement_ui.deposit.preset_1m' },
          { hours: 2160, labelKey: 'settlement_ui.deposit.preset_3m' },
        ]}
      />
      <button
        onClick={() => { if (validateSetup()) setStep(1); }}
        className="btn-primary w-full cursor-pointer"
      >
        {t('common.continue')}
      </button>
    </div>
  );

  // Step 2 — review.
  const renderStep2 = () => {
    const sats = Math.round((parseFloat(amountIrm) || 0) * SATS_PER_IRM);
    return (
      <div className="card p-6 space-y-5">
        <div className="space-y-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.deposit.review.recipient')}</div>
            <div className="font-mono text-sm text-white break-all">{recipient}</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.deposit.review.amount')}</div>
            <div className="font-display font-bold text-2xl gradient-text">{formatIRM(sats)}</div>
          </div>
          {purpose.trim() && (
            <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
              <div className="text-xs text-white/40 mb-1">{t('settlement_ui.deposit.review.purpose')}</div>
              <div className="text-sm text-white">{purpose}</div>
            </div>
          )}
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.deposit.review.deadline')}</div>
            <div className="text-sm text-white">{t('settlement_ui.deposit.review.deadline_value', { hours: deadlineHours })}</div>
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : null}
          {t('settlement_ui.deposit.review.lock_deposit')}
        </button>
        <p className="text-xs text-white/35 text-center">{t('settlement_ui.safe_trade.review.tx_note')}</p>
      </div>
    );
  };

  // Step 3 — deposit locked. Two action buttons; claim back only enabled
  // once the deadline passes (refund_eligible flips true backend-side).
  const renderStep3 = () => {
    const plain = plainStatusFromStatusResult(status);
    return (
      <div className="space-y-5">
        <div className="card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-white">{t('settlement_ui.deposit.status_title')}</h3>
            {status && <StatusBadge status={plain} />}
          </div>
          <p className="text-sm text-white/65 leading-relaxed">
            {!status
              ? t('settlement_ui.deposit.status_setting_up')
              : status.status === 'released'
              ? t('settlement_ui.deposit.status_released')
              : status.status === 'refunded'
              ? t('settlement_ui.deposit.status_refunded')
              : status.refund_eligible
              ? t('settlement_ui.deposit.status_can_claim_back')
              : t('settlement_ui.deposit.status_locked')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              onClick={handleRelease}
              disabled={releasing || refunding || status?.status === 'released' || status?.status === 'refunded' || !status?.funded}
              className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              style={status?.funded && status?.status !== 'released' && status?.status !== 'refunded' ? { background: 'rgba(16,185,129,0.85)', borderColor: 'rgba(16,185,129,0.6)' } : undefined}
            >
              {releasing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {t('settlement_ui.deposit.release_button')}
            </button>
            <button
              onClick={handleClaimBack}
              disabled={refunding || releasing || !status?.refund_eligible}
              className="btn-secondary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            >
              {refunding ? <Loader2 size={15} className="animate-spin" /> : null}
              {t('settlement_ui.deposit.claim_back_button')}
            </button>
          </div>
        </div>
        {agreementId && <TechnicalDetails status={status ?? undefined} extra={[{ label: 'agreement_id', value: agreementId }, { label: 'purpose_label', value: purpose || '—' }]} />}
      </div>
    );
  };

  const getHeader = (): { title: string; subtitle?: string } => {
    if (step === 0) return { title: t('settlement_ui.deposit.step1_title'), subtitle: t('settlement_ui.deposit.step1_subtitle') };
    if (step === 1) return { title: t('settlement_ui.deposit.step2_title'), subtitle: t('settlement_ui.deposit.step2_subtitle') };
    return { title: t('settlement_ui.deposit.step3_title'), subtitle: t('settlement_ui.deposit.step3_subtitle') };
  };

  const header = getHeader();

  return (
    <WizardShell totalSteps={3} currentStep={step} onBack={handleBack} title={header.title} subtitle={header.subtitle}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`step-${step}`}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
        >
          {step === 0 && renderStep1()}
          {step === 1 && renderStep2()}
          {step === 2 && renderStep3()}
        </motion.div>
      </AnimatePresence>
    </WizardShell>
  );
}
