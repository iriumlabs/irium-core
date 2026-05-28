import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Coins, ListChecks, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { settlement, agreements, agreementSpend, proofs } from '../../lib/tauri';
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

type Kind = 'single' | 'milestone';
type WizardStep = 0 | 1 | 2 | 3;

const POLL_MS = 5000;

export default function PayForWorkFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selfAddress = addresses[activeAddrIdx]?.address ?? '';

  const [step, setStep] = useState<WizardStep>(0);
  const [kind, setKind] = useState<Kind | null>(null);

  // Shared form fields
  const [contractor, setContractor] = useState('');
  const [amountIrm, setAmountIrm] = useState('');
  const [deadlineHours, setDeadlineHours] = useState(168); // 1 week default for work
  const [description, setDescription] = useState('');
  const [milestoneCount, setMilestoneCount] = useState(3);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Backend state
  const [creating, setCreating] = useState(false);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  // agreementHash is the 64-hex SHA256 returned by settlement.freelance /
  // settlement.contractor. proofs.createAndSubmit requires this hash
  // (NOT the agreement_id label), so we store it separately.
  const [agreementHash, setAgreementHash] = useState<string | null>(null);
  const [status, setStatus] = useState<AgreementStatusResult | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [refunding, setRefunding] = useState(false);
  // B5 fix: for milestone agreements the user must pick which milestone
  // they are completing. Defaults to 0 (the first milestone). The selector
  // only renders when kind === 'milestone'. The backend tracks per-
  // milestone preimages via get_milestone_secret(agreement_id, index)
  // (lib/tauri.ts:307), so handleMarkComplete pulls the index-specific
  // secret when releasing a milestone instead of the global agreement
  // secret used for single-payment flows.
  const [selectedMilestone, setSelectedMilestone] = useState(0);

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
    if (!contractor.trim()) errs.contractor = t('settlement_ui.pay_for_work.errors.contractor_required');
    if (!amountIrm.trim() || isNaN(parseFloat(amountIrm)) || parseFloat(amountIrm) <= 0) {
      errs.amount = t('settlement_ui.pay_for_work.errors.amount_required');
    }
    if (kind === 'milestone' && (milestoneCount < 2 || milestoneCount > 10)) {
      errs.count = t('settlement_ui.pay_for_work.errors.count_range');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!kind) return;
    setCreating(true);
    const amountSats = Math.round(parseFloat(amountIrm) * SATS_PER_IRM);
    let res: { agreement_id?: string; hash?: string } | null = null;
    try {
      if (kind === 'single') {
        res = await settlement.freelance({
          client: selfAddress,
          contractor: contractor.trim(),
          amount_sats: amountSats,
          deadline_hours: deadlineHours,
          scope: description.trim() || undefined,
        });
      } else {
        // Milestone path uses contractor template per D5 — it carries
        // the optional scope text that fits "Pay for Work — milestone".
        // Backend equal-splits across milestone_count; per-milestone
        // amounts/titles aren't a backend feature today.
        res = await settlement.contractor({
          client: selfAddress,
          contractor: contractor.trim(),
          amount_sats: amountSats,
          milestone_count: milestoneCount,
          scope: description.trim() || undefined,
        });
      }
      if (!res?.agreement_id) throw new Error('No agreement id returned');
    } catch (e) {
      console.error('[pay-for-work] create failed:', e);
      toast.error(t(mapErrorToKey(e, 'create')));
      setCreating(false);
      return;
    }
    // S3 fix: split fund from create so an orphan-on-fund failure surfaces
    // a recoverable toast + auto-navigation rather than a generic create
    // error. The agreement is already on-chain and findable on /agreements.
    try {
      await agreementSpend.fund(res.agreement_id!, true);
    } catch (fundErr) {
      console.error('[pay-for-work] fund failed (agreement orphaned):', fundErr);
      toast.error('Agreement created but funding failed. Find it in your Agreements page to retry funding.');
      setTimeout(() => navigate('/agreements'), 3000);
      setCreating(false);
      return;
    }
    setAgreementId(res.agreement_id!);
    if (res.hash) setAgreementHash(res.hash);
    startPolling(res.agreement_id!);
    setStep(3);
    setCreating(false);
  };

  const handleMarkComplete = async () => {
    if (!agreementId) return;
    setReleasing(true);
    try {
      // agreementHash MUST be the 64-hex SHA256, not the agreement_id
      // label. Prefer the live status (post-poll), fall back to the
      // hash captured at creation. Refuse to submit if neither is
      // available rather than silently sending the wrong field.
      const hash = status?.agreement_hash ?? agreementHash;
      if (!hash) {
        toast.error(t('settlement_ui.errors.generic'));
        return;
      }
      // The client (=payer in freelance/contractor templates) attests that
      // work was completed satisfactorily. B5 fix: for milestone agreements
      // we attach the milestone index as evidence_summary so the proof
      // log records which milestone the attestation is for (the backend's
      // proof handler doesn't yet have a structured milestone_index field;
      // evidence_summary is the existing free-form field that already gets
      // persisted at main.rs:4820).
      await proofs.createAndSubmit({
        agreementHash: hash,
        proofType: kind === 'milestone' ? 'milestone_complete' : 'delivery_confirmed',
        attestedBy: selfAddress,
        address: selfAddress,
        evidenceSummary: kind === 'milestone'
          ? `milestone_${selectedMilestone + 1}_complete`
          : undefined,
      }).catch((e) => {
        console.warn('[pay-for-work] proof submit failed (continuing):', e);
      });
      try {
        // B5 fix: milestone agreements use per-index preimages (see
        // get_milestone_secret in main.rs:5060). Single-payment flows
        // use the global agreement secret. Picking the wrong one here
        // would either release the wrong amount or fail the on-chain
        // hash-preimage check.
        const secret = kind === 'milestone'
          ? await agreements.getMilestoneSecret(agreementId, selectedMilestone)
          : await agreements.getSecret(agreementId);
        await agreements.release(agreementId, secret, true);
        toast.success(t('settlement_ui.pay_for_work.toast_released'));
      } catch (releaseErr) {
        const key = mapErrorToKey(releaseErr, 'release');
        if (key === 'settlement_ui.errors.release_not_ready') {
          toast(t('settlement_ui.pay_for_work.toast_release_pending'));
        } else {
          toast.error(t(key));
        }
      }
    } finally {
      setReleasing(false);
    }
  };

  const handleClaimRefund = async () => {
    if (!agreementId) return;
    setRefunding(true);
    try {
      await agreements.refund(agreementId, true);
      toast.success(t('settlement_ui.pay_for_work.toast_refunded'));
    } catch (e) {
      toast.error(t(mapErrorToKey(e, 'refund')));
    } finally {
      setRefunding(false);
    }
  };

  const totalSteps = 4;

  // Step 1 — single vs milestone.
  const renderStep1 = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => { setKind('single'); setStep(1); }}
        className="card-interactive p-8 text-left flex flex-col gap-4 cursor-pointer min-h-[180px]"
      >
        <div className="p-3 rounded-xl w-fit bg-irium-500/15 border border-irium-500/30">
          <Coins size={22} className="text-irium-400" />
        </div>
        <div>
          <div className="font-display font-bold text-lg text-white">{t('settlement_ui.pay_for_work.single_button')}</div>
          <div className="text-white/45 text-sm mt-2 leading-relaxed">{t('settlement_ui.pay_for_work.single_subtitle')}</div>
        </div>
      </motion.button>
      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => { setKind('milestone'); setStep(1); }}
        className="card-interactive p-8 text-left flex flex-col gap-4 cursor-pointer min-h-[180px]"
      >
        <div className="p-3 rounded-xl w-fit bg-emerald-500/15 border border-emerald-500/30">
          <ListChecks size={22} className="text-emerald-400" />
        </div>
        <div>
          <div className="font-display font-bold text-lg text-white">{t('settlement_ui.pay_for_work.milestone_button')}</div>
          <div className="text-white/45 text-sm mt-2 leading-relaxed">{t('settlement_ui.pay_for_work.milestone_subtitle')}</div>
        </div>
      </motion.button>
    </div>
  );

  // Step 2 — setup form (shared between single + milestone).
  const renderStep2 = () => (
    <div className="card p-6 space-y-5">
      <AddressInput
        value={contractor}
        onChange={(v) => { setContractor(v); if (errors.contractor) setErrors((p) => { const n = { ...p }; delete n.contractor; return n; }); }}
        label={t('settlement_ui.pay_for_work.contractor_label')}
        error={errors.contractor}
      />
      <AmountInput
        value={amountIrm}
        onChange={(v) => { setAmountIrm(v); if (errors.amount) setErrors((p) => { const n = { ...p }; delete n.amount; return n; }); }}
        label={kind === 'single' ? t('settlement_ui.pay_for_work.amount_label_single') : t('settlement_ui.pay_for_work.amount_label_milestone')}
        helper={kind === 'milestone' ? t('settlement_ui.pay_for_work.amount_helper_milestone') : undefined}
        error={errors.amount}
      />
      {kind === 'milestone' && (
        <div className="space-y-1">
          <label className="label">{t('settlement_ui.pay_for_work.count_label')}</label>
          <input
            type="number"
            min={2}
            max={10}
            value={milestoneCount}
            onChange={(e) => {
              const n = parseInt(e.target.value || '0');
              setMilestoneCount(isNaN(n) ? 0 : n);
              if (errors.count) setErrors((p) => { const nn = { ...p }; delete nn.count; return nn; });
            }}
            className={`input w-24 ${errors.count ? 'border-red-500/50' : ''}`}
          />
          {errors.count && (
            <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
              <AlertCircle size={11} />{errors.count}
            </p>
          )}
          {amountIrm && parseFloat(amountIrm) > 0 && milestoneCount >= 2 && milestoneCount <= 10 && (
            <p className="text-xs text-white/45 mt-1">
              {t('settlement_ui.pay_for_work.per_milestone_preview', {
                amount: formatIRM(Math.floor(parseFloat(amountIrm) * SATS_PER_IRM / milestoneCount)),
              })}
            </p>
          )}
        </div>
      )}
      <DurationPicker
        value={deadlineHours}
        onChange={setDeadlineHours}
        label={t('settlement_ui.pay_for_work.deadline_label')}
        helper={t('settlement_ui.pay_for_work.deadline_helper')}
      />
      <div className="space-y-1">
        <label className="label">{t('settlement_ui.pay_for_work.description_label')}</label>
        <textarea
          rows={3}
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settlement_ui.pay_for_work.description_placeholder')}
          className="input resize-none"
        />
      </div>
      <button
        onClick={() => { if (validateSetup()) setStep(2); }}
        className="btn-primary w-full cursor-pointer"
      >
        {t('common.continue')}
      </button>
    </div>
  );

  // Step 3 — review.
  const renderStep3 = () => {
    const sats = Math.round((parseFloat(amountIrm) || 0) * SATS_PER_IRM);
    return (
      <div className="card p-6 space-y-5">
        <div className="space-y-3">
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.pay_for_work.review.paying')}</div>
            <div className="font-mono text-sm text-white break-all">{contractor}</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.pay_for_work.review.locking')}</div>
            <div className="font-display font-bold text-2xl gradient-text">{formatIRM(sats)}</div>
          </div>
          {kind === 'milestone' && (
            <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
              <div className="text-xs text-white/40 mb-1">{t('settlement_ui.pay_for_work.review.milestones')}</div>
              <div className="text-sm text-white">
                {t('settlement_ui.pay_for_work.review.milestones_value', {
                  count: milestoneCount,
                  per: formatIRM(Math.floor(sats / milestoneCount)),
                })}
              </div>
            </div>
          )}
          <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
            <div className="text-xs text-white/40 mb-1">{t('settlement_ui.pay_for_work.review.deadline')}</div>
            <div className="text-sm text-white">{t('settlement_ui.pay_for_work.review.deadline_value', { hours: deadlineHours })}</div>
          </div>
          {description.trim() && (
            <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4">
              <div className="text-xs text-white/40 mb-1">{t('settlement_ui.pay_for_work.review.scope')}</div>
              <div className="text-sm text-white">{description}</div>
            </div>
          )}
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : null}
          {kind === 'milestone' ? t('settlement_ui.pay_for_work.review.lock_all') : t('settlement_ui.pay_for_work.review.lock_funds')}
        </button>
        <p className="text-xs text-white/35 text-center">{t('settlement_ui.safe_trade.review.tx_note')}</p>
      </div>
    );
  };

  // Step 4 — tracking.
  const renderStep4 = () => {
    const plain = plainStatusFromStatusResult(status);
    return (
      <div className="space-y-5">
        <div className="card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-white">{t('settlement_ui.pay_for_work.status_title')}</h3>
            {status && <StatusBadge status={plain} />}
          </div>
          <p className="text-sm text-white/65 leading-relaxed">
            {!status
              ? t('settlement_ui.pay_for_work.status_setting_up')
              : status.status === 'released'
              ? t('settlement_ui.pay_for_work.status_complete')
              : status.refund_eligible
              ? t('settlement_ui.pay_for_work.status_can_refund')
              : status.funded
              ? t('settlement_ui.pay_for_work.status_in_progress')
              : t('settlement_ui.pay_for_work.status_pending')}
          </p>
          {kind === 'milestone' && (
            <div className="space-y-1 pt-1">
              <label className="label">Which milestone?</label>
              <select
                value={selectedMilestone}
                onChange={(e) => setSelectedMilestone(parseInt(e.target.value, 10))}
                disabled={releasing || refunding}
                className="input w-full cursor-pointer disabled:opacity-50"
              >
                {Array.from({ length: milestoneCount }, (_, i) => (
                  <option key={i} value={i}>
                    Milestone {i + 1} of {milestoneCount}
                  </option>
                ))}
              </select>
              <p className="text-xs text-white/45">
                Mark Complete releases this milestone&apos;s share of the locked IRM. The contractor receives 1/{milestoneCount} of the total per milestone.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              onClick={handleMarkComplete}
              disabled={releasing || refunding || status?.status === 'released' || status?.status === 'refunded' || !status?.funded}
              className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              style={status?.funded && status?.status !== 'released' && status?.status !== 'refunded' ? { background: 'rgba(16,185,129,0.85)', borderColor: 'rgba(16,185,129,0.6)' } : undefined}
            >
              {releasing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {kind === 'milestone'
                ? `${t('settlement_ui.pay_for_work.mark_complete')} (milestone ${selectedMilestone + 1})`
                : t('settlement_ui.pay_for_work.mark_complete')}
            </button>
            <button
              onClick={handleClaimRefund}
              disabled={refunding || releasing || !status?.refund_eligible}
              className="btn-secondary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            >
              {refunding ? <Loader2 size={15} className="animate-spin" /> : null}
              {t('settlement_ui.pay_for_work.claim_refund')}
            </button>
          </div>
        </div>
        {agreementId && <TechnicalDetails status={status ?? undefined} extra={[{ label: 'agreement_id', value: agreementId }, { label: 'kind', value: kind ?? '' }]} />}
      </div>
    );
  };

  const getHeader = (): { title: string; subtitle?: string } => {
    if (step === 0) return { title: t('settlement_ui.pay_for_work.step1_title'), subtitle: t('settlement_ui.pay_for_work.step1_subtitle') };
    if (step === 1) return { title: t('settlement_ui.pay_for_work.step2_title'), subtitle: kind === 'milestone' ? t('settlement_ui.pay_for_work.step2_subtitle_milestone') : t('settlement_ui.pay_for_work.step2_subtitle_single') };
    if (step === 2) return { title: t('settlement_ui.pay_for_work.step3_title'), subtitle: t('settlement_ui.pay_for_work.step3_subtitle') };
    return { title: t('settlement_ui.pay_for_work.step4_title'), subtitle: t('settlement_ui.pay_for_work.step4_subtitle') };
  };

  const header = getHeader();

  return (
    <WizardShell totalSteps={totalSteps} currentStep={step} onBack={handleBack} title={header.title} subtitle={header.subtitle}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${kind ?? 'choose'}-${step}`}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
        >
          {step === 0 && renderStep1()}
          {step === 1 && renderStep2()}
          {step === 2 && renderStep3()}
          {step === 3 && renderStep4()}
        </motion.div>
      </AnimatePresence>
    </WizardShell>
  );
}
