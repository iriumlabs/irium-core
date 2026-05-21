import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
// happen there, not in this wizard. Step labels drive only the dots-progress
// UI (loop index, not rendered), so the array stays English.
const STEPS = ['Choose Type', 'Create Offer', 'Share Offer'];
// Payment-method autocomplete suggestions. These are free-text suggestions
// that get sent verbatim as the offer's payment_method field, so they stay
// English — they're a hint, not a constrained vocabulary.
const PAYMENT_SUGGESTIONS = ['bank transfer', 'cash', 'crypto', 'PayPal', 'wire transfer', 'other'];

// Settlement type the seller is initiating. The offer-create binary command
// has no typed-template field, so the chosen label gets prefixed onto the
// offer description so buyers see what kind of trade this is.
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

export default function SellerWizard() {
  const { t } = useTranslation();
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
    if (mins < 60) return t('wizards.seller.est_time_min', { minutes: mins });
    const hrs = (mins / 60).toFixed(1);
    return t('wizards.seller.est_time_hr', { hours: hrs });
  };

  const handleCreateOffer = async () => {
    if (!amountIrm || isNaN(parseFloat(amountIrm)) || parseFloat(amountIrm) <= 0) {
      setError(t('wizards.seller.errors.valid_amount'));
      return;
    }
    if (!paymentMethod.trim()) {
      setError(t('wizards.seller.errors.payment_required'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Prefix the chosen template label into description so buyers see what
      // kind of settlement this is — the offer-create binary command has no
      // typed template field of its own. Use the localized template name from
      // the selected template's nameKey so the visible label matches the UI.
      const tmpl = TEMPLATES.find((tpl) => tpl.id === template);
      const tmplLabel = tmpl ? t(tmpl.nameKey) : undefined;
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
        // FIX 3: pass the template choice as a structural field, not just
        // a description prefix. The wallet sidecar persists it in the
        // offer JSON and the buyer's offer-take dispatches to the right
        // agreement builder.
        template_type: template ?? undefined,
        // For non-milestone templates the milestone_count is ignored by
        // the sidecar; we send 1 only for "milestone" so the offer JSON
        // round-trips with a meaningful count.
        milestone_count: template === 'milestone' ? 1 : undefined,
      };
      const res = await offers.create(params);
      if (!res) throw new Error(t('wizards.seller.errors.no_response'));
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
      toast.success(t('wizards.seller.offer_exported'));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleCopyOfferId = () => {
    if (!offerResult?.id) return;
    navigator.clipboard.writeText(offerResult.id);
    toast.success(t('wizards.seller.offer_id_copied'));
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
            {step === 0 ? t('wizards.buyer.settlement_hub') : t('common.back')}
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
                <h2 className="font-display font-bold text-xl text-white">{t('wizards.seller.step_choose')}</h2>
                <p className="text-white/40 text-sm mt-1">
                  {t('wizards.seller.step_choose_subtitle')}
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
                        selected ? 'ring-2 ring-irium-500/60 bg-irium-500/[0.04]' : ''
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
                  ? t('wizards.common.continue_with', { name: t(TEMPLATES.find((tpl) => tpl.id === template)!.nameKey) })
                  : t('wizards.common.select_template_continue')}
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
                  <h2 className="font-display font-bold text-xl text-white">{t('wizards.seller.create_your_offer')}</h2>
                  <p className="text-white/40 text-sm mt-1">{t('wizards.seller.intro')}</p>
                </div>

                {/* Seller Address */}
                <div className="space-y-1">
                  <label className="label">{t('wizards.seller.fields.seller_address_label')}</label>
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
                          {t('wizards.seller.fields.no_wallet_addresses')}
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
                  <p className="text-xs text-white/25">{t('wizards.seller.fields.seller_address_hint')}</p>
                </div>

                {/* Amount — matches the Settlement.tsx OTC wizard treatment
                    (numeric input + sats preview) so the field is clearly
                    visible and the user sees the on-chain value as they type. */}
                <div className="space-y-1">
                  <label className="label">{t('wizards.seller.fields.amount_label')}</label>
                  <input
                    className={`input ${error && !amountIrm ? 'border-red-500/50' : ''}`}
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder={t('wizards.seller.fields.amount_placeholder')}
                    value={amountIrm}
                    onChange={(e) => { setAmountIrm(e.target.value); setError(''); }}
                  />
                  {amountIrm && parseFloat(amountIrm) > 0 && (
                    <p className="text-xs text-white/30 font-mono">
                      {t('wizards.seller.fields.sats_preview', { sats: Math.round(parseFloat(amountIrm) * SATS_PER_IRM).toLocaleString('en-US') })}
                    </p>
                  )}
                </div>

                {/* Payment Method */}
                <div className="space-y-1">
                  <label className="label">{t('wizards.seller.fields.payment_method_label')}</label>
                  <input
                    list="payment-suggestions"
                    className={`input ${error && !paymentMethod ? 'border-red-500/50' : ''}`}
                    placeholder={t('wizards.seller.fields.payment_method_placeholder')}
                    value={paymentMethod}
                    onChange={(e) => { setPaymentMethod(e.target.value); setError(''); }}
                  />
                  <datalist id="payment-suggestions">
                    {PAYMENT_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>

                {/* Timeout in blocks */}
                <div className="space-y-1">
                  <label className="label">{t('wizards.seller.fields.timeout_label')} <span className="text-white/25">{t('wizards.seller.fields.timeout_unit')}</span></label>
                  <div className="flex items-center gap-3">
                    <input
                      className="input flex-1"
                      type="number"
                      min="1"
                      placeholder={t('wizards.seller.fields.timeout_placeholder')}
                      value={timeoutBlocks}
                      onChange={(e) => setTimeoutBlocks(e.target.value)}
                    />
                    {timeoutBlocks && (
                      <span className="text-xs text-white/35 flex-shrink-0">{estTime(timeoutBlocks)}</span>
                    )}
                  </div>
                  <p className="text-xs text-white/25">{t('wizards.seller.fields.expires_hint')}</p>
                </div>

                {/* Price Note */}
                <div className="space-y-1">
                  <label className="label">{t('wizards.seller.fields.price_note_label')} <span className="text-white/25">{t('wizards.seller.fields.price_note_optional')}</span></label>
                  <input
                    className="input"
                    placeholder={t('wizards.seller.fields.price_note_placeholder')}
                    value={priceNote}
                    onChange={(e) => setPriceNote(e.target.value)}
                  />
                </div>

                {/* Payment Instructions */}
                <div className="space-y-1">
                  <label className="label">{t('wizards.seller.fields.payment_instructions_label')} <span className="text-white/25">{t('wizards.seller.fields.payment_instructions_optional')}</span></label>
                  <textarea
                    className="input resize-none"
                    rows={3}
                    placeholder={t('wizards.seller.fields.payment_instructions_placeholder')}
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
                  {t('wizards.seller.create_offer_button')}
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
                <h2 className="font-display font-bold text-xl text-white">{t('wizards.seller.share_your_offer')}</h2>
                <p className="text-white/40 text-sm mt-1">{t('wizards.seller.share_intro')}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 space-y-2">
                <div className="text-xs text-white/35">{t('wizards.seller.offer_id_heading')}</div>
                <div className="font-mono text-sm text-white break-all">{offerResult.id}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleCopyOfferId} className="btn-secondary flex items-center justify-center gap-2">
                  <Copy size={14} />{t('wizards.seller.copy_id')}
                </button>
                <button onClick={handleExportOffer} className="btn-secondary flex items-center justify-center gap-2">
                  <Upload size={14} />{t('wizards.seller.export_file')}
                </button>
              </div>

              {/* Wait-for-buyer note + green check accent. Replaces the old
                  "Buyer Has Taken the Offer →" button which was forcing the
                  seller to manually paste an agreement ID; the agreement
                  flows in automatically via the local store. The localized
                  copy contains a single literal "<strong>...</strong>" segment
                  for the "Agreements" emphasis; split into trans + segment
                  pattern in the JSX so no HTML is injected. */}
              <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.20)' }}>
                <CheckCircle2 size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-white/65 leading-relaxed">
                  {t('wizards.seller.share_buyer_note_before')}
                  <span className="font-semibold text-white/85">{t('wizards.seller.share_buyer_note_emphasis')}</span>
                  {t('wizards.seller.share_buyer_note_after')}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => navigate('/settlement')} className="btn-secondary w-full">
                  {t('wizards.seller.done')}
                </button>
                <button onClick={() => navigate('/agreements')} className="btn-primary w-full">
                  {t('wizards.seller.view_my_agreements')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
