import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftRight, Briefcase, Target, Landmark,
  ArrowLeft, Copy, Loader2, AlertCircle, CheckCircle2,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useStore } from '../lib/store';
import { settlement, rpc } from '../lib/tauri';
import { SATS_PER_IRM, formatIRM, truncateHash } from '../lib/types';
import type { OtcParams, FreelanceParams, MilestoneParams, DepositParams, AgreementResult } from '../lib/types';

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
  borderColor: string;
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
    borderColor: 'border-irium-500/40',
  },
  {
    id: 'freelance',
    name: 'Freelance',
    desc: 'Contractor milestone payment',
    Icon: Briefcase,
    glowBg: 'bg-blue-500',
    iconBg: 'bg-blue-500/20',
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/40',
  },
  {
    id: 'milestone',
    name: 'Milestone',
    desc: 'Multi-stage project payment',
    Icon: Target,
    glowBg: 'bg-green-500',
    iconBg: 'bg-green-500/20',
    iconColor: 'text-green-400',
    borderColor: 'border-green-500/40',
  },
  {
    id: 'deposit',
    name: 'Deposit',
    desc: 'Collateral deposit escrow',
    Icon: Landmark,
    glowBg: 'bg-amber-500',
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/40',
  },
];

// ── Form state ───────────────────────────────────────────────────

interface FormState {
  partyA: string;
  partyB: string;
  amountIrm: string;
  deadlineHours: string;
  scope: string;
  milestoneCount: string;
  memo: string;
  assetReference: string;
  paymentMethod: string;
}

const DEFAULT_FORM: FormState = {
  partyA: '',
  partyB: '',
  amountIrm: '',
  deadlineHours: '48',
  scope: '',
  milestoneCount: '3',
  memo: '',
  assetReference: '',
  paymentMethod: '',
};

type View = 'grid' | 'wizard' | 'success';

function getLabels(id: TemplateId): { partyA: string; partyB: string } {
  switch (id) {
    case 'otc':       return { partyA: 'Buyer Address',      partyB: 'Seller Address'     };
    case 'freelance': return { partyA: 'Client Address',     partyB: 'Contractor Address' };
    case 'milestone': return { partyA: 'Payer Address',      partyB: 'Payee Address'      };
    case 'deposit':   return { partyA: 'Depositor Address',  partyB: 'Recipient Address'  };
  }
}

function validateStep0(id: TemplateId, form: FormState): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.partyA.trim()) errs.partyA = 'Address is required';
  if (!form.partyB.trim()) errs.partyB = 'Address is required';
  const amt = parseFloat(form.amountIrm);
  if (!form.amountIrm.trim() || isNaN(amt) || amt <= 0) errs.amountIrm = 'Enter a positive amount';
  if (id === 'milestone') {
    const mc = parseInt(form.milestoneCount);
    if (isNaN(mc) || mc < 2 || mc > 20) errs.milestoneCount = 'Between 2 and 20';
  }
  return errs;
}

function getReviewRows(id: TemplateId, form: FormState): Array<{ label: string; value: string; highlight?: boolean }> {
  const labels = getLabels(id);
  const amountSats = Math.round(parseFloat(form.amountIrm || '0') * SATS_PER_IRM);
  const rows: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: labels.partyA, value: form.partyA || '—' },
    { label: labels.partyB, value: form.partyB || '—' },
    { label: 'Amount', value: form.amountIrm ? `${form.amountIrm} IRM (${amountSats.toLocaleString()} sats)` : '—', highlight: true },
  ];
  if (id !== 'milestone') rows.push({ label: 'Deadline', value: `${form.deadlineHours}h` });
  if (id === 'freelance' && form.scope) rows.push({ label: 'Scope', value: form.scope });
  if (id === 'milestone') {
    rows.push({ label: 'Milestones', value: form.milestoneCount });
    const count = parseInt(form.milestoneCount) || 1;
    if (form.amountIrm) {
      const perMs = parseFloat(form.amountIrm) / count;
      rows.push({ label: 'Per Milestone', value: `${perMs.toFixed(4)} IRM` });
    }
  }
  if (id === 'otc' && form.memo) rows.push({ label: 'Memo', value: form.memo });
  if (id === 'otc' && form.assetReference) rows.push({ label: 'Asset Ref', value: form.assetReference });
  if (id === 'otc' && form.paymentMethod) rows.push({ label: 'Payment', value: form.paymentMethod });
  return rows;
}

