import React, { useState } from "react";
import {
  ShieldCheck,
  Handshake,
  Layers,
  Lock,
  ArrowRight,
  RefreshCw,
  Check,
} from "lucide-react";
import { settlement } from "../lib/tauri";
import { IRMToSats, formatIRM, SATS_PER_IRM } from "../lib/types";
import type { AgreementResult } from "../lib/types";
import { useStore } from "../lib/store";

type Template = "otc" | "freelance" | "milestone" | "deposit" | null;

const TEMPLATES = [
  {
    id: "otc" as const,
    icon: <Handshake size={28} />,
    label: "OTC Trade",
    desc: "Over-the-counter settlement between buyer and seller with proof-based release.",
    color: "from-irium-500/20 to-blue-600/20",
    border: "border-irium-500/30",
  },
  {
    id: "freelance" as const,
    icon: <Layers size={28} />,
    label: "Freelance",
    desc: "Client-contractor payment protected by deliverable proof and deadline.",
    color: "from-blue-500/20 to-cyan-600/20",
    border: "border-blue-500/30",
  },
  {
    id: "milestone" as const,
    icon: <ShieldCheck size={28} />,
    label: "Milestone",
    desc: "Split a payment across multiple milestones with independent release gates.",
    color: "from-emerald-500/20 to-teal-600/20",
    border: "border-emerald-500/30",
  },
  {
    id: "deposit" as const,
    icon: <Lock size={28} />,
    label: "Deposit Protection",
    desc: "Secure a deposit that automatically refunds on timeout or releases on proof.",
    color: "from-amber-500/20 to-orange-600/20",
    border: "border-amber-500/30",
  },
];

