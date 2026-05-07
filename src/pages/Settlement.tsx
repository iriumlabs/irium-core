import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftRight, Briefcase, Target, Landmark, ArrowLeft, Copy, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { settlement } from '../lib/tauri';
import { SATS_PER_IRM, formatIRM, truncateHash } from '../lib/types';
import type { OtcParams, FreelanceParams, MilestoneParams, DepositParams, AgreementResult } from '../lib/types';

// ── Animation variants ───────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// ── Template definitions ─────────────────────────────────────────
type TemplateId = 'otc' | 'freelance' | 'milestone' | 'deposit';

interface TemplateConfig {
  id: TemplateId;
  name: string;
  desc: string;
  Icon: React.ElementType;
  glowBg: string;
  iconBg: string;
  iconColor: string;
}

const TEMPLATES: TemplateConfig[] = [
  {
    id: 'otc',
    name: 'OTC Trade',
    desc: 'Peer-to-peer trade with escrow',
    Icon: ArrowLeftRight,
    glowBg: 'bg-irium-500',
    iconBg: 'bg-irium-500/20',
    iconColor: 'text-irium-400',
  },
  {
    id: 'freelance',
    name: 'Freelance',
    desc: 'Contractor milestone payment',
    Icon: Briefcase,
    glowBg: 'bg-blue-500',
    iconBg: 'bg-blue-500/20',
    iconColor: 'text-blue-400',
  },
  {
    id: 'milestone',
    name: 'Milestone',
    desc: 'Multi-stage project payment',
    Icon: Target,
    glowBg: 'bg-green-500',
    iconBg: 'bg-green-500/20',
    iconColor: 'text-green-400',
  },
  {
    id: 'deposit',
    name: 'Deposit',
    desc: 'Collateral deposit escrow',
    Icon: Landmark,
    glowBg: 'bg-amber-500',
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-400',
  },
];

// ── Form state type ──────────────────────────────────────────────
interface FormState {
  partyA: string;
  partyB: string;
  amountIrm: string;
  deadlineHours: string;
  scope: string;
  milestoneCount: string;
  memo: string;
}

const DEFAULT_FORM: FormState = {
  partyA: '',
  partyB: '',
  amountIrm: '',
  deadlineHours: '48',
  scope: '',
  milestoneCount: '3',
  memo: '',
};

// ── View type ────────────────────────────────────────────────────
type View = 'grid' | 'wizard' | 'success';

// ── Label helpers per template ───────────────────────────────────
function getLabels(id: TemplateId): { partyA: string; partyB: string } {
  switch (id) {
    case 'otc':
      return { partyA: 'Buyer Address', partyB: 'Seller Address' };
    case 'freelance':
      return { partyA: 'Client Address', partyB: 'Contractor Address' };
    case 'milestone':
      return { partyA: 'Payer Address', partyB: 'Payee Address' };
    case 'deposit':
      return { partyA: 'Depositor Address', partyB: 'Recipient Address' };
  }
}

// ── Summary label helpers ────────────────────────────────────────
function getReviewRows(id: TemplateId, form: FormState): Array<{ label: string; value: string }> {
  const labels = getLabels(id);
  const amountSats = Math.round(parseFloat(form.amountIrm || '0') * SATS_PER_IRM);
  const rows: Array<{ label: string; value: string }> = [
    { label: labels.partyA, value: form.partyA || '—' },
    { label: labels.partyB, value: form.partyB || '—' },
    { label: 'Amount', value: form.amountIrm ? `${form.amountIrm} IRM (${amountSats.toLocaleString()} sats)` : '—' },
  ];
  if (id === 'otc') {
    rows.push({ label: 'Deadline', value: `${form.deadlineHours}h` });
    if (form.memo) rows.push({ label: 'Memo', value: form.memo });
  }
  if (id === 'freelance') {
    rows.push({ label: 'Deadline', value: `${form.deadlineHours}h` });
    if (form.scope) rows.push({ label: 'Scope', value: form.scope });
  }
  if (id === 'milestone') {
    rows.push({ label: 'Milestone Count', value: form.milestoneCount });
    const count = parseInt(form.milestoneCount) || 1;
    if (form.amountIrm) {
      const perMs = parseFloat(form.amountIrm) / count;
      rows.push({ label: 'Per Milestone', value: `${perMs.toFixed(4)} IRM` });
    }
  }
  if (id === 'deposit') {
    rows.push({ label: 'Deadline', value: `${form.deadlineHours}h` });
  }
  return rows;
}

