import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, AlertCircle, CheckCircle2, Scale } from 'lucide-react';
import { walletCli } from '../../lib/tauri';
import WizardShell from '../../components/settlement-ui/WizardShell';

type WizardStep = 0 | 1;

// DisputeResolveFlow — the missing React entry point for the
// agreement-dispute-resolve wallet command. Before this page, the only
// way for a resolver to attest a dispute outcome was to type the raw
// `wallet agreement-dispute-resolve ...` command into the in-app
// Terminal page. Now resolvers fill in a normal form: agreement id,
// outcome (release / refund), which role they're acting in (primary /
// fallback), their attestation message, and their signing key. The
// component wraps the existing `agreementDisputeResolve` Tauri wrapper
// in lib/tauri.ts:1054 — no Rust-side changes needed.
//
// Accessed via /settlement/dispute-resolve from the Settlement hub.
// Intentionally NOT linked from any in-flight agreement card because
// only a designated resolver should ever land here, not the buyer or
// seller themselves.
export default function DisputeResolveFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState<WizardStep>(0);
  const [agreementId, setAgreementId] = useState('');
  const [outcome, setOutcome] = useState<'release' | 'refund'>('release');
  const [resolverRole, setResolverRole] = useState<'primary' | 'fallback'>('primary');
  const [message, setMessage] = useState('');
  const [signingKey, setSigningKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  const handleBack = (prev: number) => {
    if (prev < 0) { navigate('/settlement'); return; }
    if (step === 1) { navigate('/settlement'); return; }
    setStep(prev as WizardStep);
  };

  const handleSubmit = async () => {
    setError(null);
    const a = agreementId.trim();
    const m = message.trim();
    const k = signingKey.trim();
    if (!a) {
      setError(t('settlement_ui.dispute_resolve.errors.agreement_required',
        'Agreement ID is required.'));
      return;
    }
    if (!m) {
      setError(t('settlement_ui.dispute_resolve.errors.message_required',
        'A short attestation message is required so both parties see why you decided this way.'));
      return;
    }
    if (!k) {
      setError(t('settlement_ui.dispute_resolve.errors.key_required',
        'Your resolver signing key (WIF) is required to produce the on-chain attestation.'));
      return;
    }
    setSubmitting(true);
    try {
      const raw = await walletCli.agreementDisputeResolve({
        agreement: a,
        outcome,
        resolverRole,
        message: m,
        key: k,
      });
      // The wallet returns the raw CLI stdout. Show it verbatim in the
      // success card so the resolver has a copy-pastable receipt without
      // having to inspect the terminal output stream.
      setResultText(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
      toast.success(t('settlement_ui.dispute_resolve.toast_submitted',
        'Dispute resolution recorded on-chain.'));
      setStep(1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Surface the structured WALLET_LOCKED tag from main.rs:ensure_wallet_unlocked
      // as a friendly message rather than the raw string.
      if (msg.startsWith('WALLET_LOCKED:')) {
        setError(t('settlement_ui.dispute_resolve.errors.wallet_locked',
          'Your wallet is locked. Unlock it from the Wallet page, then try again.'));
      } else {
        setError(t('settlement_ui.dispute_resolve.errors.submit_failed',
          'Dispute resolution failed: {{reason}}', { reason: msg }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Step 0 — gather attestation inputs.
  const renderStep1 = () => (
    <div className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 mt-0.5">
          <Scale size={18} className="text-amber-300" />
        </div>
        <div className="space-y-1 flex-1">
          <h3 className="text-base font-semibold">
            {t('settlement_ui.dispute_resolve.intro_title', 'Resolve a dispute')}
          </h3>
          <p className="text-sm text-white/60 leading-relaxed">
            {t(
              'settlement_ui.dispute_resolve.intro_body',
              'You are acting as the designated resolver for this agreement. Your attestation is recorded on-chain and is final — funds move to whichever side you specify here. Make sure you have reviewed evidence from both parties before submitting.',
            )}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="label">
          {t('settlement_ui.dispute_resolve.fields.agreement_id', 'Agreement ID')}
        </label>
        <input
          type="text"
          value={agreementId}
          onChange={(e) => { setAgreementId(e.target.value); if (error) setError(null); }}
          placeholder="agr1..."
          className="input font-mono text-[12px]"
          disabled={submitting}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="label">
            {t('settlement_ui.dispute_resolve.fields.outcome', 'Outcome')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOutcome('release')}
              disabled={submitting}
              className={`px-3 py-2 rounded-lg border text-sm text-left ${
                outcome === 'release'
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                  : 'bg-white/[0.03] border-white/8 text-white/70 hover:bg-white/[0.06]'
              }`}
            >
              {t('settlement_ui.dispute_resolve.outcome_release',
                'Release — pay the seller')}
            </button>
            <button
              type="button"
              onClick={() => setOutcome('refund')}
              disabled={submitting}
              className={`px-3 py-2 rounded-lg border text-sm text-left ${
                outcome === 'refund'
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                  : 'bg-white/[0.03] border-white/8 text-white/70 hover:bg-white/[0.06]'
              }`}
            >
              {t('settlement_ui.dispute_resolve.outcome_refund',
                'Refund — return to the buyer')}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="label">
            {t('settlement_ui.dispute_resolve.fields.resolver_role',
              'Your resolver role')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setResolverRole('primary')}
              disabled={submitting}
              className={`px-3 py-2 rounded-lg border text-sm ${
                resolverRole === 'primary'
                  ? 'bg-blue-500/10 border-blue-500/40 text-blue-200'
                  : 'bg-white/[0.03] border-white/8 text-white/70 hover:bg-white/[0.06]'
              }`}
            >
              {t('settlement_ui.dispute_resolve.role_primary', 'Primary')}
            </button>
            <button
              type="button"
              onClick={() => setResolverRole('fallback')}
              disabled={submitting}
              className={`px-3 py-2 rounded-lg border text-sm ${
                resolverRole === 'fallback'
                  ? 'bg-blue-500/10 border-blue-500/40 text-blue-200'
                  : 'bg-white/[0.03] border-white/8 text-white/70 hover:bg-white/[0.06]'
              }`}
            >
              {t('settlement_ui.dispute_resolve.role_fallback', 'Fallback')}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="label">
          {t('settlement_ui.dispute_resolve.fields.message', 'Attestation message')}
        </label>
        <textarea
          rows={4}
          maxLength={1000}
          value={message}
          onChange={(e) => { setMessage(e.target.value); if (error) setError(null); }}
          placeholder={t(
            'settlement_ui.dispute_resolve.message_placeholder',
            'Short justification for the outcome. Visible to both parties on-chain.',
          )}
          className="input resize-none"
          disabled={submitting}
        />
        {message.length > 800 && (
          <p
            className="text-xs mt-1"
            style={{ color: message.length >= 1000 ? '#f87171' : 'rgba(255,255,255,0.30)' }}
          >
            {message.length}/1000
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="label">
          {t('settlement_ui.dispute_resolve.fields.signing_key',
            'Your resolver signing key (WIF)')}
        </label>
        <input
          type="password"
          value={signingKey}
          onChange={(e) => { setSigningKey(e.target.value); if (error) setError(null); }}
          placeholder="K... or L..."
          className="input font-mono text-[12px]"
          disabled={submitting}
          autoComplete="off"
        />
        <p className="text-xs text-white/40">
          {t(
            'settlement_ui.dispute_resolve.signing_key_hint',
            'Used locally to sign the attestation. Never sent over the network.',
          )}
        </p>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-200"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => navigate('/settlement')}
          disabled={submitting}
          className="btn-ghost"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary flex items-center gap-2"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {t('settlement_ui.dispute_resolve.submit', 'Record resolution on-chain')}
        </button>
      </div>
    </div>
  );

  // Step 1 — success card with the wallet's raw stdout (a copy-pastable
  // receipt the resolver can keep for their records).
  const renderStep2 = () => (
    <div className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2 mt-0.5">
          <CheckCircle2 size={18} className="text-emerald-300" />
        </div>
        <div className="space-y-1 flex-1">
          <h3 className="text-base font-semibold">
            {t('settlement_ui.dispute_resolve.success_title',
              'Resolution recorded on-chain')}
          </h3>
          <p className="text-sm text-white/60 leading-relaxed">
            {t(
              'settlement_ui.dispute_resolve.success_body',
              'Your attestation has been broadcast. Both parties will see the outcome on their Agreements page within one block. Funds move automatically — no further action needed from you.',
            )}
          </p>
        </div>
      </div>
      {resultText && (
        <div className="rounded-lg bg-black/30 border border-white/8 p-3 max-h-72 overflow-auto">
          <pre className="text-[11px] font-mono text-white/70 whitespace-pre-wrap break-all">
            {resultText}
          </pre>
        </div>
      )}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => navigate('/settlement')}
          className="btn-primary"
        >
          {t('settlement_ui.dispute_resolve.back_to_hub', 'Back to Settlement')}
        </button>
      </div>
    </div>
  );

  return (
    <WizardShell
      title={t('settlement_ui.dispute_resolve.page_title', 'Dispute resolution')}
      subtitle={t(
        'settlement_ui.dispute_resolve.page_subtitle',
        'Designated resolver only. Records a binding on-chain outcome for a disputed agreement.',
      )}
      currentStep={step}
      totalSteps={2}
      onBack={handleBack}
    >
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="resolve-step-1"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18 }}
          >
            {renderStep1()}
          </motion.div>
        )}
        {step === 1 && (
          <motion.div
            key="resolve-step-2"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18 }}
          >
            {renderStep2()}
          </motion.div>
        )}
      </AnimatePresence>
    </WizardShell>
  );
}