export default function SettlementPage() {
  const [active, setActive] = useState<Template>(null);
  const [result, setResult] = useState<AgreementResult | null>(null);

  if (result) {
    return <SuccessScreen result={result} onBack={() => { setResult(null); setActive(null); }} />;
  }

  if (active === "otc") return <OTCWizard onBack={() => setActive(null)} onDone={setResult} />;
  if (active === "freelance") return <FreelanceWizard onBack={() => setActive(null)} onDone={setResult} />;
  if (active === "milestone") return <MilestoneWizard onBack={() => setActive(null)} onDone={setResult} />;
  if (active === "deposit") return <DepositWizard onBack={() => setActive(null)} onDone={setResult} />;

  return (
    <div className="p-6 space-y-6 page-enter overflow-y-auto h-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-white">Settlement Hub</h1>
        <p className="text-white/40 text-sm mt-0.5">
          Create trustless on-chain settlements using Irium's proof-based escrow system
        </p>
      </div>

      {/* Info banner */}
      <div
        className="rounded-xl p-4 text-sm text-white/60"
        style={{
          background: "linear-gradient(135deg, rgba(123,47,226,0.1) 0%, rgba(37,99,235,0.08) 100%)",
          border: "1px solid rgba(123,47,226,0.2)",
        }}
      >
        <span className="text-irium-300 font-semibold">How it works: </span>
        Funds are locked in a blockchain escrow. Release requires a valid proof submission accepted by the policy attestors. Funds automatically refund after the deadline expires.
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`text-left card-interactive p-5 ${t.border} bg-gradient-to-br ${t.color}`}
          >
            <div className="flex items-start gap-4">
              <div className="text-white/70 mt-0.5 flex-shrink-0">{t.icon}</div>
              <div className="flex-1">
                <div className="font-display font-bold text-base text-white mb-1">
                  {t.label}
                </div>
                <div className="text-white/50 text-sm leading-relaxed">{t.desc}</div>
              </div>
              <ArrowRight size={16} className="text-white/30 mt-1 flex-shrink-0" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// WIZARD COMPONENTS
// ============================================================

function WizardShell({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6 page-enter overflow-y-auto h-full">
      <button onClick={onBack} className="btn-ghost mb-4 text-white/40">
        ← Back
      </button>
      <div className="max-w-lg mx-auto">
        <h1 className="font-display font-bold text-2xl text-white mb-1">{title}</h1>
        <p className="text-white/40 text-sm mb-6">{subtitle}</p>
        <div className="card p-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// OTC Wizard
function OTCWizard({ onBack, onDone }: { onBack: () => void; onDone: (r: AgreementResult) => void }) {
  const [buyer, setBuyer] = useState("");
  const [seller, setSeller] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("48");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const submit = async () => {
    if (!buyer || !seller || !amount) return;
    setLoading(true);
    try {
      const result = await settlement.otc({
        buyer,
        seller,
        amount_sats: IRMToSats(parseFloat(amount)),
        deadline_hours: deadline ? parseInt(deadline) : undefined,
        memo: memo || undefined,
      });
      onDone(result);
    } catch (e) {
      addNotification({ type: "error", title: "Settlement failed", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <WizardShell title="OTC Trade Settlement" subtitle="Buyer pays seller, released on proof of delivery" onBack={onBack}>
      <Field label="Buyer Address (P/Q prefix)">
        <input className="input" placeholder="P..." value={buyer} onChange={(e) => setBuyer(e.target.value)} />
      </Field>
      <Field label="Seller Address (P/Q prefix)">
        <input className="input" placeholder="P..." value={seller} onChange={(e) => setSeller(e.target.value)} />
      </Field>
      <Field label="Amount (IRM)">
        <input className="input" type="number" min="0" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {amount && <div className="text-xs text-white/30 mt-1 font-mono">{IRMToSats(parseFloat(amount)||0).toLocaleString()} sats</div>}
      </Field>
      <Field label="Deadline (hours)">
        <input className="input" type="number" min="1" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <Field label="Memo (optional)">
        <input className="input" placeholder="Trade description..." value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <button onClick={submit} disabled={!buyer||!seller||!amount||loading} className="btn-primary w-full justify-center mt-2">
        {loading ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        Create OTC Agreement
      </button>
    </WizardShell>
  );
}

// Freelance Wizard
function FreelanceWizard({ onBack, onDone }: { onBack: () => void; onDone: (r: AgreementResult) => void }) {
  const [client, setClient] = useState("");
  const [contractor, setContractor] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("168");
  const [scope, setScope] = useState("");
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const submit = async () => {
    setLoading(true);
    try {
      const result = await settlement.freelance({
        client,
        contractor,
        amount_sats: IRMToSats(parseFloat(amount)),
        deadline_hours: deadline ? parseInt(deadline) : undefined,
        scope: scope || undefined,
      });
      onDone(result);
    } catch (e) {
      addNotification({ type: "error", title: "Settlement failed", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <WizardShell title="Freelance Payment" subtitle="Client locks funds, contractor submits proof of work" onBack={onBack}>
      <Field label="Client Address">
        <input className="input" placeholder="P..." value={client} onChange={(e) => setClient(e.target.value)} />
      </Field>
      <Field label="Contractor Address">
        <input className="input" placeholder="P..." value={contractor} onChange={(e) => setContractor(e.target.value)} />
      </Field>
      <Field label="Amount (IRM)">
        <input className="input" type="number" min="0" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Deadline (hours)">
        <input className="input" type="number" min="1" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <Field label="Work Scope (optional)">
        <textarea className="input h-20 resize-none" placeholder="Describe the deliverables..." value={scope} onChange={(e) => setScope(e.target.value)} />
      </Field>
      <button onClick={submit} disabled={!client||!contractor||!amount||loading} className="btn-primary w-full justify-center mt-2">
        {loading ? <RefreshCw size={14} className="animate-spin" /> : <Layers size={14} />}
        Create Freelance Agreement
      </button>
    </WizardShell>
  );
}

// Milestone Wizard
function MilestoneWizard({ onBack, onDone }: { onBack: () => void; onDone: (r: AgreementResult) => void }) {
  const [payer, setPayer] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [milestones, setMilestones] = useState("3");
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const submit = async () => {
    setLoading(true);
    try {
      const result = await settlement.milestone({
        payer,
        payee,
        amount_sats: IRMToSats(parseFloat(amount)),
        milestone_count: parseInt(milestones),
      });
      onDone(result);
    } catch (e) {
      addNotification({ type: "error", title: "Settlement failed", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const perMilestone = amount && milestones
    ? formatIRM(IRMToSats(parseFloat(amount) / parseInt(milestones)))
    : null;

  return (
    <WizardShell title="Milestone Payment" subtitle="Release funds in stages as work is completed" onBack={onBack}>
      <Field label="Payer Address">
        <input className="input" placeholder="P..." value={payer} onChange={(e) => setPayer(e.target.value)} />
      </Field>
      <Field label="Payee Address">
        <input className="input" placeholder="P..." value={payee} onChange={(e) => setPayee(e.target.value)} />
      </Field>
      <Field label="Total Amount (IRM)">
        <input className="input" type="number" min="0" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Number of Milestones">
        <input className="input" type="number" min="2" max="10" value={milestones} onChange={(e) => setMilestones(e.target.value)} />
        {perMilestone && <div className="text-xs text-white/30 mt-1 font-mono">{perMilestone} per milestone</div>}
      </Field>
      <button onClick={submit} disabled={!payer||!payee||!amount||loading} className="btn-primary w-full justify-center mt-2">
        {loading ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        Create Milestone Agreement
      </button>
    </WizardShell>
  );
}

// Deposit Wizard
function DepositWizard({ onBack, onDone }: { onBack: () => void; onDone: (r: AgreementResult) => void }) {
  const [depositor, setDepositor] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("720");
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const submit = async () => {
    setLoading(true);
    try {
      const result = await settlement.deposit({
        depositor,
        recipient,
        amount_sats: IRMToSats(parseFloat(amount)),
        deadline_hours: deadline ? parseInt(deadline) : undefined,
      });
      onDone(result);
    } catch (e) {
      addNotification({ type: "error", title: "Settlement failed", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <WizardShell title="Deposit Protection" subtitle="Secure deposit that refunds if conditions aren't met" onBack={onBack}>
      <Field label="Depositor Address">
        <input className="input" placeholder="P..." value={depositor} onChange={(e) => setDepositor(e.target.value)} />
      </Field>
      <Field label="Recipient Address">
        <input className="input" placeholder="P..." value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </Field>
      <Field label="Deposit Amount (IRM)">
        <input className="input" type="number" min="0" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Timeout Deadline (hours)">
        <input className="input" type="number" min="1" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <div className="text-xs text-white/30 mt-1">Funds auto-refund after {Math.floor(parseInt(deadline||"0")/24)}d {parseInt(deadline||"0")%24}h if not released</div>
      </Field>
      <button onClick={submit} disabled={!depositor||!recipient||!amount||loading} className="btn-primary w-full justify-center mt-2">
        {loading ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
        Create Deposit Agreement
      </button>
    </WizardShell>
  );
}

// Success screen
function SuccessScreen({ result, onBack }: { result: AgreementResult; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(result.agreement_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 page-enter overflow-y-auto h-full flex items-center justify-center">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mx-auto irium-glow">
          <Check size={32} className="text-green-400" />
        </div>
        <div>
          <h2 className="font-display font-bold text-2xl text-white">Agreement Created!</h2>
          <p className="text-white/40 text-sm mt-1">The settlement is now active on the Irium blockchain.</p>
        </div>
        <div className="card p-4 text-left space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Agreement ID</span>
            <span className="font-mono text-xs text-white/80">{result.agreement_id}</span>
          </div>
          {result.hash && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Hash</span>
              <span className="font-mono text-xs text-white/60">{result.hash?.slice(0, 16)}...</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Status</span>
            <span className="badge badge-info">Active</span>
          </div>
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={copy} className="btn-secondary">
            {copied ? <Check size={14} /> : null}
            {copied ? "Copied!" : "Copy ID"}
          </button>
          <button onClick={onBack} className="btn-primary">
            Create Another
          </button>
        </div>
      </div>
    </div>
  );
}
