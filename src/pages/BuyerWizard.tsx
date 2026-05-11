import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Loader2, AlertCircle,
  RefreshCw, Upload, Star, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { offers, feeds, agreements as agreementsApi, agreementSpend } from '../lib/tauri';
import type { Offer, AgreementStatusResult } from '../lib/types';
import { formatIRM } from '../lib/types';

const STEPS = ['Find Offer', 'Take Offer', 'Fund & Pay', 'Monitor & Complete'];

export default function BuyerWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 0 — browse / id / file
  const [syncing, setSyncing] = useState(false);
  const [marketOffers, setMarketOffers] = useState<Offer[]>([]);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [offerIdInput, setOfferIdInput] = useState('');
  const [offerFile, setOfferFile] = useState('');
  const [foundOffer, setFoundOffer] = useState<Offer | null>(null);

  // Step 1 state
  const [agreementId, setAgreementId] = useState('');

  // Step 3 state
  const [agreementStatus, setAgreementStatus] = useState<AgreementStatusResult | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [releaseResult, setReleaseResult] = useState<{ txid?: string; success: boolean } | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Load local offers on mount
  useEffect(() => {
    offers.list({ source: 'local', sort: 'score' }).then((list) => {
      if (list && list.length > 0) {
        setMarketOffers(list);
        setMarketLoaded(true);
      }
    }).catch(() => {});
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await feeds.sync();
      const list = await offers.list({ source: 'all', sort: 'score' });
      setMarketOffers(list ?? []);
      setMarketLoaded(true);
      toast.success(`${list?.length ?? 0} offers loaded`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const handleImportOffer = async () => {
    try {
      const selected = await openDialog({
        title: 'Select Offer File',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      setOfferFile(selected);
      await offers.import(selected);
      const list = await offers.list({ source: 'local', sort: 'newest' });
      const o = list && list.length > 0 ? list[list.length - 1] : null;
      if (o) { setSelectedOffer(o); setOfferIdInput(''); }
      toast.success('Offer imported');
    } catch (e) {
      toast.error(String(e));
    }
  };

  const activeOffer = selectedOffer ?? (offerIdInput.trim() ? null : null);

  const handleNext = async () => {
    setError('');

    // Path 1: card selected from marketplace
    if (selectedOffer) {
      setFoundOffer(selectedOffer);
      setStep(1);
      return;
    }

    // Path 2: offer ID typed manually
    if (offerIdInput.trim()) {
      setLoading(true);
      try {
        const o = await offers.show(offerIdInput.trim());
        if (!o) throw new Error('Offer not found');
        setFoundOffer(o);
        setStep(1);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Path 3: file was imported, selectedOffer might be set already by handleImportOffer
    setError('Select an offer from the marketplace, enter an offer ID, or import an offer file');
  };

  const handleTakeOffer = async () => {
    if (!foundOffer?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await offers.take(foundOffer.id);
      if (!res?.success) throw new Error(res?.message ?? 'Failed to take offer');
      setAgreementId(res.agreement_id);
      setStep(2);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFund = async () => {
    if (!agreementId) return;
    setLoading(true);
    setError('');
    try {
      const res = await agreementSpend.fund(agreementId);
      if (!res?.success) throw new Error(res?.message ?? 'Funding failed');
      toast.success('Escrow funded');
      setStep(3);
      startPolling();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const startPolling = () => {
    setPolling(true);
    const poll = async () => {
      try {
        const s = await agreementSpend.status(agreementId);
        if (s) setAgreementStatus(s);
      } catch { /* offline */ }
    };
    poll();
    pollRef.current = setInterval(poll, 5000);
  };

  const handleRelease = async () => {
    if (!agreementId) return;
    setLoading(true);
    setError('');
    try {
      const res = await agreementsApi.release(agreementId);
      if (pollRef.current) { clearInterval(pollRef.current); setPolling(false); }
      setReleaseResult(res ?? { success: false });
      if (res?.success) toast.success('Payment released to seller!');
      else toast.error(res?.message ?? 'Release failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async () => {
    if (!agreementId) return;
    setLoading(true);
    setError('');
    try {
      const res = await agreementsApi.refund(agreementId);
      if (pollRef.current) { clearInterval(pollRef.current); setPolling(false); }
      setReleaseResult(res ?? { success: false });
      if (res?.success) toast.success('Refunded to your wallet');
      else toast.error(res?.message ?? 'Refund failed');
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

  const canProceed = !!selectedOffer || !!offerIdInput.trim() || !!offerFile;

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
                  ${i < step ? 'bg-blue-500 text-white' : i === step ? 'bg-blue-500/80 text-white ring-2 ring-blue-400/40' : 'bg-white/10 text-white/25'}`}>
                  {i < step ? <CheckCircle2 size={12} /> : i + 1}
                </span>
                {i < STEPS.length - 1 && (
                  <span className={`w-6 h-0.5 ${i < step ? 'bg-blue-500' : 'bg-white/10'}`} />
                )}
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step 0: Find Offer ── */}
          {step === 0 && (
            <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-4">

              {/* Marketplace section */}
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display font-bold text-xl text-white">Browse Marketplace</h2>
                    <p className="text-white/40 text-sm mt-0.5">Find an offer from the network</p>
                  </div>
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? 'Syncing…' : 'Sync Marketplace'}
                  </button>
                </div>

                {/* Offer cards */}
                {marketLoaded && marketOffers.length === 0 && (
                  <div className="text-center py-6 text-white/25 text-sm">
                    No offers found. Try syncing the marketplace.
                  </div>
                )}

                {!marketLoaded && !syncing && (
                  <div className="text-center py-6 text-white/20 text-sm">
                    Sync the marketplace to browse available offers
                  </div>
                )}

                {syncing && (
                  <div className="flex items-center justify-center gap-2 py-6 text-white/30 text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Fetching offers from feeds…
                  </div>
                )}

                {marketOffers.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {marketOffers.map((offer) => (
                      <button
                        key={offer.id}
                        onClick={() => { setSelectedOffer(offer); setOfferIdInput(''); setError(''); }}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${
                          selectedOffer?.id === offer.id
                            ? 'border-blue-500/60 bg-blue-500/10'
                            : 'border-white/5 hover:border-white/15 hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{formatIRM(offer.amount)} IRM</span>
                              {offer.payment_method && (
                                <span className="text-xs text-white/40 truncate">{offer.payment_method}</span>
                              )}
                            </div>
                            <div className="text-xs text-white/30 font-mono truncate mt-0.5">
                              {offer.seller ? offer.seller.slice(0, 20) + '…' : 'Unknown seller'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {offer.reputation?.score != null && (
                              <div className="flex items-center gap-1 text-xs text-amber-400">
                                <Star size={11} fill="currentColor" />
                                {offer.reputation.score.toFixed(1)}
                              </div>
                            )}
                            {selectedOffer?.id === offer.id && (
                              <CheckCircle2 size={14} className="text-blue-400" />
                            )}
                          </div>
                        </div>
                        {offer.description && (
                          <div className="text-xs text-white/30 mt-1 truncate">{offer.description}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Alternative paths */}
              <div className="card p-5 space-y-4">
                <p className="text-xs text-white/35 font-semibold uppercase tracking-wider">Or use a specific offer</p>

                <div className="space-y-1">
                  <label className="label">Offer ID</label>
                  <input
                    className="input"
                    placeholder="offer_..."
                    value={offerIdInput}
                    onChange={(e) => { setOfferIdInput(e.target.value); setSelectedOffer(null); setError(''); }}
                  />
                </div>

                <button onClick={handleImportOffer} className="btn-secondary w-full flex items-center justify-center gap-2">
                  <Upload size={14} />
                  {offerFile ? offerFile.split(/[\\/]/).pop() : 'Import Offer File'}
                </button>
              </div>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />{error}
                </p>
              )}

              {selectedOffer && (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                  Selected: <span className="font-mono">{selectedOffer.id}</span> · {formatIRM(selectedOffer.amount)} IRM
                </div>
              )}

              <button
                onClick={handleNext}
                disabled={loading || !canProceed}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                Next
              </button>
            </motion.div>
          )}

          {/* ── Step 1: Review & Take Offer ── */}
          {step === 1 && foundOffer && (
            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Review Offer</h2>
                <p className="text-white/40 text-sm mt-1">Confirm the details before taking the offer</p>
              </div>

              <div className="space-y-2">
                {[
                  { label: 'Offer ID',       value: foundOffer.id },
                  { label: 'Amount',         value: `${formatIRM(foundOffer.amount ?? 0)} IRM`, highlight: true },
                  { label: 'Seller',         value: foundOffer.seller ?? '—' },
                  { label: 'Payment Method', value: foundOffer.payment_method ?? '—' },
                  { label: 'Description',    value: foundOffer.description ?? '—' },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="flex items-start justify-between py-2 border-b border-white/5 last:border-0 gap-4">
                    <span className="text-sm text-white/45 flex-shrink-0">{label}</span>
                    <span className={`text-sm font-mono ${highlight ? 'text-irium-300 font-semibold' : 'text-white/70'} text-right break-all`}>{value}</span>
                  </div>
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />{error}
                </p>
              )}

              <button onClick={handleTakeOffer} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                Take This Offer
              </button>
            </motion.div>
          )}

          {/* ── Step 2: Fund ── */}
          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Fund Escrow</h2>
                <p className="text-white/40 text-sm mt-1">Lock your payment in the escrow contract</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 space-y-3">
                <div>
                  <div className="text-xs text-white/35 mb-1">Agreement ID</div>
                  <div className="font-mono text-sm text-white break-all">{agreementId}</div>
                </div>
                {foundOffer && (
                  <div>
                    <div className="text-xs text-white/35 mb-1">Amount to Lock</div>
                    <div className="text-lg font-semibold text-irium-300">{formatIRM(foundOffer.amount ?? 0)} IRM</div>
                  </div>
                )}
              </div>

              <p className="text-xs text-white/35 leading-relaxed">
                Funds will be locked in a smart escrow. The seller receives payment only after submitting proof of delivery.
              </p>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />{error}
                </p>
              )}

              <button onClick={handleFund} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                Fund Escrow
              </button>
            </motion.div>
          )}

          {/* ── Step 3: Monitor & Complete ── */}
          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              {releaseResult?.success ? (
                <div className="text-center space-y-4 py-4">
                  <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={28} className="text-green-400" />
                  </div>
                  <h2 className="font-display font-bold text-xl text-white">
                    {releaseResult.txid ? 'Payment Released' : 'Refunded'}
                  </h2>
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
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-display font-bold text-xl text-white">Monitor Agreement</h2>
                      <p className="text-white/40 text-sm mt-1">Waiting for seller to deliver and submit proof</p>
                    </div>
                    {polling && <RefreshCw size={14} className="animate-spin text-white/30" />}
                  </div>

                  <div className="p-3 rounded-lg bg-white/5 text-xs font-mono text-white/50 break-all">
                    {agreementId}
                  </div>

                  {agreementStatus && (
                    <div className="space-y-2">
                      {[
                        { label: 'Status',           value: agreementStatus.status },
                        { label: 'Funded',           value: agreementStatus.funded ? 'Yes' : 'No' },
                        { label: 'Release Eligible', value: agreementStatus.release_eligible ? 'Yes' : 'No' },
                        { label: 'Refund Eligible',  value: agreementStatus.refund_eligible ? 'Yes' : 'No' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between text-sm py-1.5 border-b border-white/5 last:border-0">
                          <span className="text-white/40">{label}</span>
                          <span className="text-white/80">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {error && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle size={12} />{error}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={handleRefund} disabled={loading || !agreementStatus?.refund_eligible} className="btn-secondary flex items-center justify-center gap-2">
                      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                      Refund
                    </button>
                    <button onClick={handleRelease} disabled={loading || !agreementStatus?.release_eligible} className="btn-primary flex items-center justify-center gap-2">
                      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                      Release Payment
                    </button>
                  </div>

                  <p className="text-xs text-white/25 text-center">
                    Polling every 5s · {agreementStatus ? 'last updated just now' : 'waiting…'}
                  </p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
