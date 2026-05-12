import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Copy, Loader2, AlertCircle,
  Upload, ChevronDown,
  ArrowLeftRight, Briefcase, Target, Landmark,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { offers, wallet } from '../lib/tauri';
import { useStore } from '../lib/store';
import type { CreateOfferParams, CreateOfferResult, AddressInfo } from '../lib/types';
import { SATS_PER_IRM } from '../lib/types';

// Step 0 = Choose Type, then create + share. The seller's job ends at the
// Share step — once the buyer takes the offer an agreement is automatically
// created and visible on the Agreements page. Proof submission and release
// happen there, not in this wizard.
const STEPS = ['Choose Type', 'Create Offer', 'Share Offer'];
const PAYMENT_SUGGESTIONS = ['bank transfer', 'cash', 'crypto', 'PayPal', 'wire transfer', 'other'];

// Settlement type the seller is initiating. The offer-create binary command
// has no typed-template field, so the chosen label gets prefixed onto the
// offer description so buyers see what kind of trade this is.
type TemplateId = 'otc' | 'freelance' | 'milestone' | 'deposit';

const TEMPLATES: ReadonlyArray<{
  id: TemplateId;
  name: string;
  desc: string;
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  glowBg: string;
}> = [
  { id: 'otc',       name: 'OTC Trade',  desc: 'Peer-to-peer trade with escrow', Icon: ArrowLeftRight, iconBg: 'bg-irium-500/20', iconColor: 'text-irium-400', glowBg: 'bg-irium-500' },
  { id: 'freelance', name: 'Freelance',  desc: 'Contractor milestone payment',   Icon: Briefcase,      iconBg: 'bg-blue-500/20',  iconColor: 'text-blue-400',  glowBg: 'bg-blue-500'  },
  { id: 'milestone', name: 'Milestone',  desc: 'Multi-stage project payment',    Icon: Target,         iconBg: 'bg-green-500/20', iconColor: 'text-green-400', glowBg: 'bg-green-500' },
  { id: 'deposit',   name: 'Deposit',    desc: 'Collateral deposit escrow',      Icon: Landmark,       iconBg: 'bg-amber-500/20', iconColor: 'text-amber-400', glowBg: 'bg-amber-500' },
];

