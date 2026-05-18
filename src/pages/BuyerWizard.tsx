import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Loader2, AlertCircle,
  RefreshCw, Upload, Star, ArrowRight,
  ArrowLeftRight, Briefcase, Target, Landmark,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { offers, feeds, agreements as agreementsApi, agreementSpend } from '../lib/tauri';
import type { Offer, AgreementStatusResult } from '../lib/types';
import { formatIRM } from '../lib/types';

// Step 0 = Choose Type, then the regular find/take/fund/monitor flow. Mirrors
// the four-card template grid in Settlement.tsx and SellerWizard.tsx so all
// three entry paths share the same visual template selection.
// Step labels are only used in the dots-progress UI (loop index, label not
// rendered), so the array stays English — translating it has no UI effect.
const STEPS = ['Choose Type', 'Find Offer', 'Take Offer', 'Fund & Pay', 'Monitor & Complete'];

// Settlement type the buyer is looking for. The offer-create binary command
// has no typed-template field, so this is a UX signal only — the find-offer
// step still shows all offers; the chosen template is surfaced for context.
type TemplateId = 'otc' | 'freelance' | 'milestone' | 'deposit';

// Template metadata. nameKey/descKey resolve through t() in the render so the
// card title/description follow the active locale.
const TEMPLATES: ReadonlyArray<{
  id: TemplateId;
  nameKey: string;
  descKey: string;
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  glowBg: string;
}> = [
  { id: 'otc',       nameKey: 'wizards.templates.otc_name',       descKey: 'wizards.templates.otc_desc',       Icon: ArrowLeftRight, iconBg: 'bg-irium-500/20', iconColor: 'text-irium-400', glowBg: 'bg-irium-500' },
  { id: 'freelance', nameKey: 'wizards.templates.freelance_name', descKey: 'wizards.templates.freelance_desc', Icon: Briefcase,      iconBg: 'bg-blue-500/20',  iconColor: 'text-blue-400',  glowBg: 'bg-blue-500'  },
  { id: 'milestone', nameKey: 'wizards.templates.milestone_name', descKey: 'wizards.templates.milestone_desc', Icon: Target,         iconBg: 'bg-green-500/20', iconColor: 'text-green-400', glowBg: 'bg-green-500' },
  { id: 'deposit',   nameKey: 'wizards.templates.deposit_name',   descKey: 'wizards.templates.deposit_desc',   Icon: Landmark,       iconBg: 'bg-amber-500/20', iconColor: 'text-amber-400', glowBg: 'bg-amber-500' },
];

