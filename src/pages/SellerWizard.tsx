import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Copy, Loader2, AlertCircle,
  Upload, Download, Package, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { open as openDialog, save as saveDialog } from '@tauri-apps/api/dialog';
import { offers, agreements as agreementsApi, proofs, wallet } from '../lib/tauri';
import type { CreateOfferParams, CreateOfferResult, AddressInfo } from '../lib/types';
import { SATS_PER_IRM } from '../lib/types';

const STEPS = ['Create Offer', 'Share Offer', 'Receive Agreement', 'Submit Proof & Release'];
const PAYMENT_SUGGESTIONS = ['bank transfer', 'cash', 'crypto', 'PayPal', 'wire transfer', 'other'];

export default function SellerWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Wallet addresses
  const [addresses, setAddresses] = useState<AddressInfo[]>([]);
  const [sellerAddr, setSellerAddr] = useState('');

  // Step 0 form state
  const [amountIrm, setAmountIrm] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [timeoutBlocks, setTimeoutBlocks] = useState('1000');
  const [priceNote, setPriceNote] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [offerResult, setOfferResult] = useState<CreateOfferResult | null>(null);

  // Step 2 state
  const [agreementId, setAgreementId] = useState('');

  // Step 3 state
  const [proofFile, setProofFile] = useState('');
  const [releaseResult, setReleaseResult] = useState<{ txid?: string; success: boolean } | null>(null);

  useEffect(() => {
    wallet.listAddresses().then((list) => {
      if (list && list.length > 0) {
        setAddresses(list);
        setSellerAddr(list[0].address);
      }
    }).catch(() => {});
  }, []);

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
      const params: CreateOfferParams = {
        amount_sats: Math.round(parseFloat(amountIrm) * SATS_PER_IRM),
        payment_method: paymentMethod.trim(),
        payment_instructions: paymentInstructions.trim() || undefined,
        timeout_blocks: parseInt(timeoutBlocks) || 1000,
        description: priceNote.trim() || undefined,
      };
      const res = await offers.create(params);
      if (!res) throw new Error('No response from node');
      setOfferResult(res);
      setStep(1);
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

  const handleImportAgreement = async () => {
    if (!agreementId.trim()) {
      setError('Enter the agreement ID from your buyer');
      return;
    }
    setError('');
    setStep(3);
  };

  const handlePickProof = async () => {
    try {
      const selected = await openDialog({
        title: 'Select Proof File',
        filters: [{ name: 'All Files', extensions: ['*'] }],
      });
      if (selected && typeof selected === 'string') setProofFile(selected);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleSubmitAndRelease = async () => {
    if (!agreementId.trim()) { setError('Agreement ID required'); return; }
    if (!proofFile) { setError('Select a proof file'); return; }
    setError('');
    setLoading(true);
    try {
      await proofs.submit(agreementId.trim(), proofFile);
      const res = await agreementsApi.release(agreementId.trim());
      setReleaseResult(res ?? { success: false });
      if (res?.success) toast.success('Payment released!');
      else toast.error(res?.message ?? 'Release failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
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
          {/* ── Step 0: Create Offer ── */}
          {step === 0 && (
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
                      {addresses.length === 0 && <option value="">No wallet addresses found</option>}
                      {addresses.map((a) => (
                        <option key={a.address} value={a.address}>{a.address}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                  <p className="text-xs text-white/25">Auto-detected from your wallet. Buyers will send payment here.</p>
                </div>

                {/* Amount */}
                <div className="space-y-1">
                  <label className="label">Amount (IRM)</label>
                  <input
                    className={`input ${error && !amountIrm ? 'border-red-500/50' : ''}`}
                    placeholder="0.00"
                    value={amountIrm}
                    onChange={(e) => { setAmountIrm(e.target.value); setError(''); }}
                  />
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

          {/* ── Step 1: Share Offer ── */}
          {step === 1 && offerResult && (
            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
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
                  <Download size={14} />Export File
                </button>
              </div>

              <p className="text-xs text-white/35 leading-relaxed">
                Share the offer ID or exported file with your buyer. Once they take the offer and create an agreement, they'll send you the agreement ID.
              </p>

              <button onClick={() => setStep(2)} className="btn-primary w-full">
                Buyer Has Taken the Offer →
              </button>
            </motion.div>
          )}

          {/* ── Step 2: Receive Agreement ── */}
          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Receive Agreement</h2>
                <p className="text-white/40 text-sm mt-1">Enter the agreement ID your buyer sent you</p>
              </div>

              <div className="space-y-1">
                <label className="label">Agreement ID</label>
                <input
                  className={`input ${error ? 'border-red-500/50' : ''}`}
                  placeholder="agr_..."
                  value={agreementId}
                  onChange={(e) => { setAgreementId(e.target.value); setError(''); }}
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />{error}
                </p>
              )}

              <p className="text-xs text-white/35 leading-relaxed">
                The agreement is funded by the buyer. Once you confirm their agreement ID, you can submit proof of delivery to release payment.
              </p>

              <button onClick={handleImportAgreement} className="btn-primary w-full">
                Confirm Agreement →
              </button>
            </motion.div>
          )}

          {/* ── Step 3: Submit Proof & Release ── */}
          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              {releaseResult?.success ? (
                <div className="text-center space-y-4 py-4">
                  <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={28} className="text-green-400" />
                  </div>
                  <h2 className="font-display font-bold text-xl text-white">Payment Released!</h2>
                  {releaseResult.txid && (
                    <p className="font-mono text-xs text-white/40 break-all">{releaseResult.txid}</p>
                  )}
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => navigate('/agreements')} className="btn-secondary">View Agreements</button>
                    <button onClick={() => navigate('/settlement')} className="btn-primary">Done</button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="font-display font-bold text-xl text-white">Submit Proof & Release</h2>
                    <p className="text-white/40 text-sm mt-1">Attach proof of delivery to release payment from escrow</p>
                  </div>

                  <div className="p-3 rounded-lg bg-white/5 text-xs font-mono text-white/50">
                    Agreement: {agreementId}
                  </div>

                  <div className="space-y-1">
                    <label className="label">Proof File</label>
                    <button
                      onClick={handlePickProof}
                      className="input w-full text-left flex items-center gap-2 text-white/50 hover:text-white/80"
                    >
                      <Upload size={14} />
                      {proofFile ? proofFile.split(/[\\/]/).pop() : 'Select proof file…'}
                    </button>
                  </div>

                  {error && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={12} />{error}
                    </p>
                  )}

                  <button onClick={handleSubmitAndRelease} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                    {loading ? <Loader2 size={15} className="animate-spin" /> : <Package size={15} />}
                    Submit Proof & Release Payment
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