export default function SellerWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 0 (Choose Type) state. Null until the user clicks a template card.
  const [template, setTemplate] = useState<TemplateId | null>(null);

  // Wallet addresses — filtered against the store's hidden-address set so
  // the seller dropdown stays in lock-step with the Wallet page (an address
  // the user has hidden there shouldn't reappear as a sellable choice here).
  const hiddenAddresses = useStore((s) => s.hiddenAddresses);
  const [addresses, setAddresses] = useState<AddressInfo[]>([]);
  const [sellerAddr, setSellerAddr] = useState('');

  // Step 1 (Create Offer) form state
  const [amountIrm, setAmountIrm] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [timeoutBlocks, setTimeoutBlocks] = useState('1000');
  const [priceNote, setPriceNote] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [offerResult, setOfferResult] = useState<CreateOfferResult | null>(null);

  useEffect(() => {
    wallet.listAddresses().then((list) => {
      if (list && list.length > 0) {
        // Match the store's internal trim() normalization so an address
        // hidden as "X " also hides matching "X".
        const visible = list.filter((a) => !hiddenAddresses.has(a.address.trim()));
        setAddresses(visible);
        if (visible.length > 0) setSellerAddr(visible[0].address);
      }
    }).catch(() => {});
  }, [hiddenAddresses]);

  const estTime = (blocks: string) => {
    const n = parseInt(blocks);
    if (isNaN(n) || n <= 0) return '';
    const mins = n * 10;
    if (mins < 60) return `~${mins} min`;
    const hrs = (mins / 60).toFixed(1);
    return `~${hrs} hr`;
  };

  const handleCreateOffer = async () => {
    if (!amountIrm || isNaN(parseFloat(amountIrm)) || parseFloat(amountIrm) <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!paymentMethod.trim()) {
      setError('Payment method is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Prefix the chosen template label into description so buyers see what
      // kind of settlement this is — the offer-create binary command has no
      // typed template field of its own.
      const tmplLabel = TEMPLATES.find((t) => t.id === template)?.name;
      const userNote = priceNote.trim();
      const description = tmplLabel
        ? (userNote ? `[${tmplLabel}] ${userNote}` : `[${tmplLabel}]`)
        : (userNote || undefined);
      const params: CreateOfferParams = {
        amount_sats: Math.round(parseFloat(amountIrm) * SATS_PER_IRM),
        seller_address: sellerAddr || undefined,
        payment_method: paymentMethod.trim(),
        payment_instructions: paymentInstructions.trim() || undefined,
        timeout_blocks: parseInt(timeoutBlocks) || 1000,
        description,
      };
      const res = await offers.create(params);
      if (!res) throw new Error('No response from node');
      setOfferResult(res);
      setStep(2);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleExportOffer = async () => {
    if (!offerResult?.id) return;
    try {
      const outPath = await saveDialog({
        title: 'Save Offer File',
        defaultPath: `offer-${offerResult.id.slice(0, 8)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!outPath) return;
      await offers.export(offerResult.id, outPath as string);
      toast.success('Offer exported');
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleCopyOfferId = () => {
    if (!offerResult?.id) return;
    navigator.clipboard.writeText(offerResult.id);
    toast.success('Offer ID copied');
  };

  const handleBack = useCallback(() => {
    if (step === 0) navigate('/settlement');
    else setStep((s) => s - 1);
  }, [step, navigate]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto p-6"
    >
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={handleBack} className="btn-ghost flex items-center gap-2 text-white/50 hover:text-white">
            <ArrowLeft size={16} />
            {step === 0 ? 'Settlement Hub' : 'Back'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {STEPS.map((s, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${i < step ? 'bg-irium-500 text-white' : i === step ? 'bg-irium-500/80 text-white ring-2 ring-irium-400/40' : 'bg-white/10 text-white/25'}`}>
                  {i < step ? <CheckCircle2 size={12} /> : i + 1}
                </span>
                {i < STEPS.length - 1 && (
                  <span className={`w-6 h-0.5 ${i < step ? 'bg-irium-500' : 'bg-white/10'}`} />
                )}
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step 0: Choose Type ── four-card template grid mirroring
              the "Create Agreement Directly" path from the Settlement Hub.
              The selected template label is carried forward and prefixed
              onto the offer description so the buyer knows the trade type. */}
          {step === 0 && (
            <motion.div
              key="s0-type"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              <div>
                <h2 className="font-display font-bold text-xl text-white">Choose Settlement Type</h2>
                <p className="text-white/40 text-sm mt-1">
                  Pick the template that best describes what you are selling. This becomes part of the offer your buyer sees.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {TEMPLATES.map((t) => {
                  const selected = template === t.id;
                  return (
                    <motion.button
                      key={t.id}
                      type="button"
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setTemplate(t.id)}
                      className={`card-interactive p-6 text-left flex flex-col gap-3 relative overflow-hidden transition-colors ${
                        selected ? 'ring-2 ring-irium-500/60 bg-irium-500/[0.04]' : ''
                      }`}
                    >
                      <div className={`absolute top-4 right-4 w-20 h-20 rounded-full blur-2xl opacity-25 ${t.glowBg}`} />
                      <div className={`p-3 rounded-xl w-fit ${t.iconBg}`}>
                        <t.Icon size={20} className={t.iconColor} />
                      </div>
                      <div>
                        <div className="font-display font-bold text-lg text-white">{t.name}</div>
                        <div className="text-white/45 text-sm mt-1">{t.desc}</div>
                      </div>
                      {selected && (
                        <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-irium-500 flex items-center justify-center">
                          <CheckCircle2 size={12} className="text-white" />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              <button
                onClick={() => template && setStep(1)}
                disabled={!template}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {template
                  ? `Continue with ${TEMPLATES.find((t) => t.id === template)?.name} →`
                  : 'Select a template to continue'}
              </button>
            </motion.div>
          )}

          {/* ── Step 1: Create Offer ── */}
          {step === 1 && (
            <motion.div
              key="s0"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="card flex flex-col overflow-hidden"
              style={{ maxHeight: 'calc(100vh - 9rem)' }}
            >
              {/* Scrollable fields — button stays pinned below */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">
                <div>
                  <h2 className="font-display font-bold text-xl text-white">Create Your Offer</h2>
                  <p className="text-white/40 text-sm mt-1">Define what you're selling and the price</p>
                </div>

                {/* Seller Address */}
                <div className="space-y-1">
                  <label className="label">Seller Address</label>
                  <div className="relative">
                    <select
                      className="input w-full appearance-none pr-8"
                      value={sellerAddr}
                      onChange={(e) => setSellerAddr(e.target.value)}
                    >
                      {/* Inline styles on <option> propagate to the native
                          dropdown list in Chromium / WebView2 — CSS class
                          selectors on the parent <select> do not. Without
                          this the list rendered white-on-white on Windows. */}
                      {addresses.length === 0 && (
                        <option value="" style={{ background: '#0f0f23', color: '#eef0ff' }}>
                          No wallet addresses found
                        </option>
                      )}
                      {addresses.map((a) => (
                        <option
                          key={a.address}
                          value={a.address}
                          style={{ background: '#0f0f23', color: '#eef0ff' }}
                        >
                          {a.address}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                  <p className="text-xs text-white/25">Auto-detected from your wallet. Buyers will send payment here.</p>
                </div>

                {/* Amount — matches the Settlement.tsx OTC wizard treatment
                    (numeric input + sats preview) so the field is clearly
                    visible and the user sees the on-chain value as they type. */}
                <div className="space-y-1">
                  <label className="label">Amount (IRM)</label>
                  <input
                    className={`input ${error && !amountIrm ? 'border-red-500/50' : ''}`}
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder="0.0000"
                    value={amountIrm}
                    onChange={(e) => { setAmountIrm(e.target.value); setError(''); }}
                  />
                  {amountIrm && parseFloat(amountIrm) > 0 && (
                    <p className="text-xs text-white/30 font-mono">
                      {Math.round(parseFloat(amountIrm) * SATS_PER_IRM).toLocaleString()} sats
                    </p>
                  )}
                </div>

                {/* Payment Method */}
                <div className="space-y-1">
                  <label className="label">Payment Method</label>
                  <input
                    list="payment-suggestions"
                    className={`input ${error && !paymentMethod ? 'border-red-500/50' : ''}`}
                    placeholder="bank transfer, cash, crypto…"
                    value={paymentMethod}
                    onChange={(e) => { setPaymentMethod(e.target.value); setError(''); }}
                  />
                  <datalist id="payment-suggestions">
                    {PAYMENT_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>

                {/* Timeout in blocks */}
                <div className="space-y-1">
                  <label className="label">Timeout <span className="text-white/25">(blocks)</span></label>
                  <div className="flex items-center gap-3">
                    <input
                      className="input flex-1"
                      type="number"
                      min="1"
                      placeholder="1000"
                      value={timeoutBlocks}
                      onChange={(e) => setTimeoutBlocks(e.target.value)}
                    />
                    {timeoutBlocks && (
                      <span className="text-xs text-white/35 flex-shrink-0">{estTime(timeoutBlocks)}</span>
                    )}
                  </div>
                  <p className="text-xs text-white/25">Offer expires this many blocks from now (~10 min/block)</p>
                </div>

                {/* Price Note */}
                <div className="space-y-1">
                  <label className="label">Price Note <span className="text-white/25">(optional)</span></label>
                  <input
                    className="input"
                    placeholder="e.g. 'BTC only, instant settlement'"
                    value={priceNote}
                    onChange={(e) => setPriceNote(e.target.value)}
                  />
                </div>

                {/* Payment Instructions */}
                <div className="space-y-1">
                  <label className="label">Payment Instructions <span className="text-white/25">(optional)</span></label>
                  <textarea
                    className="input resize-none"
                    rows={3}
                    placeholder="Bank details, crypto address, or other instructions for the buyer…"
                    value={paymentInstructions}
                    onChange={(e) => setPaymentInstructions(e.target.value)}
                  />
                </div>
              </div>

              {/* Pinned footer — always visible */}
              <div className="flex-shrink-0 px-6 pb-6 pt-4 border-t border-white/[0.06] space-y-3">
                {error && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle size={12} />{error}
                  </p>
                )}
                <button onClick={handleCreateOffer} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  Create Offer
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Share Offer — wizard endpoint ──
              The buyer takes the offer on their side; an agreement is
              auto-created and appears on the Agreements page. The seller
              has nothing else to do in this wizard — proof submission and
              release happen on the Agreements page where each agreement
              card already has Submit Proof, Release, and Refund actions. */}
          {step === 2 && offerResult && (
            <motion.div key="s2-share" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Share Your Offer</h2>
                <p className="text-white/40 text-sm mt-1">Send the offer ID or file to your buyer</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 space-y-2">
                <div className="text-xs text-white/35">Offer ID</div>
                <div className="font-mono text-sm text-white break-all">{offerResult.id}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleCopyOfferId} className="btn-secondary flex items-center justify-center gap-2">
                  <Copy size={14} />Copy ID
                </button>
                <button onClick={handleExportOffer} className="btn-secondary flex items-center justify-center gap-2">
                  <Upload size={14} />Export File
                </button>
              </div>

              {/* Wait-for-buyer note + green check accent. Replaces the old
                  "Buyer Has Taken the Offer →" button which was forcing the
                  seller to manually paste an agreement ID; the agreement
                  flows in automatically via the local store. */}
              <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.20)' }}>
                <CheckCircle2 size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-white/65 leading-relaxed">
                  Share the offer ID with your buyer. When they take the offer, an agreement is created automatically. Check your <span className="font-semibold text-white/85">Agreements</span> page for the new agreement — proof submission and release happen there.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => navigate('/settlement')} className="btn-secondary w-full">
                  Done
                </button>
                <button onClick={() => navigate('/agreements')} className="btn-primary w-full">
                  View My Agreements →
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