// ── Preview card ─────────────────────────────────────────────────

function PreviewCard({
  id,
  form,
  feeRate,
}: {
  id: TemplateId;
  form: FormState;
  feeRate: number;
}) {
  const t = TEMPLATES.find((x) => x.id === id)!;
  const amtSats = Math.round(parseFloat(form.amountIrm || '0') * SATS_PER_IRM);
  const hasContent = amtSats > 0 || form.partyA || form.partyB;
  const milestoneCount = parseInt(form.milestoneCount) || 1;

  return (
    <div
      className={`card p-5 h-fit sticky top-0 transition-all duration-500
        ${hasContent ? `border ${t.borderColor} preview-pulse` : 'border-white/5'}`}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-7 h-7 rounded-lg ${t.iconBg} flex items-center justify-center`}>
          <t.Icon size={14} className={t.iconColor} />
        </div>
        <p className="font-display font-semibold text-sm text-white">{t.name} Preview</p>
        {hasContent && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-slow" />
        )}
      </div>

      {!hasContent ? (
        <p className="text-xs text-white/20 text-center py-4">Fill the form to see a live preview</p>
      ) : (
        <div className="space-y-2.5">
          {form.partyA && (
            <div className="flex justify-between text-xs gap-2">
              <span className="text-white/40 shrink-0">{getLabels(id).partyA.split(' ')[0]}</span>
              <span className="font-mono text-white/60 truncate max-w-[60%]">{form.partyA}</span>
            </div>
          )}
          {form.partyB && (
            <div className="flex justify-between text-xs gap-2">
              <span className="text-white/40 shrink-0">{getLabels(id).partyB.split(' ')[0]}</span>
              <span className="font-mono text-white/60 truncate max-w-[60%]">{form.partyB}</span>
            </div>
          )}

          {amtSats > 0 && (
            <>
              <div className="border-t border-white/5 pt-2.5" />
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Amount</span>
                <span className={`font-mono font-semibold ${t.iconColor}`}>{formatIRM(amtSats)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Sats</span>
                <span className="font-mono text-white/50">{amtSats.toLocaleString()}</span>
              </div>
              {feeRate > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-white/40 flex items-center gap-1"><Zap size={9} />Fee rate</span>
                  <span className="font-mono text-white/50">{feeRate} sat/b</span>
                </div>
              )}
              {id === 'milestone' && milestoneCount > 1 && (
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">Per milestone</span>
                  <span className="font-mono text-white/50">{formatIRM(Math.floor(amtSats / milestoneCount))}</span>
                </div>
              )}
              {form.deadlineHours && id !== 'milestone' && (
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">Deadline</span>
                  <span className="font-mono text-white/50">{form.deadlineHours}h</span>
                </div>
              )}
            </>
          )}

          <div className="border-t border-white/5 pt-2.5">
            <div className="flex justify-between text-xs font-display font-semibold">
              <span className="text-white/40">Type</span>
              <span className={t.iconColor}>{t.name}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shake wrapper ────────────────────────────────────────────────

function ShakeField({ error, children }: { error?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prevError = useRef(error);

  useEffect(() => {
    if (error && error !== prevError.current && ref.current) {
      ref.current.animate(
        [
          { transform: 'translateX(0)'  },
          { transform: 'translateX(-6px)' },
          { transform: 'translateX(6px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(4px)' },
          { transform: 'translateX(0)'  },
        ],
        { duration: 350, easing: 'ease-out' }
      );
    }
    prevError.current = error;
  }, [error]);

  return <div ref={ref}>{children}</div>;
}

// ── Main component ───────────────────────────────────────────────

export default function SettlementPage() {
  const navigate = useNavigate();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const rpcUrl = useStore((s) => s.settings.rpc_url);
  const [view, setView] = useState<View>('grid');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgreementResult | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feeRate, setFeeRate] = useState(0);

  const steps = ['Details', 'Review & Confirm'];

  useEffect(() => {
    rpc.mempool().then(m => {
      // min_fee_per_byte from mempool info
      if (typeof (m as { size?: number }).size === 'number') {
        setFeeRate(1);
      }
    }).catch(() => {});
    // Also try fee_estimate endpoint indirectly
    const fetchFee = async () => {
      try {
        const resp = await fetch(`${rpcUrl}/rpc/fee_estimate`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const data = await resp.json() as { min_fee_per_byte?: number };
          if (data.min_fee_per_byte) setFeeRate(data.min_fee_per_byte);
        }
      } catch { /* offline */ }
    };
    fetchFee();
  }, []);

  const setField = useCallback((key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [errors]);

  const handleTemplateSelect = (id: TemplateId) => {
    setSelectedTemplate(id);
    setView('wizard');
    setWizardStep(0);
    setForm(DEFAULT_FORM);
    setErrors({});
  };

  const handleBack = () => {
    if (view === 'success') {
      setView('grid');
      setSelectedTemplate(null);
      setResult(null);
      setForm(DEFAULT_FORM);
      setErrors({});
    } else if (view === 'wizard') {
      if (wizardStep > 0) {
        setWizardStep((s) => s - 1);
      } else {
        setView('grid');
        setSelectedTemplate(null);
        setErrors({});
      }
    }
  };

  const handleNext = () => {
    if (!selectedTemplate) return;
    const errs = validateStep0(selectedTemplate, form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
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
          asset_reference: form.assetReference || undefined,
          payment_method: form.paymentMethod || undefined,
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

  const copySummary = useCallback(() => {
    if (!result || !selectedTemplate) return;
    const t = TEMPLATES.find((x) => x.id === selectedTemplate)!;
    const amtSats = Math.round(parseFloat(form.amountIrm || '0') * SATS_PER_IRM);
    const lines = [
      `Irium ${t.name} Agreement`,
      `ID: ${result.agreement_id}`,
      result.hash ? `Hash: ${result.hash}` : '',
      `Amount: ${form.amountIrm} IRM (${amtSats.toLocaleString()} sats)`,
      ...getReviewRows(selectedTemplate, form)
        .filter(r => !['Amount'].includes(r.label) && r.value !== '—')
        .map(r => `${r.label}: ${r.value}`),
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines);
    toast.success('Summary copied');
  }, [result, selectedTemplate, form]);

  const resetAll = () => {
    setView('grid');
    setSelectedTemplate(null);
    setResult(null);
    setForm(DEFAULT_FORM);
    setWizardStep(0);
    setErrors({});
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto p-6"
    >
      <div className="max-w-6xl mx-auto">
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { staggerChildren: 0.08 } }}
            exit={{ opacity: 0, x: -40 }}
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {TEMPLATES.map((template) => (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
                  whileHover={{ scale: 1.02, y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTemplateSelect(template.id)}
                  className="card-interactive p-7 cursor-pointer flex flex-col items-center text-center gap-4 relative overflow-hidden"
                >
                  <div className={`absolute top-6 left-1/2 -translate-x-1/2 w-28 h-28 rounded-full blur-3xl opacity-25 ${template.glowBg}`} />
                  <div className={`relative z-10 p-5 rounded-2xl ${template.iconBg}`}>
                    <template.Icon size={32} className={template.iconColor} />
                  </div>
                  <div className="relative z-10">
                    <div className="font-display font-bold text-xl text-white">{template.name}</div>
                    <div className="text-white/50 text-sm mt-1.5">{template.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>
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
          >
            {/* Back + progress */}
            <div className="flex items-center gap-4 mb-6">
              <button onClick={handleBack} className="btn-ghost flex items-center gap-2 text-white/50 hover:text-white">
                <ArrowLeft size={16} />
                {wizardStep > 0 ? 'Back' : 'All Templates'}
              </button>
              <div className="flex items-center gap-2 ml-auto">
                {steps.map((step, i) => (
                  <React.Fragment key={i}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-display font-bold transition-all duration-300
                      ${i <= wizardStep ? 'bg-irium-500 text-white' : 'bg-surface-600 text-white/30'}`}>
                      {i < wizardStep ? <CheckCircle2 size={13} /> : i + 1}
                    </div>
                    <span className={`text-xs font-display ${i === wizardStep ? 'text-white/70' : 'text-white/25'}`}>{step}</span>
                    {i < steps.length - 1 && (
                      <div className={`w-8 h-0.5 transition-all duration-500 ${i < wizardStep ? 'bg-irium-500' : 'bg-white/10'}`} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {/* Step 0 — Form + preview */}
              {wizardStep === 0 && (
                <motion.div
                  key="step-0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="grid grid-cols-1 lg:grid-cols-5 gap-5"
                >
                  {/* Form */}
                  <div className="lg:col-span-3 card p-6 space-y-4">
                    <div className="mb-2">
                      <h2 className="font-display font-bold text-xl text-white">
                        {TEMPLATES.find((t) => t.id === selectedTemplate)?.name}
                      </h2>
                      <p className="text-white/40 text-sm mt-0.5">
                        {TEMPLATES.find((t) => t.id === selectedTemplate)?.desc}
                      </p>
                    </div>

                    {/* Party A */}
                    <ShakeField error={errors.partyA}>
                      <label className="label">{getLabels(selectedTemplate).partyA}</label>
                      <input
                        className={`input ${errors.partyA ? 'border-red-500/50' : ''}`}
                        placeholder="irm1..."
                        value={form.partyA}
                        onChange={setField('partyA')}
                      />
                      {errors.partyA && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                          <AlertCircle size={11} />{errors.partyA}
                        </p>
                      )}
                    </ShakeField>

                    {/* Party B */}
                    <ShakeField error={errors.partyB}>
                      <label className="label">{getLabels(selectedTemplate).partyB}</label>
                      <input
                        className={`input ${errors.partyB ? 'border-red-500/50' : ''}`}
                        placeholder="irm1..."
                        value={form.partyB}
                        onChange={setField('partyB')}
                      />
                      {errors.partyB && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                          <AlertCircle size={11} />{errors.partyB}
                        </p>
                      )}
                    </ShakeField>

                    {/* Amount */}
                    <ShakeField error={errors.amountIrm}>
                      <label className="label">Amount (IRM)</label>
                      <input
                        className={`input ${errors.amountIrm ? 'border-red-500/50' : ''}`}
                        type="number"
                        min="0"
                        step="0.0001"
                        placeholder="0.0000"
                        value={form.amountIrm}
                        onChange={setField('amountIrm')}
                      />
                      <div className="flex items-center justify-between mt-1">
                        {form.amountIrm && parseFloat(form.amountIrm) > 0 && (
                          <span className="text-xs text-white/30 font-mono">
                            {Math.round(parseFloat(form.amountIrm) * SATS_PER_IRM).toLocaleString()} sats
                          </span>
                        )}
                        {feeRate > 0 && (
                          <span className="text-xs text-white/30 flex items-center gap-1 ml-auto">
                            <Zap size={9} />{feeRate} sat/b est. fee rate
                          </span>
                        )}
                      </div>
                      {errors.amountIrm && (
                        <p className="text-xs text-red-400 mt-0.5 flex items-center gap-1">
                          <AlertCircle size={11} />{errors.amountIrm}
                        </p>
                      )}
                    </ShakeField>

                    {/* Deadline */}
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

                    {/* Scope — freelance */}
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

                    {/* Milestone count */}
                    {selectedTemplate === 'milestone' && (
                      <ShakeField error={errors.milestoneCount}>
                        <label className="label">Number of Milestones</label>
                        <input
                          className={`input ${errors.milestoneCount ? 'border-red-500/50' : ''}`}
                          type="number"
                          min="2"
                          max="20"
                          value={form.milestoneCount}
                          onChange={setField('milestoneCount')}
                        />
                        {form.amountIrm && form.milestoneCount && (
                          <p className="text-xs text-white/30 mt-1 font-mono">
                            {formatIRM(
                              Math.round((parseFloat(form.amountIrm) / (parseInt(form.milestoneCount) || 1)) * SATS_PER_IRM)
                            )} per milestone
                          </p>
                        )}
                        {errors.milestoneCount && (
                          <p className="text-xs text-red-400 mt-0.5 flex items-center gap-1">
                            <AlertCircle size={11} />{errors.milestoneCount}
                          </p>
                        )}
                      </ShakeField>
                    )}

                    {/* OTC extras */}
                    {selectedTemplate === 'otc' && (
                      <>
                        <div>
                          <label className="label">Asset Reference (optional)</label>
                          <input
                            className="input"
                            placeholder="e.g. BTC, ETH, USDT..."
                            value={form.assetReference}
                            onChange={setField('assetReference')}
                          />
                        </div>
                        <div>
                          <label className="label">Payment Method (optional)</label>
                          <input
                            className="input"
                            placeholder="e.g. Bank transfer, PayPal..."
                            value={form.paymentMethod}
                            onChange={setField('paymentMethod')}
                          />
                        </div>
                        <div>
                          <label className="label">Memo (optional)</label>
                          <input
                            className="input"
                            placeholder="Trade description..."
                            value={form.memo}
                            onChange={setField('memo')}
                          />
                        </div>
                      </>
                    )}

                    <button
                      onClick={handleNext}
                      className="btn-primary w-full justify-center mt-2"
                    >
                      Continue to Review
                    </button>
                  </div>

                  {/* Live preview card */}
                  <div className="lg:col-span-2">
                    <PreviewCard id={selectedTemplate} form={form} feeRate={feeRate} />
                  </div>
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
                  className="max-w-lg space-y-4"
                >
                  <div className="mb-2">
                    <h2 className="font-display font-bold text-xl text-white">Review Agreement</h2>
                    <p className="text-white/40 text-sm mt-0.5">Verify all details before confirming</p>
                  </div>

                  <div className="glass rounded-xl p-5 space-y-3">
                    {getReviewRows(selectedTemplate, form).map((row) => (
                      <div key={row.label} className="flex justify-between items-start gap-4 text-sm">
                        <span className="text-white/40 shrink-0">{row.label}</span>
                        <span className={`font-mono text-right break-all ${row.highlight ? 'text-irium-300 font-semibold' : 'text-white/80'}`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                    {feeRate > 0 && (
                      <div className="flex justify-between items-center text-sm border-t border-white/5 pt-3">
                        <span className="text-white/40 flex items-center gap-1"><Zap size={11} />Est. fee rate</span>
                        <span className="font-mono text-white/50">{feeRate} sat/b</span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={loading || !nodeStatus?.running}
                    title={!nodeStatus?.running ? 'Node must be online to create agreements' : undefined}
                    className="btn-primary w-full justify-center"
                  >
                    {loading ? (
                      <><Loader2 size={16} className="animate-spin" />Creating Agreement…</>
                    ) : (
                      'Confirm & Create'
                    )}
                  </button>

                  {!nodeStatus?.running && (
                    <p className="text-xs text-amber-400 flex items-center gap-1.5 justify-center">
                      <AlertCircle size={12} />Node must be running to submit agreements
                    </p>
                  )}
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
              <motion.svg width="80" height="80" viewBox="0 0 80 80" className="mx-auto mb-6">
                <motion.circle
                  cx="40" cy="40" r="36"
                  fill="none" stroke="#7b2fe2" strokeWidth="3"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                <motion.path
                  d="M24 40 L36 52 L56 28"
                  fill="none" stroke="#7b2fe2" strokeWidth="3"
                  strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
                />
              </motion.svg>

              <h2 className="font-display font-bold text-3xl text-white mb-2">Agreement Created</h2>
              <p className="text-white/40 text-sm mb-8">The settlement is now active on the Irium blockchain.</p>

              <div className="glass rounded-xl p-5 mb-6 text-left space-y-4">
                <div>
                  <div className="text-xs text-white/40 mb-1">Agreement ID</div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-white/80 break-all">{result.agreement_id}</span>
                    <button onClick={() => { navigator.clipboard.writeText(result.agreement_id); toast.success('Copied'); }}
                      className="btn-ghost p-1.5 shrink-0" title="Copy ID">
                      <Copy size={14} />
                    </button>
                  </div>
                </div>

                {result.hash && (
                  <div>
                    <div className="text-xs text-white/40 mb-1">Transaction Hash</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm text-white/60">{truncateHash(result.hash)}</span>
                      <button onClick={() => { navigator.clipboard.writeText(result.hash!); toast.success('Copied'); }}
                        className="btn-ghost p-1.5 shrink-0" title="Copy Hash">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/40">Status</span>
                  <span className="badge badge-info">Active</span>
                </div>

                {result.message && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/40">Message</span>
                    <span className="text-white/60 text-xs">{result.message}</span>
                  </div>
                )}

                <div className="border-t border-white/5 pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/40">Amount</span>
                    <span className="font-mono font-semibold text-irium-300">
                      {form.amountIrm} IRM
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-center">
                <button onClick={copySummary} className="btn-secondary">
                  <Copy size={13} /> Copy Summary
                </button>
                <button onClick={() => navigate('/agreements')} className="btn-secondary">
                  View Agreements
                </button>
                <button onClick={resetAll} className="btn-primary">
                  New Settlement
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </motion.div>
  );
}
