import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftRight, Briefcase, Target, Landmark,
  ArrowLeft, Copy, Loader2, AlertCircle, CheckCircle2,
  Zap, Hourglass, Hammer, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { useStore } from '../lib/store';
import { settlement, rpc, agreements as agreementsApi, invoices } from '../lib/tauri';
import { SATS_PER_IRM, formatIRM, truncateHash } from '../lib/types';
import type { OtcParams, FreelanceParams, MilestoneParams, DepositParams, AgreementResult, Agreement } from '../lib/types';

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

// Templates that exist on-chain (irium-source/src/settlement.rs:24-33
// `MerchantDelayedSettlement` and `ContractorMilestone`) but do not have
// Tauri IPC bindings yet. Rendered as disabled cards in the grid so users
// can see they exist; backend wiring is a follow-up.
const COMING_SOON: { id: string; name: string; desc: string; Icon: React.ElementType }[] = [
  {
    id: 'merchant_delayed',
    name: 'Merchant Delayed',
    desc: 'Merchant sale with built-in cool-down window before payment settles',
    Icon: Hourglass,
  },
  {
    id: 'contractor',
    name: 'Contractor Milestones',
    desc: 'Contractor work split across milestones with per-milestone attestor proof',
    Icon: Hammer,
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

type View = 'hub' | 'grid' | 'wizard' | 'success';

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
  const [view, setView] = useState<View>('hub');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgreementResult | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feeRate, setFeeRate] = useState(0);
  const [hubAgreements, setHubAgreements] = useState<Agreement[]>([]);
  const [allAgreements, setAllAgreements] = useState<Agreement[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  // Drives the Generate Payment Invoice modal on the success card.
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const steps = ['Details', 'Review & Confirm'];

  useEffect(() => {
    rpc.mempool().then(m => {
      // min_fee_per_byte from mempool info
      if (typeof (m as { size?: number }).size === 'number') {
        setFeeRate(1);
      }
    }).catch(() => {});
    // Also try fee_estimate endpoint — routes through Tauri's HTTP API to
    // bypass CSP/CORS (see Settings.tsx and Onboarding.tsx for the same swap).
    const fetchFee = async () => {
      try {
        const resp = await tauriFetch<{ min_fee_per_byte?: number }>(`${rpcUrl}/rpc/fee_estimate`, {
          method: 'GET', timeout: 2, responseType: ResponseType.JSON,
        });
        if (resp.ok && resp.data?.min_fee_per_byte) {
          setFeeRate(resp.data.min_fee_per_byte);
        }
      } catch { /* offline */ }
    };
    fetchFee();
  }, []);

  useEffect(() => {
    if (view !== 'hub') return;
    setHubLoading(true);
    agreementsApi.list().then((list) => {
      const all = list ?? [];
      setAllAgreements(all);
      setHubAgreements(all.slice(-5).reverse());
    }).catch(() => {}).finally(() => setHubLoading(false));
  }, [view]);

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
      setView('hub');
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
    } else if (view === 'grid') {
      setView('hub');
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
    setView('hub');
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
      className="h-full overflow-y-auto"
    >
      <div className="w-full px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="page-title">Settlement Hub</h1>
        <p className="page-subtitle">
          Trustless on-chain settlements using Irium's proof-based escrow system
        </p>
      </div>

      <AnimatePresence mode="wait">
        {/* ── HUB VIEW ──────────────────────────────────────────── */}
        {view === 'hub' && (
          <motion.div
            key="hub"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            {/* Stat cards */}
            {(() => {
              const totalVol = allAgreements.reduce((s, a) => s + (a.amount ?? 0), 0) / SATS_PER_IRM;
              const pendingProofs = allAgreements.filter(a =>
                a.status === 'funded' && (a.proof_status === 'none' || a.proof_status == null)
              ).length;
              const stats = [
                { label: 'Total Agreements', value: allAgreements.length > 0 ? String(allAgreements.length) : '0' },
                { label: 'Pending Proofs',   value: String(pendingProofs) },
                { label: 'Total Volume',     value: totalVol > 0 ? `${totalVol.toFixed(4)} IRM` : '0 IRM' },
              ];
              return (
                <div className="grid grid-cols-3 gap-3">
                  {stats.map((stat) => (
                    <div key={stat.label} className="stat-card">
                      <span className="stat-card-label">{stat.label}</span>
                      <span className="stat-card-value">
                        {hubLoading ? <Loader2 size={16} className="animate-spin" /> : stat.value}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Entry buttons */}
            <div className="grid grid-cols-2 gap-4">
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate('/settlement/seller-wizard')}
                className="card-interactive p-6 text-left flex flex-col gap-3 relative overflow-hidden"
              >
                <div className="absolute top-4 right-4 w-20 h-20 rounded-full blur-2xl opacity-25" style={{ background: '#6ec6ff' }} />
                <div className="p-3 rounded-xl w-fit" style={{ background: 'rgba(110,198,255,0.16)', border: '1px solid rgba(110,198,255,0.32)' }}>
                  <Zap size={20} style={{ color: '#6ec6ff' }} />
                </div>
                <div>
                  <div className="font-display font-bold text-lg text-white">I'm Selling</div>
                  <div className="text-white/45 text-sm mt-1">Create an offer, share with buyer, receive payment on proof</div>
                </div>
                <div className="text-xs font-medium" style={{ color: '#6ec6ff' }}>Start Seller Flow →</div>
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate('/settlement/buyer-wizard')}
                className="card-interactive p-6 text-left flex flex-col gap-3 relative overflow-hidden"
              >
                <div className="absolute top-4 right-4 w-20 h-20 rounded-full blur-2xl opacity-25" style={{ background: '#a78bfa' }} />
                <div className="p-3 rounded-xl w-fit" style={{ background: 'rgba(167,139,250,0.18)', border: '1px solid rgba(167,139,250,0.30)' }}>
                  <ArrowLeftRight size={20} style={{ color: '#a78bfa' }} />
                </div>
                <div>
                  <div className="font-display font-bold text-lg text-white">I'm Buying</div>
                  <div className="text-white/45 text-sm mt-1">Find an offer, fund escrow, release payment on delivery</div>
                </div>
                <div className="text-xs font-medium" style={{ color: '#a78bfa' }}>Start Buyer Flow →</div>
              </motion.button>
            </div>

            {/* How it works — three-step explainer for first-time users.
                Sits between the big I'm Selling / I'm Buying cards and the
                advanced "Create Agreement Directly" button so the
                educational content is hit before users dive into the
                template grid. */}
            <div className="card p-5">
              <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
                How it works
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  'Create or find an agreement',
                  'Lock IRM in escrow on-chain',
                  'Submit proof — funds release automatically',
                ].map((step, i) => (
                  <div key={i} className="flex flex-col items-start gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center font-display font-bold text-xs flex-shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, #6ec6ff 0%, #a78bfa 100%)',
                        color: 'white',
                      }}
                    >
                      {i + 1}
                    </div>
                    <p className="text-xs text-white/65 leading-snug">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Create directly — promoted from a faint underlined link to a
                proper secondary button so sellers can find it without
                squinting. Still positioned below the two big buyer/seller
                cards so it reads as the "third option". */}
            <div className="text-center">
              <button
                onClick={() => setView('grid')}
                className="btn-secondary text-sm py-2 px-4"
              >
                Create Agreement Directly (advanced)
              </button>
            </div>

            {/* Recent agreements */}
            {hubAgreements.length > 0 && (
              <div className="card p-5">
                <div className="text-xs font-semibold text-white/35 uppercase tracking-wider mb-3">Recent Agreements</div>
                <div className="space-y-2">
                  {hubAgreements.map((ag) => (
                    <button
                      key={ag.id}
                      onClick={() => navigate(`/agreements/${ag.id}`)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors text-left"
                    >
                      <span className="font-mono text-xs text-white/50 flex-1 truncate">{ag.id}</span>
                      <span className={`badge-${ag.status === 'released' || ag.status === 'refunded' ? 'success' : ag.status === 'funded' ? 'info' : 'warning'} text-xs`}>
                        {ag.status}
                      </span>
                      {ag.amount != null && (
                        <span className="text-xs text-white/40 font-mono">{formatIRM(ag.amount)} IRM</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => navigate('/agreements')}
                  className="mt-3 text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  View all agreements →
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── GRID VIEW ─────────────────────────────────────────── */}
        {view === 'grid' && (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { staggerChildren: 0.08 } }}
            exit={{ opacity: 0, x: -40 }}
          >
            <button onClick={handleBack} className="btn-ghost flex items-center gap-2 text-white/50 hover:text-white mb-4">
              <ArrowLeft size={16} />Back to Hub
            </button>
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
              {/* Coming-soon cards — surface the on-chain templates that
                  exist in irium-source but have no Tauri IPC binding yet. */}
              {COMING_SOON.map((template) => (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 0.55, y: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
                  onClick={() => toast('This template exists on-chain but is not yet wired to the desktop UI. Coming soon.', { icon: '⏳' })}
                  className="card p-7 cursor-not-allowed flex flex-col items-center text-center gap-4 relative overflow-hidden"
                  title="Coming soon — backend wiring pending"
                >
                  <div
                    className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-display font-bold"
                    style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(238,240,255,0.55)' }}
                  >
                    Coming Soon
                  </div>
                  <div className="relative z-10 p-5 rounded-2xl bg-white/5">
                    <template.Icon size={32} className="text-white/40" />
                  </div>
                  <div className="relative z-10">
                    <div className="font-display font-bold text-xl text-white/60">{template.name}</div>
                    <div className="text-white/40 text-sm mt-1.5">{template.desc}</div>
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

                    {/* HTLC escrow notice — same pattern as the Marketplace
                        Create-Offer modal. Surfaces the on-chain mechanic so
                        the user knows what "create agreement" actually does. */}
                    <div
                      className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
                      style={{
                        background: 'rgba(110,198,255,0.08)',
                        border: '1px solid rgba(110,198,255,0.20)',
                        color: 'rgba(238,240,255,0.55)',
                      }}
                    >
                      <span style={{ color: '#A78BFA', flexShrink: 0, fontSize: 14 }}>🔒</span>
                      <span>
                        The IRM amount will be <strong style={{ color: 'rgba(238,240,255,0.8)' }}>locked in an on-chain HTLC escrow</strong>. It can only be released when proof conditions are met, or refunded after the timeout height.
                      </span>
                    </div>

                    {/* Party A */}
                    <ShakeField error={errors.partyA}>
                      <label className="label">{getLabels(selectedTemplate).partyA}</label>
                      <input
                        className={`input ${errors.partyA ? 'border-red-500/50' : ''}`}
                        placeholder="Q... or P..."
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
                        placeholder="Q... or P..."
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

        {/* Invoice modal — rendered as a sibling of the AnimatePresence
            views so it can overlay the success card without interfering
            with the page transitions. */}
        <AnimatePresence>
          {showInvoiceModal && result && (
            <InvoiceModal
              recipient={form.partyB}
              amountIrm={parseFloat(form.amountIrm) || 0}
              reference={result.agreement_id}
              onClose={() => setShowInvoiceModal(false)}
            />
          )}
        </AnimatePresence>

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

              {/* Wallet-backup warning — the HTLC release preimage that
                  unlocks the escrow is stored locally in the wallet file.
                  If the user loses the wallet, the preimage is gone and
                  release is no longer possible (refund still works after
                  timeout). Render BEFORE the "what happens next" box so it
                  is hit first in the success scan path. */}
              <div
                className="flex items-start gap-2 mb-3 px-3 py-3 rounded-xl text-xs text-left"
                style={{
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.30)',
                  color: 'rgba(251,191,36,0.85)',
                }}
              >
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Important:</strong> Your secret preimage is stored locally in your wallet file. Back up your wallet file now to ensure you can always release these funds. If you lose your wallet file, you cannot release the escrow.
                </span>
              </div>

              {/* What happens next — guides the user from creation into the
                  funding/proof flow. The agreement exists but the HTLC isn't
                  funded until someone calls agreement-fund on the Agreements
                  page. */}
              <div
                className="flex items-start gap-2 mb-6 px-3 py-3 rounded-xl text-xs text-left"
                style={{
                  background: 'rgba(167,139,250,0.06)',
                  border: '1px solid rgba(167,139,250,0.22)',
                  color: 'rgba(238,240,255,0.65)',
                }}
              >
                <span style={{ color: '#a78bfa', flexShrink: 0, fontSize: 14 }}>👉</span>
                <span>
                  <strong style={{ color: '#a78bfa' }}>What happens next:</strong> share this agreement pack with your counterparty. They must fund the escrow on the <span className="font-mono">Agreements</span> page before any proof can be submitted. The agreement hash above is the trade identifier — copy it now.
                </span>
              </div>

              <div className="flex gap-3 justify-center flex-wrap">
                <button onClick={copySummary} className="btn-secondary">
                  <Copy size={13} /> Copy Summary
                </button>
                <button onClick={() => setShowInvoiceModal(true)} className="btn-secondary">
                  Generate Payment Invoice
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

// ── Invoice Modal ────────────────────────────────────────────────
// Generates a payment-request JSON via the wallet's invoice-generate
// command (recipient = the agreement's payee, amount + reference taken
// from the just-created agreement). The user can either copy the JSON or
// save it to a file via Tauri's save dialog. Re-generating with an
// outPath produces a fresh invoice — accepted trade-off since the
// material fields (recipient/amount/reference) do not change.

interface InvoiceModalProps {
  recipient: string;
  amountIrm: number;
  reference: string;
  onClose: () => void;
}

function InvoiceModal({ recipient, amountIrm, reference, onClose }: InvoiceModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const result = await invoices.generate(recipient, amountIrm, reference);
        if (!mounted) return;
        // Cast for defensive rendering — we display whatever fields the
        // backend returns rather than depending on a specific shape.
        setInvoice(result as unknown as Record<string, unknown>);
      } catch (e) {
        if (mounted) setError(String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [recipient, amountIrm, reference]);

  const invoiceJson = invoice ? JSON.stringify(invoice, null, 2) : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(invoiceJson);
    toast.success('Invoice JSON copied');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const path = await save({
        defaultPath: `invoice-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) { setSaving(false); return; }
      // Re-generate with outPath so the backend writes the file directly.
      // The renderer's fs scope is restrictive; this bypasses it cleanly.
      await invoices.generate(recipient, amountIrm, reference, undefined, path);
      toast.success('Invoice saved to ' + path);
    } catch (e) {
      toast.error('Save failed: ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      key="invoice-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="card w-full max-w-lg rounded-2xl p-6 overflow-y-auto max-h-[90vh]"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-lg text-white">Payment Invoice</h2>
          <button onClick={onClose} className="btn-ghost text-white/40 p-1">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-white/50 mb-4">
          Share this invoice with the buyer so they know exactly how much to send and what reference to include.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-8 justify-center text-white/40 text-sm">
            <Loader2 size={14} className="animate-spin" /> Generating invoice…
          </div>
        )}

        {error && (
          <div className="rounded-lg p-3 text-xs text-red-400 border border-red-500/30 bg-red-500/10 mb-4">
            {error}
          </div>
        )}

        {invoice && (
          <>
            {/* Structured rows — only renders fields actually present. */}
            <div className="glass rounded-lg p-3 mb-4 space-y-1.5 text-xs">
              {invoice.recipient != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/40 flex-shrink-0">Recipient</span>
                  <span className="font-mono text-white/70 text-right break-all">{String(invoice.recipient)}</span>
                </div>
              )}
              {invoice.amount_irm != null && (
                <div className="flex justify-between">
                  <span className="text-white/40">Amount</span>
                  <span className="font-mono text-white/70">{String(invoice.amount_irm)} IRM</span>
                </div>
              )}
              {invoice.reference != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/40 flex-shrink-0">Reference</span>
                  <span className="font-mono text-white/70 text-right break-all">{String(invoice.reference)}</span>
                </div>
              )}
              {invoice.expires_height != null && (
                <div className="flex justify-between">
                  <span className="text-white/40">Expires (height)</span>
                  <span className="font-mono text-white/70">#{Number(invoice.expires_height).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Raw JSON */}
            <div className="mb-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1.5">Raw JSON</p>
              <pre className="text-[10px] font-mono text-white/60 bg-black/40 border border-white/5 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
                {invoiceJson}
              </pre>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">
                Close
              </button>
              <button onClick={handleCopy} className="btn-secondary flex-1 justify-center">
                <Copy size={13} /> Copy JSON
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex-1 justify-center disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save to File'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