export default function BuyerWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 0 (Choose Type) state. Null until the user clicks a template card.
  const [template, setTemplate] = useState<TemplateId | null>(null);

  // Step 1 — browse / id / file
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
      toast.success(t('wizards.buyer.offers_loaded', { count: list?.length ?? 0 }));
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
      toast.success(t('wizards.buyer.offer_imported'));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const activeOffer = selectedOffer;

  const handleNext = async () => {
    setError('');

    // Path 1: card selected from marketplace
    if (selectedOffer) {
      setFoundOffer(selectedOffer);
      setStep(2);
      return;
    }

    // Path 2: offer ID typed manually
    if (offerIdInput.trim()) {
      setLoading(true);
      try {
        const o = await offers.show(offerIdInput.trim());
        if (!o) throw new Error(t('wizards.buyer.offer_not_found'));
        setFoundOffer(o);
        setStep(2);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Path 3: file was imported, selectedOffer might be set already by handleImportOffer
    setError(t('wizards.buyer.select_or_enter_id'));
  };

  const handleTakeOffer = async () => {
    if (!foundOffer?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await offers.take(foundOffer.id);
      if (!res?.success) throw new Error(res?.message ?? t('wizards.buyer.take_offer_failed'));
      setAgreementId(res.agreement_id);
      setStep(3);
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
      if (!res?.success) throw new Error(res?.message ?? t('wizards.buyer.funding_failed'));
      toast.success(t('wizards.buyer.escrow_funded'));
      setStep(4);
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
      if (res?.success) toast.success(t('wizards.buyer.payment_released'));
      else toast.error(res?.message ?? t('wizards.buyer.release_failed'));
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
      if (res?.success) toast.success(t('wizards.buyer.refunded'));
      else toast.error(res?.message ?? t('wizards.buyer.refund_failed'));
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
            {step === 0 ? t('wizards.buyer.settlement_hub') : t('common.back')}
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
          {/* ── Step 0: Choose Type ── four-card template grid mirroring
              the Settlement Hub's "Create Agreement Directly" path and the
              Seller Wizard's first step. The selected template is shown as
              a chip in the next step so the buyer keeps context. */}
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
                <h2 className="font-display font-bold text-xl text-white">{t('wizards.buyer.step_choose')}</h2>
                <p className="text-white/40 text-sm mt-1">
                  {t('wizards.buyer.step_choose_subtitle')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {TEMPLATES.map((tpl) => {
                  const selected = template === tpl.id;
                  return (
                    <motion.button
                      key={tpl.id}
                      type="button"
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setTemplate(tpl.id)}
                      className={`card-interactive p-6 text-left flex flex-col gap-3 relative overflow-hidden transition-colors ${
                        selected ? 'ring-2 ring-blue-500/60 bg-blue-500/[0.04]' : ''
                      }`}
                    >
                      <div className={`absolute top-4 right-4 w-20 h-20 rounded-full blur-2xl opacity-25 ${tpl.glowBg}`} />
                      <div className={`p-3 rounded-xl w-fit ${tpl.iconBg}`}>
                        <tpl.Icon size={20} className={tpl.iconColor} />
                      </div>
                      <div>
                        <div className="font-display font-bold text-lg text-white">{t(tpl.nameKey)}</div>
                        <div className="text-white/45 text-sm mt-1">{t(tpl.descKey)}</div>
                      </div>
                      {selected && (
                        <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
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
                  ? t('wizards.common.continue_with', { name: t(TEMPLATES.find((tpl) => tpl.id === template)!.nameKey) })
                  : t('wizards.common.select_template_continue')}
              </button>
            </motion.div>
          )}

          {/* ── Step 1: Find Offer ── */}
          {step === 1 && (
            <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-4">

              {/* Marketplace section */}
              <div className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display font-bold text-xl text-white">{t('wizards.buyer.browse_marketplace')}</h2>
                    <p className="text-white/40 text-sm mt-0.5">{t('wizards.buyer.find_offer_hint')}</p>
                  </div>
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? t('wizards.buyer.syncing') : t('wizards.buyer.sync_marketplace')}
                  </button>
                </div>

                {/* Offer cards */}
                {marketLoaded && marketOffers.length === 0 && (
                  <div className="text-center py-6 text-white/25 text-sm">
                    {t('wizards.buyer.no_offers_found')}
                  </div>
                )}

                {!marketLoaded && !syncing && (
                  <div className="text-center py-6 text-white/20 text-sm">
                    {t('wizards.buyer.sync_to_browse')}
                  </div>
                )}

                {syncing && (
                  <div className="flex items-center justify-center gap-2 py-6 text-white/30 text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    {t('wizards.buyer.fetching_offers')}
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
                              {offer.seller ? offer.seller.slice(0, 20) + '…' : t('wizards.buyer.unknown_seller')}
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
                <p className="text-xs text-white/35 font-semibold uppercase tracking-wider">{t('wizards.buyer.or_use_specific')}</p>

                <div className="space-y-1">
                  <label className="label">{t('wizards.buyer.offer_id_label')}</label>
                  <input
                    className="input"
                    placeholder={t('wizards.buyer.offer_id_placeholder')}
                    value={offerIdInput}
                    onChange={(e) => { setOfferIdInput(e.target.value); setSelectedOffer(null); setError(''); }}
                  />
                </div>

                <button onClick={handleImportOffer} className="btn-secondary w-full flex items-center justify-center gap-2">
                  <Upload size={14} />
                  {offerFile ? offerFile.split(/[\\/]/).pop() : t('wizards.buyer.import_offer_file')}
                </button>
              </div>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />{error}
                </p>
              )}

              {selectedOffer && (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                  {t('wizards.buyer.selected_offer', { id: selectedOffer.id, amount: formatIRM(selectedOffer.amount) })}
                </div>
              )}

              <button
                onClick={handleNext}
                disabled={loading || !canProceed}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                {t('common.next')}
              </button>
            </motion.div>
          )}

          {/* ── Step 2: Review & Take Offer ── */}
          {step === 2 && foundOffer && (
            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">{t('wizards.buyer.review_offer_title')}</h2>
                <p className="text-white/40 text-sm mt-1">{t('wizards.buyer.review_intro')}</p>
              </div>

              <div className="space-y-2">
                {[
                  { label: t('wizards.buyer.review_rows.offer_id'),       value: foundOffer.id },
                  { label: t('wizards.buyer.review_rows.amount'),         value: `${formatIRM(foundOffer.amount ?? 0)} IRM`, highlight: true },
                  { label: t('wizards.buyer.review_rows.seller'),         value: foundOffer.seller ?? '—' },
                  { label: t('wizards.buyer.review_rows.payment_method'), value: foundOffer.payment_method ?? '—' },
                  { label: t('wizards.buyer.review_rows.description'),    value: foundOffer.description ?? '—' },
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
                {t('wizards.buyer.take_this_offer')}
              </button>
            </motion.div>
          )}

          {/* ── Step 3: Fund ── */}
          {step === 3 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">{t('wizards.buyer.fund_title')}</h2>
                <p className="text-white/40 text-sm mt-1">{t('wizards.buyer.lock_payment_hint')}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 space-y-3">
                <div>
                  <div className="text-xs text-white/35 mb-1">{t('wizards.buyer.agreement_id_label')}</div>
                  <div className="font-mono text-sm text-white break-all">{agreementId}</div>
                </div>
                {foundOffer && (
                  <div>
                    <div className="text-xs text-white/35 mb-1">{t('wizards.buyer.amount_to_lock')}</div>
                    <div className="text-lg font-semibold text-irium-300">{formatIRM(foundOffer.amount ?? 0)} IRM</div>
                  </div>
                )}
              </div>

              <p className="text-xs text-white/35 leading-relaxed">
                {t('wizards.buyer.funds_locked_note')}
              </p>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} />{error}
                </p>
              )}

              <button onClick={handleFund} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                {t('wizards.buyer.fund_escrow')}
              </button>
            </motion.div>
          )}

          {/* ── Step 4: Monitor & Complete ── */}
          {step === 4 && (
            <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="card p-6 space-y-5">
              {releaseResult?.success ? (
                <div className="text-center space-y-4 py-4">
                  <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={28} className="text-green-400" />
                  </div>
                  <h2 className="font-display font-bold text-xl text-white">
                    {releaseResult.txid ? t('wizards.buyer.payment_released_heading') : t('wizards.buyer.refunded_heading')}
                  </h2>
                  {releaseResult.txid && (
                    <p className="font-mono text-xs text-white/40 break-all">{releaseResult.txid}</p>
                  )}
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => navigate('/agreements')} className="btn-secondary">{t('wizards.buyer.view_agreements')}</button>
                    <button onClick={() => navigate('/settlement')} className="btn-primary">{t('wizards.buyer.done')}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-display font-bold text-xl text-white">{t('wizards.buyer.monitor_title')}</h2>
                      <p className="text-white/40 text-sm mt-1">{t('wizards.buyer.waiting_for_seller')}</p>
                    </div>
                    {polling && <RefreshCw size={14} className="animate-spin text-white/30" />}
                  </div>

                  <div className="p-3 rounded-lg bg-white/5 text-xs font-mono text-white/50 break-all">
                    {agreementId}
                  </div>

                  {agreementStatus && (
                    <div className="space-y-2">
                      {[
                        { label: t('wizards.buyer.status_rows.status'),           value: agreementStatus.status },
                        { label: t('wizards.buyer.status_rows.funded'),           value: agreementStatus.funded ? t('common.yes') : t('common.no') },
                        { label: t('wizards.buyer.status_rows.release_eligible'), value: agreementStatus.release_eligible ? t('common.yes') : t('common.no') },
                        { label: t('wizards.buyer.status_rows.refund_eligible'),  value: agreementStatus.refund_eligible ? t('common.yes') : t('common.no') },
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
                      {t('wizards.buyer.refund')}
                    </button>
                    <button onClick={handleRelease} disabled={loading || !agreementStatus?.release_eligible} className="btn-primary flex items-center justify-center gap-2">
                      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                      {t('wizards.buyer.release_payment')}
                    </button>
                  </div>

                  <p className="text-xs text-white/25 text-center">
                    {t('wizards.buyer.polling_indicator', { state: agreementStatus ? t('wizards.buyer.polling_updated') : t('wizards.buyer.polling_waiting') })}
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