// ── Main component ───────────────────────────────────────────────
export default function SettlementPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('grid');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgreementResult | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  const steps = ['Details', 'Review & Confirm'];

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const handleTemplateSelect = (id: TemplateId) => {
    setSelectedTemplate(id);
    setView('wizard');
    setWizardStep(0);
    setForm(DEFAULT_FORM);
  };

  const handleBack = () => {
    if (view === 'success') {
      setView('grid');
      setSelectedTemplate(null);
      setResult(null);
      setForm(DEFAULT_FORM);
    } else if (view === 'wizard') {
      if (wizardStep > 0) {
        setWizardStep((s) => s - 1);
      } else {
        setView('grid');
        setSelectedTemplate(null);
      }
    }
  };

  const handleNext = () => {
    setWizardStep((s) => s + 1);
  };

  const handleSubmit = async () => {
    if (!selectedTemplate) return;
    setLoading(true);
    try {
      const amountSats = Math.round(parseFloat(form.amountIrm) * SATS_PER_IRM);
      let res: AgreementResult;
      if (selectedTemplate === 'otc') {
        const params: OtcParams = {
          buyer: form.partyA,
          seller: form.partyB,
          amount_sats: amountSats,
          deadline_hours: parseInt(form.deadlineHours) || 48,
          memo: form.memo || undefined,
        };
        res = await settlement.otc(params);
      } else if (selectedTemplate === 'freelance') {
        const params: FreelanceParams = {
          client: form.partyA,
          contractor: form.partyB,
          amount_sats: amountSats,
          deadline_hours: parseInt(form.deadlineHours) || 48,
          scope: form.scope || undefined,
        };
        res = await settlement.freelance(params);
      } else if (selectedTemplate === 'milestone') {
        const params: MilestoneParams = {
          payer: form.partyA,
          payee: form.partyB,
          amount_sats: amountSats,
          milestone_count: parseInt(form.milestoneCount) || 3,
        };
        res = await settlement.milestone(params);
      } else {
        const params: DepositParams = {
          depositor: form.partyA,
          recipient: form.partyB,
          amount_sats: amountSats,
          deadline_hours: parseInt(form.deadlineHours) || 48,
        };
        res = await settlement.deposit(params);
      }
      setResult(res);
      setView('success');
      toast.success('Agreement created!');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setView('grid');
    setSelectedTemplate(null);
    setResult(null);
    setForm(DEFAULT_FORM);
    setWizardStep(0);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto p-6"
    >
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl text-white">Settlement Hub</h1>
        <p className="text-white/40 text-sm mt-0.5">
          Create trustless on-chain settlements using Irium's proof-based escrow system
        </p>
      </div>

      <AnimatePresence mode="wait">
        {/* ── GRID VIEW ─────────────────────────────────────────── */}
        {view === 'grid' && (
          <motion.div
            key="grid"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, x: -40 }}
          >
            <motion.div
              className="grid grid-cols-2 gap-4 max-w-2xl"
              variants={containerVariants}
            >
              {TEMPLATES.map((template) => (
                <motion.div
                  key={template.id}
                  variants={itemVariants}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTemplateSelect(template.id)}
                  className="card-interactive p-6 cursor-pointer flex flex-col items-center text-center gap-3 relative overflow-hidden"
                >
                  {/* Color glow behind icon */}
                  <div
                    className={`absolute top-4 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full blur-2xl opacity-20 ${template.glowBg}`}
                  />

                  {/* Icon */}
                  <div className={`relative z-10 p-4 rounded-2xl ${template.iconBg}`}>
                    <template.Icon size={28} className={template.iconColor} />
                  </div>

                  <div className="relative z-10">
                    <div className="font-display font-bold text-lg text-white">{template.name}</div>
                    <div className="text-white/50 text-sm mt-1">{template.desc}</div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}

        {/* ── WIZARD VIEW ───────────────────────────────────────── */}
        {view === 'wizard' && selectedTemplate && (
          <motion.div
            key="wizard"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.3 }}
            className="max-w-lg"
          >
            {/* Back button */}
            <button onClick={handleBack} className="btn-ghost mb-6 flex items-center gap-2 text-white/50 hover:text-white">
              <ArrowLeft size={16} />
              {wizardStep > 0 ? 'Back' : 'All Templates'}
            </button>

            {/* Progress indicator */}
            <div className="flex items-center gap-2 mb-8">
              {steps.map((step, i) => (
                <React.Fragment key={i}>
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-display font-bold transition-all duration-300 ${
                      i <= wizardStep
                        ? 'bg-irium-500 text-white'
                        : 'bg-surface-600 text-white/30'
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 transition-all duration-500 ${
                        i < wizardStep ? 'bg-irium-500' : 'bg-white/10'
                      }`}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {/* Step 0 — Form fields */}
              {wizardStep === 0 && (
                <motion.div
                  key="step-0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="card p-6 space-y-4"
                >
                  <div className="mb-2">
                    <h2 className="font-display font-bold text-xl text-white">
                      {TEMPLATES.find((t) => t.id === selectedTemplate)?.name}
                    </h2>
                    <p className="text-white/40 text-sm mt-0.5">
                      {TEMPLATES.find((t) => t.id === selectedTemplate)?.desc}
                    </p>
                  </div>

                  {/* Party A */}
                  <div>
                    <label className="label">{getLabels(selectedTemplate).partyA}</label>
                    <input
                      className="input"
                      placeholder="P..."
                      value={form.partyA}
                      onChange={setField('partyA')}
                    />
                  </div>

                  {/* Party B */}
                  <div>
                    <label className="label">{getLabels(selectedTemplate).partyB}</label>
                    <input
                      className="input"
                      placeholder="P..."
                      value={form.partyB}
                      onChange={setField('partyB')}
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="label">Amount (IRM)</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="0.0000"
                      value={form.amountIrm}
                      onChange={setField('amountIrm')}
                    />
                    {form.amountIrm && parseFloat(form.amountIrm) > 0 && (
                      <div className="text-xs text-white/30 mt-1 font-mono">
                        {Math.round(parseFloat(form.amountIrm) * SATS_PER_IRM).toLocaleString()} sats
                      </div>
                    )}
                  </div>

                  {/* Deadline hours — not for milestone */}
                  {selectedTemplate !== 'milestone' && (
                    <div>
                      <label className="label">Deadline (hours)</label>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        value={form.deadlineHours}
                        onChange={setField('deadlineHours')}
                      />
                    </div>
                  )}

                  {/* Scope — freelance only */}
                  {selectedTemplate === 'freelance' && (
                    <div>
                      <label className="label">Work Scope (optional)</label>
                      <textarea
                        className="input h-20 resize-none"
                        placeholder="Describe the deliverables..."
                        value={form.scope}
                        onChange={setField('scope')}
                      />
                    </div>
                  )}

                  {/* Milestone count — milestone only */}
                  {selectedTemplate === 'milestone' && (
                    <div>
                      <label className="label">Number of Milestones</label>
                      <input
                        className="input"
                        type="number"
                        min="2"
                        max="10"
                        value={form.milestoneCount}
                        onChange={setField('milestoneCount')}
                      />
                      {form.amountIrm && form.milestoneCount && (
                        <div className="text-xs text-white/30 mt-1 font-mono">
                          {formatIRM(
                            Math.round(
                              (parseFloat(form.amountIrm) / (parseInt(form.milestoneCount) || 1)) * SATS_PER_IRM
                            )
                          )}{' '}
                          per milestone
                        </div>
                      )}
                    </div>
                  )}

                  {/* Memo — OTC only */}
                  {selectedTemplate === 'otc' && (
                    <div>
                      <label className="label">Memo (optional)</label>
                      <input
                        className="input"
                        placeholder="Trade description..."
                        value={form.memo}
                        onChange={setField('memo')}
                      />
                    </div>
                  )}

                  <button
                    onClick={handleNext}
                    disabled={!form.partyA || !form.partyB || !form.amountIrm}
                    className="btn-primary w-full justify-center mt-2"
                  >
                    Continue to Review
                  </button>
                </motion.div>
              )}

              {/* Step 1 — Review */}
              {wizardStep === 1 && (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-4"
                >
                  <div className="mb-2">
                    <h2 className="font-display font-bold text-xl text-white">Review Agreement</h2>
                    <p className="text-white/40 text-sm mt-0.5">Verify all details before confirming</p>
                  </div>

                  <div className="glass rounded-xl p-5 space-y-3">
                    {getReviewRows(selectedTemplate, form).map((row) => (
                      <div key={row.label} className="flex justify-between items-start gap-4 text-sm">
                        <span className="text-white/40 shrink-0">{row.label}</span>
                        <span className="font-mono text-white/80 text-right break-all">{row.value}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="btn-primary w-full justify-center"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Creating Agreement…
                      </>
                    ) : (
                      'Confirm & Create'
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── SUCCESS VIEW ──────────────────────────────────────── */}
        {view === 'success' && result && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center justify-center min-h-[calc(100vh-12rem)]"
          >
            <div className="max-w-md w-full text-center">
              {/* SVG checkmark circle */}
              <motion.svg
                width="80"
                height="80"
                viewBox="0 0 80 80"
                className="mx-auto mb-6"
              >
                <motion.circle
                  cx="40"
                  cy="40"
                  r="36"
                  fill="none"
                  stroke="#7b2fe2"
                  strokeWidth="3"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                <motion.path
                  d="M24 40 L36 52 L56 28"
                  fill="none"
                  stroke="#7b2fe2"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
                />
              </motion.svg>

              <h2 className="font-display font-bold text-3xl text-white mb-2">Agreement Created</h2>
              <p className="text-white/40 text-sm mb-8">
                The settlement is now active on the Irium blockchain.
              </p>

              {/* Details card */}
              <div className="glass rounded-xl p-5 mb-6 text-left space-y-4">
                {/* Agreement ID */}
                <div>
                  <div className="text-xs text-white/40 mb-1">Agreement ID</div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-white/80 break-all">{result.agreement_id}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(result.agreement_id);
                        toast.success('Copied');
                      }}
                      className="btn-ghost p-1.5 shrink-0"
                      title="Copy Agreement ID"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>

                {/* Hash */}
                {result.hash && (
                  <div>
                    <div className="text-xs text-white/40 mb-1">Transaction Hash</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm text-white/60">{truncateHash(result.hash)}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(result.hash!);
                          toast.success('Copied');
                        }}
                        className="btn-ghost p-1.5 shrink-0"
                        title="Copy Hash"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/40">Status</span>
                  <span className="badge badge-info">Active</span>
                </div>

                {/* Message if present */}
                {result.message && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/40">Message</span>
                    <span className="text-white/60 text-xs">{result.message}</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => navigate('/agreements')}
                  className="btn-secondary"
                >
                  View Agreements
                </button>
                <button
                  onClick={resetAll}
                  className="btn-primary"
                >
                  New Settlement
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
