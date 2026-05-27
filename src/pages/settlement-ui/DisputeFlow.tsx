import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, AlertCircle, FileText, CheckCircle2 } from 'lucide-react';
import { disputes, agreements } from '../../lib/tauri';
import type { Agreement } from '../../lib/types';
import WizardShell from '../../components/settlement-ui/WizardShell';
import TechnicalDetails from '../../components/settlement-ui/TechnicalDetails';
import { mapErrorToKey } from '../../components/settlement-ui/ErrorMapper';

type WizardStep = 0 | 1;

// DisputeFlow — raise-only for Phase 5 (per decision D4c). Records the
// dispute on-chain via the existing disputes.open() wrapper, then shows
// a clear "next step" message that does NOT promise an automatic
// referee resolution (the resolver feature isn't shipped yet).
//
// Accessed via /settlement/dispute/:agreementId — typically from a
// "Something went wrong?" link rendered on an active agreement row.
export default function DisputeFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agreementId } = useParams<{ agreementId: string }>();

  const [step, setStep] = useState<WizardStep>(0);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);

  // Fetch the agreement so we can show the user what they're disputing.
  useEffect(() => {
    if (!agreementId) return;
    agreements.show(agreementId)
      .then((a) => setAgreement(a))
      .catch(() => { /* leave null — UI handles missing gracefully */ });
  }, [agreementId]);

  const handleBack = (prev: number) => {
    if (prev < 0) { navigate('/settlement'); return; }
    if (step === 1) {
      // Once submitted, there's no useful "back" — just go to the hub.
      navigate('/settlement');
      return;
    }
    setStep(prev as WizardStep);
  };

  const handleSubmit = async () => {
    if (!agreementId) {
      setError(t('settlement_ui.dispute.errors.no_agreement'));
      return;
    }
    if (!reason.trim()) {
      setError(t('settlement_ui.dispute.errors.reason_required'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await disputes.open(agreementId, reason.trim());
      toast.success(t('settlement_ui.dispute.toast_submitted'));
      setStep(1);
    } catch (e) {
      console.error('[dispute] open failed:', e);
      setError(t(mapErrorToKey(e, 'dispute')));
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1 — describe the problem.
  const renderStep1 = () => (
    <div className="card p-6 space-y-5">
      {agreement && (
        <div className="rounded-lg bg-white/[0.03] border border-white/8 p-4 space-y-2">
          <div className="text-xs text-white/40">{t('settlement_ui.dispute.about_agreement')}</div>
          <div className="font-mono text-[11px] text-white/70 break-all">{agreement.id}</div>
        </div>
      )}
      <div className="space-y-1">
        <label className="label">{t('settlement_ui.dispute.reason_label')}</label>
        <textarea
          rows={6}
          maxLength={2000}
          value={reason}
          onChange={(e) => { setReason(e.target.value); if (error) setError(null); }}
          placeholder={t('settlement_ui.dispute.reason_placeholder')}
          className={`input resize-none ${error ? 'border-red-500/50' : ''}`}
        />
        {reason.length > 1600 && (
          <p className="text-xs mt-1" style={{ color: reason.length >= 2000 ? '#f87171' : 'rgba(255,255,255,0.30)' }}>
            {reason.length}/2000
          </p>
        )}
      </div>
      {/* Evidence file upload is intentionally deferred to a future
          phase — the current disputes.open wrapper doesn't accept a
          file path. We surface the field as disabled so users know
          the feature is coming. */}
      <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-4 flex items-start gap-3 opacity-60">
        <FileText size={18} className="text-white/40 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm text-white/55">{t('settlement_ui.dispute.evidence_label')}</div>
          <div className="text-xs text-white/35 mt-0.5">{t('settlement_ui.dispute.evidence_coming_soon')}</div>
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertCircle size={12} />{error}
        </p>
      )}
      <button
        onClick={handleSubmit}
        disabled={submitting || !reason.trim()}
        className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
      >
        {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
        {t('settlement_ui.dispute.submit_button')}
      </button>
    </div>
  );

  // Step 2 — confirmation. Honest about what just happened: dispute is
  // anchored on-chain, the other party has been notified, you should
  // contact them directly. No fake "referee assigned" claim.
  const renderStep2 = () => (
    <div className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={20} className="text-emerald-400" />
        </div>
        <div>
          <h3 className="font-display font-semibold text-white">{t('settlement_ui.dispute.confirm_title')}</h3>
          <p className="text-sm text-white/65 mt-1 leading-relaxed">{t('settlement_ui.dispute.confirm_body')}</p>
        </div>
      </div>
      <div className="rounded-lg bg-amber-500/8 border border-amber-500/25 p-4">
        <p className="text-xs text-amber-200 leading-relaxed">{t('settlement_ui.dispute.next_step_note')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => navigate('/settlement')} className="btn-secondary w-full cursor-pointer">
          {t('settlement_ui.dispute.back_to_hub')}
        </button>
        <button onClick={() => navigate('/agreements')} className="btn-primary w-full cursor-pointer">
          {t('settlement_ui.dispute.view_agreements')}
        </button>
      </div>
      {agreement && <TechnicalDetails agreement={agreement} extra={[{ label: 'reason', value: reason }]} />}
    </div>
  );

  const getHeader = (): { title: string; subtitle?: string } => {
    if (step === 0) return { title: t('settlement_ui.dispute.step1_title'), subtitle: t('settlement_ui.dispute.step1_subtitle') };
    return { title: t('settlement_ui.dispute.step2_title'), subtitle: t('settlement_ui.dispute.step2_subtitle') };
  };

  const header = getHeader();

  return (
    <WizardShell totalSteps={2} currentStep={step} onBack={handleBack} title={header.title} subtitle={header.subtitle} maxWidth="xl">
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
        </motion.div>
      </AnimatePresence>
    </WizardShell>
  );
}
