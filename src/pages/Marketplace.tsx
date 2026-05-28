import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Search, Globe, X, Rss, Star, Download, Upload, Compass, HelpCircle, Trash2, AlertTriangle, Radio } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { offers, feeds, feedOps, wallet } from '../lib/tauri';
import { useIriumEvents } from '../lib/hooks';
import NodeOfflineBanner from '../components/NodeOfflineBanner';
import { formatIRM, timeAgo, truncateAddr, SATS_PER_IRM } from '../lib/types';
import type { Offer, FeedEntry } from '../lib/types';

// Map raw payment_method strings (which the seller types freely — e.g.
// "bank-transfer", "PAYPAL", "usdt_trc20") into title-cased plain English
// with known acronyms preserved. The offer's underlying string is kept
// verbatim in the backend; this is purely a presentation helper.
const PAYMENT_METHOD_ACRONYMS: Record<string, string> = {
  paypal: 'PayPal', usdt: 'USDT', usdc: 'USDC', btc: 'BTC', eth: 'ETH',
  sepa: 'SEPA', iban: 'IBAN', ach: 'ACH', trc20: 'TRC-20', erc20: 'ERC-20',
  ltc: 'LTC', bch: 'BCH', xmr: 'XMR',
};
function prettifyPaymentMethod(raw: string): string {
  if (!raw) return '';
  const lower = raw.trim().toLowerCase();
  if (PAYMENT_METHOD_ACRONYMS[lower]) return PAYMENT_METHOD_ACRONYMS[lower];
  return lower
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => PAYMENT_METHOD_ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Client-side "never show again" list for offers the user has Removed.
// Persisted in localStorage so removing an offer survives both a page
// reload and a feeds.sync() re-import from a remote feed. Without this,
// the 60-second Browse-tab auto-sync (and every Browse-tab entry) would
// silently re-download removed offers from any configured remote feed
// that still publishes them and the offer would reappear in the UI.
// Stored as a JSON array of string IDs.
const BLOCKED_OFFERS_KEY = 'irium-marketplace-blocked-offer-ids';

// ─── Animation variants ────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ─── Types ─────────────────────────────────────────────────────
type Tab = 'browse' | 'my-offers' | 'feeds';

// ─── File-picker helpers ────────────────────────────────────────
// Mirrors the same-named helpers in Agreements.tsx — kept local rather
// than extracted to a shared util so Phase 3 stays scoped to the three
// page files. A future refactor could lift these into src/lib/file-picker.ts.
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function openFilePicker(opts: { extensions: string[]; title: string }): Promise<string | null> {
  if (isTauri) {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const result = await open({
        multiple: false,
        title: opts.title,
        filters: [{ name: opts.extensions.map(e => `.${e}`).join(' / '), extensions: opts.extensions }],
      });
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function openSavePicker(opts: { defaultName: string; extensions: string[]; title: string }): Promise<string | null> {
  if (isTauri) {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const result = await save({
        title: opts.title,
        defaultPath: opts.defaultName,
        filters: [{ name: opts.extensions.map(e => `.${e}`).join(' / '), extensions: opts.extensions }],
      });
      return result ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

// ─── Offer Card ────────────────────────────────────────────────
// Visible fields (in order of visual weight):
//   1. Amount in IRM — large headline, gradient text
//   2. Payment method (prettified plain English)
//   3. asset_reference (what the seller wants in exchange) when present
//   4. Seller address (12 chars) + time-ago
//   5. Description if any, then optional reputation bar
// Raw offer.id moves into a <details> "Technical details" disclosure at
// the bottom — power-user info, not the headline.
//
// Delete affordance: a single trash icon shown on every card the
// backend will accept a removal for (status not 'taken'/'completed').
// Always routes through the confirm modal → handleDeleteOffer, so the
// click target is identical across fresh, stale, and expired offers.
// Non-own taken offers swap the Take Offer button for a grey Taken
// badge so a buyer can't try to take an offer that's already gone.
function OfferCard({
  offer,
  onTake,
  onOpenDetail,
  onExport,
  onDelete,
  isOwnOffer,
  isOnline,
}: {
  offer: Offer;
  onTake: () => void;
  onOpenDetail: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  isOwnOffer: boolean;
  isOnline: boolean;
}) {
  const navigate = useNavigate();
  const score = offer.reputation?.score ?? 0;
  const riskBadge =
    offer.risk_signal === 'low'
      ? 'badge-success'
      : offer.risk_signal === 'medium'
      ? 'badge-warning'
      : 'badge-error';

  const completedCount = offer.reputation?.completed ?? 0;
  const showRepBar = completedCount > 0 && offer.reputation?.score !== undefined;
  const showRankBadge = completedCount > 0 && offer.ranking_score !== undefined && offer.ranking_score > 0;

  const prettyMethod = prettifyPaymentMethod(offer.payment_method ?? '');
  const wantsLabel = (offer.asset_reference ?? '').trim();

  // Whether to expose the destructive "remove" affordance on this card.
  // Local-cache deletion works for ANY cached offer regardless of where
  // it originated: the backend (offer_remove in main.rs:4148) iterates
  // <data_dir>/offers/*.json by offer_id and deletes the matching file
  // — remote-feed-fetched offers are stored exactly the same way as
  // user-created ones. We only refuse 'taken' / 'completed', which the
  // backend also rejects (main.rs:4183).
  const canRemove =
    !!onDelete && offer.status !== 'taken' && offer.status !== 'completed';

  return (
    <motion.div
      variants={itemVariants}
      onClick={onOpenDetail}
      className="card-interactive flex items-start gap-4 px-4 py-3.5 cursor-pointer"
    >
      {/* Left: amount (large, prominent) + meta */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Top row: SELL badge + amount headline + risk/rank tags. Every
            offer in the current schema is a sell (the creator locks IRM
            and accepts off-chain payment), so the badge is hardcoded.
            Swap to a derived (offer as any).side when a BUY offer type
            is introduced. */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
            style={{
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.40)',
              color: '#22c55e',
              letterSpacing: '0.10em',
            }}
            title="Seller is offering IRM in exchange for off-chain payment"
          >
            SELL
          </span>
          <span
            className="font-display font-bold text-2xl tabular-nums"
            style={{
              background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '0.01em',
            }}
          >
            {formatIRM(offer.amount)}
          </span>
          {offer.risk_signal && (
            <span
              className={`badge ${riskBadge} text-[9px]`}
              title={
                offer.risk_signal === 'low'
                  ? 'Low risk — seller has a clean recent record.'
                  : offer.risk_signal === 'medium'
                  ? 'Medium risk — limited reputation history or warning signals.'
                  : 'High risk — sybil-suppressed, self-trading, or disputes ≥10%.'
              }
            >
              {offer.risk_signal}
            </span>
          )}
          {showRankBadge && (
            <span className="badge badge-irium text-[9px] flex items-center gap-0.5">
              <Star size={9} /> {offer.ranking_score}
            </span>
          )}
        </div>

        {/* Labeled field rows — each field gets an explicit label so the
            card is self-describing without referring back to the help
            page. Renders dashes for missing values rather than collapsing
            the line, so the layout shape is constant across offers. */}
        <div className="space-y-0.5 text-[11px]">
          <div>
            <span className="text-white/40">Wants in return:</span>{' '}
            <span className="text-white/85">{wantsLabel || '—'}</span>
          </div>
          <div>
            <span className="text-white/40">Payment method:</span>{' '}
            <span className="text-white/85">{prettyMethod || '—'}</span>
          </div>
          {(offer.seller || offer.created_at) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white/40">Seller:</span>
              {offer.seller && (
                <>
                  <span className="font-mono text-white/70">{truncateAddr(offer.seller, 5, 4)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/reputation', { state: { prefillAddress: offer.seller } });
                    }}
                    className="text-irium-400 hover:text-irium-300 transition-colors"
                  >
                    rep
                  </button>
                </>
              )}
              {offer.created_at && (
                <span className="text-white/35">
                  {offer.seller ? '· ' : ''}posted {timeAgo(offer.created_at)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Description — free-text price note or extra detail */}
        {offer.description && (
          <div className="text-white/55 text-xs line-clamp-2">{offer.description}</div>
        )}

        {/* Reputation bar — only when the seller actually has history */}
        {showRepBar && (
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 max-w-[140px] rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.40)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: score > 80 ? '#22c55e' : score > 60 ? '#f59e0b' : '#ef4444' }}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <span className="text-[9px] text-white/35">{completedCount} completed</span>
          </div>
        )}

        {/* Technical details — collapsed by default. Holds offer.id,
            on-chain source, status, and timeout height. stopPropagation
            on the outer details element so toggling the disclosure
            doesn't also fire the card's onOpenDetail click. */}
        <details
          className="mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <summary className="cursor-pointer text-[10px] text-white/25 hover:text-white/60 select-none">
            Technical details
          </summary>
          <div className="mt-2 space-y-1 text-[10px] font-mono text-white/45">
            <div><span className="text-white/30">ID:</span> {offer.id}</div>
            {offer.source && <div><span className="text-white/30">Source:</span> {offer.source}</div>}
            {offer.status && <div><span className="text-white/30">Status:</span> {offer.status}</div>}
            {offer.timeout_height != null && (
              <div><span className="text-white/30">Timeout height:</span> #{offer.timeout_height.toLocaleString('en-US')}</div>
            )}
          </div>
        </details>
      </div>

      {/* Right: action stack — Download (export), Trash (delete confirm),
          and either Take Offer (open non-own) or a grey Taken badge
          (taken non-own). Own offers omit the Take/Taken slot. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {onExport && (
          <button
            onClick={(e) => { e.stopPropagation(); onExport(); }}
            title="Export this offer as JSON to share with a buyer"
            className="btn-ghost text-xs p-1.5 text-irium-400 hover:text-irium-300"
          >
            <Download size={13} />
          </button>
        )}

        {/* Single trash icon — shown on every card the backend will
            accept a removal for. Routes through the confirm modal so
            the click never deletes without an explicit second click.
            Source-agnostic (local or remote-cached): the backend
            deletes by offer_id and finds the file either way. */}
        {canRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete!(); }}
            title="Remove this offer from your local cache"
            className="btn-ghost text-xs p-1.5 text-red-400 hover:text-red-300"
          >
            <Trash2 size={13} />
          </button>
        )}
        {onDelete && offer.status === 'taken' && isOwnOffer && (
          <button
            disabled
            onClick={(e) => e.stopPropagation()}
            title="Cannot delete — offer has been taken. Resolve the agreement first."
            className="btn-ghost text-xs p-1.5 text-white/20 cursor-not-allowed"
          >
            <Trash2 size={13} />
          </button>
        )}

        {!isOwnOffer && (
          offer.status === 'taken' ? (
            <span
              className="inline-flex items-center px-3 py-1.5 text-[10px] font-bold rounded uppercase"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: 'rgba(255,255,255,0.50)',
                letterSpacing: '0.10em',
              }}
              title="This offer has already been taken by another buyer."
            >
              Taken
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onTake(); }}
              disabled={!isOnline}
              title={!isOnline ? 'Node must be online to take offers' : undefined}
              className="btn-primary text-xs py-1.5 px-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Take Offer
            </button>
          )
        )}
      </div>
    </motion.div>
  );
}

// ─── Take Offer Modal ──────────────────────────────────────────
function TakeOfferModal({
  offer,
  defaultBuyerAddress,
  onClose,
  onSuccess,
  isOnline,
}: {
  offer: Offer;
  defaultBuyerAddress: string;
  onClose: () => void;
  onSuccess: () => void;
  isOnline: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [takingOffer, setTakingOffer] = useState(false);
  // Buyer-address override. Pre-filled with the currently selected wallet
  // address; user can clear it (backend then falls back to the wallet's
  // first derivation) or paste a different one of their own addresses.
  const [buyerAddress, setBuyerAddress] = useState(defaultBuyerAddress);

  const handleTake = async () => {
    setTakingOffer(true);
    try {
      const trimmed = buyerAddress.trim();
      const result = await offers.take(offer.id, trimmed.length > 0 ? trimmed : undefined);
      // Surface the next step explicitly — the agreement exists but the
      // escrow is not yet funded, and that has to happen on the Agreements
      // page before any proof can be submitted.
      toast.success(
        (t) => (
          <div className="flex flex-col gap-2">
            <span>
              Offer taken. Agreement <span className="font-mono text-[10px] opacity-70">{result.agreement_id}</span> created.
            </span>
            <span className="text-xs opacity-80">
              Go to Agreements to fund the escrow and complete the trade.
            </span>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                navigate('/agreements', { state: { expandId: result.agreement_id } });
              }}
              className="self-start text-xs px-3 py-1 rounded-md bg-irium-500 text-white hover:opacity-90"
            >
              Open Agreements →
            </button>
          </div>
        ),
        { duration: 12_000 },
      );
      onSuccess();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTakingOffer(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="take-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          key="take-modal"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="card w-full max-w-sm p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white">{t('marketplace.take_offer.title_modal')}</h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 mb-5">
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Offer ID</span>
              <span className="font-mono text-xs text-white/70 truncate max-w-[180px]">
                {offer.id}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Amount</span>
              <span className="font-display font-semibold gradient-text">
                {formatIRM(offer.amount)}
              </span>
            </div>
            {offer.payment_method && (
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Payment Method</span>
                <span className="badge badge-info text-[10px]">{offer.payment_method}</span>
              </div>
            )}
            {offer.seller && (
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Seller</span>
                <span className="font-mono text-xs text-white/60">
                  {truncateAddr(offer.seller, 8, 6)}
                </span>
              </div>
            )}
            {offer.description && (
              <div className="text-white/40 text-xs bg-surface-700 rounded p-2">
                {offer.description}
              </div>
            )}
          </div>

          <div className="text-xs text-white/30 mb-5">
            Taking this offer will auto-create a policy and agreement. The seller's pubkey is
            embedded in the offer.
          </div>

          {/* Optional explicit buyer address. Pre-filled with the wallet's
              currently selected address. Leave blank to let the backend fall
              back to the wallet's first derived address. */}
          <div className="mb-5">
            <label className="label">Buyer Address (optional)</label>
            <input
              className="input font-mono text-xs"
              placeholder="Optional · leave blank for wallet default"
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-white/30 mt-1">
              Pre-filled from your selected wallet address. Must be an address whose key your wallet holds.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button
              onClick={handleTake}
              disabled={takingOffer || !isOnline}
              title={!isOnline ? 'Node must be online to take offers' : undefined}
              className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {takingOffer && <RefreshCw size={14} className="animate-spin mr-1" />}
              Confirm Take
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Create Offer Modal ────────────────────────────────────────
function CreateOfferModal({
  defaultSellerAddress,
  onClose,
  onSuccess,
}: {
  defaultSellerAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    amount: '',
    desc: '',
    paymentMethod: '',
    paymentInstructions: '',
    minAmount: '',
    id: '',
    // Pre-fill with the currently selected wallet address. Blank is accepted —
    // the backend falls back to the wallet's first derived address.
    sellerAddress: defaultSellerAddress,
  });
  const [loading, setLoading] = useState(false);

  // M-21: protect against misplaced-decimal disasters. Total IRM supply is
  // 100M; offers above 1000 IRM also trigger a confirm step so the user
  // can't silently lock their entire wallet by typing "10000" instead of
  // "1.0000".
  const MAX_OFFER_IRM = 100_000_000;
  const CONFIRM_OFFER_IRM = 1_000;

  const handleSubmit = async () => {
    if (!form.amount) return;
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error(t('marketplace.toasts.enter_positive_amount'));
      return;
    }
    if (amt > MAX_OFFER_IRM) {
      toast.error(`Amount cannot exceed ${MAX_OFFER_IRM.toLocaleString('en-US')} IRM (total supply)`);
      return;
    }
    // Validate min amount if provided.
    let minAmt: number | null = null;
    if (form.minAmount.trim()) {
      minAmt = parseFloat(form.minAmount);
      if (isNaN(minAmt) || minAmt <= 0) {
        toast.error(t('marketplace.toasts.min_must_be_positive'));
        return;
      }
      if (minAmt > amt) {
        toast.error(t('marketplace.toasts.min_cannot_exceed'));
        return;
      }
    }
    if (amt > CONFIRM_OFFER_IRM) {
      const ok = window.confirm(
        `You're about to lock ${amt.toLocaleString('en-US')} IRM in escrow.\n\nThis is a large amount. Confirm you typed the decimal correctly.`
      );
      if (!ok) return;
    }
    setLoading(true);
    try {
      const trimmedSeller = form.sellerAddress.trim();
      // Min trade amount isn't a typed field on CreateOfferParams yet —
      // surface it inside the description so buyers see it. When iriumd
      // adds a min_amount field we can promote this to a typed parameter.
      const descParts: string[] = [];
      if (minAmt !== null && minAmt > 0) {
        descParts.push(`Min trade: ${minAmt.toLocaleString('en-US')} IRM`);
      }
      if (form.desc.trim()) descParts.push(form.desc.trim());
      const finalDesc = descParts.length > 0 ? descParts.join(' · ') : undefined;
      const result = await offers.create({
        amount_sats: Math.round(amt * SATS_PER_IRM),
        description: finalDesc,
        payment_method: form.paymentMethod || undefined,
        payment_instructions: form.paymentInstructions || undefined,
        offer_id: form.id || undefined,
        seller_address: trimmedSeller.length > 0 ? trimmedSeller : undefined,
      });
      toast.success(t('marketplace.toasts.offer_created', { id: result.id }));
      onSuccess();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="create-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          key="create-modal"
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card w-full max-w-lg p-6 rounded-2xl"
          // M-23: the modal exceeds the viewport on smaller window sizes,
          // hiding the Create Offer button. Make the whole modal scrollable
          // within 85vh and pin the action row to the bottom (see the
          // sticky-positioned div below).
          style={{ overflowY: 'auto', maxHeight: '85vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-bold text-lg text-white">{t('marketplace.create_offer.title')}</h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          {/* How OTC selling works — five-step explainer above the form. */}
          <div
            className="rounded-xl mb-3 px-3.5 py-3 text-xs"
            style={{
              background: 'rgba(110,198,255,0.06)',
              border: '1px solid rgba(110,198,255,0.18)',
              color: 'rgba(238,240,255,0.55)',
            }}
          >
            <div className="font-semibold mb-1.5" style={{ color: 'rgba(238,240,255,0.85)' }}>
              How OTC selling works
            </div>
            <ol className="space-y-0.5 list-decimal list-inside leading-relaxed">
              <li>You create this offer (the IRM is locked in escrow now).</li>
              <li>A buyer funds the escrow with their IRM share.</li>
              <li>Buyer pays you off-chain using the instructions below.</li>
              <li>You confirm payment received.</li>
              <li>Escrow releases the IRM to the buyer.</li>
            </ol>
          </div>

          {/* Escrow notice — kept as a tighter confirmation row. */}
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-xl mb-5 text-[11px]"
            style={{
              background: 'rgba(110,198,255,0.08)',
              border: '1px solid rgba(110,198,255,0.20)',
              color: 'rgba(238,240,255,0.55)',
            }}
          >
            <span style={{ color: '#A78BFA', flexShrink: 0, fontSize: 13 }}>🔒</span>
            <span>
              <strong style={{ color: 'rgba(238,240,255,0.8)' }}>On-chain escrow</strong> protects both sides — neither of you can disappear with the money.
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">IRM to Sell</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                placeholder="0.0000"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
              <p className="text-[11px] text-white/30 mt-1">This amount will be deducted from your wallet and locked in escrow.</p>
            </div>
            {/* Optional explicit seller address — pre-filled with the wallet's
                currently selected address. Leave blank to let the backend
                pick the wallet's first derived address. */}
            <div>
              <label className="label">Seller Address (optional)</label>
              <input
                className="input font-mono text-xs"
                placeholder="Optional · leave blank for wallet default"
                value={form.sellerAddress}
                onChange={(e) => setForm((f) => ({ ...f, sellerAddress: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-white/30 mt-1">
                Pre-filled from your selected wallet address. Must be an address whose key your wallet holds.
              </p>
            </div>
            <div>
              <label className="label">Minimum trade amount (optional)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                placeholder="e.g. 0.1 (buyers cannot take less than this)"
                value={form.minAmount}
                onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))}
              />
              <p className="text-[11px] text-white/30 mt-1">
                Leave blank if you'll accept any size. Communicated to buyers via the offer description.
              </p>
            </div>
            <div>
              <label className="label">How should buyer pay you?</label>
              <input
                className="input"
                placeholder="e.g. Bank Transfer, PayPal, USDT, BTC, Cash"
                value={form.paymentMethod}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
              />
              <p className="text-[11px] text-white/30 mt-1">
                Short label that helps buyers filter offers — pick the rail they should use.
              </p>
            </div>
            <div>
              <label className="label">Price or exchange rate (optional)</label>
              <input
                className="input"
                placeholder="e.g. Market rate + 2%, $0.05 per IRM"
                maxLength={500}
                value={form.desc}
                onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
              />
              {/* M-22: cap matches Settlement memos. */}
              {form.desc.length > 400 && (
                <p className="text-xs mt-1" style={{ color: form.desc.length >= 500 ? '#f87171' : 'rgba(255,255,255,0.30)' }}>
                  {form.desc.length}/500
                </p>
              )}
            </div>
            <div>
              <label className="label">Your payment details (what to send to you)</label>
              <textarea
                className="input h-24 resize-none"
                placeholder={`e.g. Bank: IBAN DE89 3704 0044 0532 0130 00\n     Name: John Smith\nOR: Send USDT (TRC20) to TQrZ9...wpkX\nOR: PayPal: seller@example.com`}
                maxLength={1000}
                value={form.paymentInstructions}
                onChange={(e) => setForm((f) => ({ ...f, paymentInstructions: e.target.value }))}
              />
              <p className="text-[11px] text-white/30 mt-1">
                The buyer sees these instructions <strong style={{ color: 'rgba(238,240,255,0.6)' }}>after the escrow is funded</strong>. Be specific — wrong details mean lost time.
              </p>
              {form.paymentInstructions.length > 800 && (
                <p className="text-xs mt-1" style={{ color: form.paymentInstructions.length >= 1000 ? '#f87171' : 'rgba(255,255,255,0.30)' }}>
                  {form.paymentInstructions.length}/1000
                </p>
              )}
            </div>
            <div>
              <label className="label">Custom Offer ID (optional)</label>
              <input
                className="input font-mono"
                placeholder="my-offer-001 (auto-generated if empty)"
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              />
            </div>
            {/* M-23: sticky action row — pulled past the modal's p-6 padding via
                negative margins so it spans the full width, and overlaps the
                bottom padding via bottom:-24 so it sits flush with the modal's
                bottom edge when the user scrolls. Matches the modal background
                (var(--bg-elev-1)) and adds a hairline divider above. */}
            <div
              className="flex gap-3"
              style={{
                position: 'sticky',
                bottom: -24,
                marginLeft: -24,
                marginRight: -24,
                marginBottom: -24,
                marginTop: 16,
                padding: 16,
                background: 'var(--bg-elev-1)',
                borderTop: '1px solid var(--brand-line)',
                borderBottomLeftRadius: 16,
                borderBottomRightRadius: 16,
                zIndex: 1,
              }}
            >
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.amount || loading}
                className="btn-primary flex-1 justify-center"
              >
                {loading ? (
                  <RefreshCw size={14} className="animate-spin mr-1" />
                ) : (
                  <Plus size={14} className="mr-1" />
                )}
                Create Offer
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function MarketplacePage() {
  const { t } = useTranslation();
  const nodeStatus = useStore((s) => s.nodeStatus);
  // Currently-selected wallet address — used to pre-fill the seller/buyer
  // inputs in the Create and Take modals so the user doesn't have to paste
  // their own address. The backend still accepts empty (falls back to the
  // wallet's first derivation), so leaving it blank is harmless.
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selectedAddress = addresses[activeAddrIdx]?.address ?? '';
  const [activeTab, setActiveTab] = useState<Tab>('browse');
  const [offerList, setOfferList] = useState<Offer[]>([]);
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  // ALL of the user's wallet addresses. Used to (a) hide own offers from
  // the Browse list, (b) populate the My Offers list by address match,
  // and (c) hide the Take Offer button on the user's own cards.
  const [myAddresses, setMyAddresses] = useState<Set<string>>(new Set());
  // Client-side blocklist of offer IDs the user has Removed. Lazy
  // initializer reads the persisted set from localStorage so the
  // blocklist survives reload. A useEffect below writes back on every
  // change. blockOfferId is the one place that mutates the set — it's
  // called from handleDeleteOffer BEFORE the backend offers.remove() so
  // even if the backend rejects (offer taken, file already gone, etc.)
  // the offer stays hidden in the UI.
  const [blockedOfferIds, setBlockedOfferIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(BLOCKED_OFFERS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? new Set(arr.filter((x): x is string => typeof x === 'string'))
        : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(BLOCKED_OFFERS_KEY, JSON.stringify(Array.from(blockedOfferIds)));
    } catch {
      // localStorage may be unavailable (private mode) or full — non-fatal,
      // the in-memory set still works for the current session.
    }
  }, [blockedOfferIds]);
  const blockOfferId = (id: string) => {
    setBlockedOfferIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };
  const [feedList, setFeedList] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks whether the next load is the *first* one for the current
  // browse session. The skeleton only renders on this first call (or on
  // an explicit user refresh / manual reload). All subsequent auto-tick
  // and event-driven loads run silently, regardless of the silent= flag,
  // to eliminate the per-minute flicker users complained about. The flag
  // resets to true when the tab is switched away and back via the effect
  // that wires syncAndLoad below.
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [filterSource, setFilterSource] = useState<'all' | 'local' | 'remote'>('all');
  const [filterSort, setFilterSort] = useState<'newest' | 'score' | 'amount'>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTakeModal, setShowTakeModal] = useState<Offer | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<Offer | null>(null);
  const navigate = useNavigate();
  const [addFeedUrl, setAddFeedUrl] = useState('');
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removingFeed, setRemovingFeed] = useState<string | null>(null);
  // Phase 7 — Discover Feeds modal state.
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [showDeleteOfferModal, setShowDeleteOfferModal] = useState<Offer | null>(null);
  // Server-side filter params for offers.list. Min/Max are IRM strings
  // (kept as strings so the inputs allow partial values like "1."); the
  // backend offer_list command accepts f64 IRM directly — see main.rs:2262
  // L2267-2280, which forwards values verbatim as `--min-amount` /
  // `--max-amount` to the wallet CLI. Payment is a freeform string filter.
  const [filterMinIrm, setFilterMinIrm] = useState('');
  const [filterMaxIrm, setFilterMaxIrm] = useState('');
  const [filterPayment, setFilterPayment] = useState<string>('');

  // Fetch the user's wallet addresses and merge with the addresses already
  // in the Zustand store (populated earlier in app lifecycle). Both sources
  // feed the same Set so the Browse filter drops own offers even before the
  // wallet.listAddresses() call returns — if the store has addresses, they
  // are usable immediately. Normalize via trim() because the wallet binary
  // sometimes serializes addresses with leading/trailing whitespace that
  // the offer's seller field doesn't carry, which silently breaks .has().
  useEffect(() => {
    const fromStore = (addresses ?? [])
      .map((a) => (a.address ?? '').trim())
      .filter(Boolean);
    if (fromStore.length > 0) {
      setMyAddresses(new Set(fromStore));
    }
    wallet.listAddresses()
      .then((addrs) => {
        const fromWallet = (addrs ?? [])
          .map((a) => (a.address ?? '').trim())
          .filter(Boolean);
        // Merge store + wallet sources so a slow wallet.listAddresses
        // result never overwrites store-derived addresses with an empty set.
        const merged = new Set<string>([...fromStore, ...fromWallet]);
        setMyAddresses(merged);
      })
      .catch(() => { /* keep store-derived set; filtering still works */ });
  }, [addresses]);

  // ── Data loaders ─────────────────────────────────────────────
  // Race guard for loadOffers. Without this, the user-triggered tab-entry
  // call and the 60-s auto-refresh tick can both fire `offers.list` at
  // once and the second response overwrites the first, occasionally with
  // stale data when the older request was slower. The ref also lets the
  // auto-refresh tick cleanly skip itself if a manual fetch is already
  // in flight.
  const isFetchingOffersRef = useRef(false);

  const loadOffers = async (silent: boolean = false) => {
    if (isFetchingOffersRef.current) return;
    isFetchingOffersRef.current = true;
    // Skeleton renders only when this is the very first load for the
    // current tab session AND the fetch takes more than 200ms. The timer
    // pattern eliminates the perceptible flash that happened on rapid
    // tab switches (Browse → My Offers → Browse) where the local cache
    // returned in <50ms but the skeleton still flickered into existence
    // because setLoading(true) fired synchronously.
    const showSkeletonEligible = !silent && isInitialLoad;
    let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
    if (showSkeletonEligible) {
      skeletonTimer = setTimeout(() => setLoading(true), 200);
    }
    try {
      // Parse min/max IRM inputs. parseFloat('') is NaN → undefined.
      const minIrm = filterMinIrm.trim() ? parseFloat(filterMinIrm) : undefined;
      const maxIrm = filterMaxIrm.trim() ? parseFloat(filterMaxIrm) : undefined;
      const data = await offers.list({
        source: filterSource,
        sort: filterSort,
        limit: 50,
        minAmount: Number.isFinite(minIrm) ? minIrm : undefined,
        maxAmount: Number.isFinite(maxIrm) ? maxIrm : undefined,
        payment: filterPayment.trim() ? filterPayment.trim() : undefined,
      });
      console.log(
        `[Marketplace] loadOffers source=${filterSource} silent=${silent} initial=${isInitialLoad} got=${data?.length ?? 0}`,
      );
      setOfferList(data);
      setIsInitialLoad(false);
    } catch (e) {
      console.warn('[Marketplace] loadOffers failed:', e);
      // Suppress toast on silent auto-refresh AND when offline — empty
      // state communicates the problem in both cases.
      if (!silent && nodeStatus?.running) {
        toast.error(t('marketplace.toasts.failed_to_load', { reason: String(e) }));
      }
    } finally {
      if (skeletonTimer) clearTimeout(skeletonTimer);
      setLoading(false);
      isFetchingOffersRef.current = false;
    }
  };

  const loadMyOffers = async () => {
    // Same 200 ms skeleton-eligibility timer as loadOffers — tab switches
    // to My Offers used to flash a skeleton even when the local file scan
    // resolved in well under 100ms.
    const skeletonTimer = setTimeout(() => setLoading(true), 200);
    try {
      // Load all-source then filter client-side to offers whose seller
      // matches one of the user's wallet addresses. This is stricter
      // than source: 'local' (which would also include offers imported
      // from other sellers' JSON exports — those are "local files" but
      // not "your offers"). Trim both sides so any stray whitespace in
      // the offer's seller field doesn't silently drop the match.
      const data = await offers.list({ source: 'all' });
      const mine = (data ?? []).filter((o) => {
        // Blocklist drop — own offer the user Removed should not reappear
        // even if backend delete propagation lagged or a feed re-imported.
        if (blockedOfferIds.has(o.id)) return false;
        const s = (o.seller ?? '').trim();
        return s.length > 0 && myAddresses.has(s);
      });
      setMyOffers(mine);
    } catch (e) {
      if (nodeStatus?.running) {
        toast.error(t('marketplace.toasts.failed_load_my', { reason: String(e) }));
      }
    } finally {
      clearTimeout(skeletonTimer);
      setLoading(false);
    }
  };

  const loadFeeds = async () => {
    const skeletonTimer = setTimeout(() => setLoading(true), 200);
    try {
      const data = await feeds.list();
      setFeedList(data);
    } catch (e) {
      if (nodeStatus?.running) {
        toast.error(t('marketplace.toasts.failed_load_feeds', { reason: String(e) }));
      }
    } finally {
      clearTimeout(skeletonTimer);
      setLoading(false);
    }
  };

  // Single effect handles initial load + tab changes + filter changes.
  // Merging prevents the second useEffect([filterSource, filterSort]) from
  // firing a redundant loadOffers() on mount, which caused 4 toast errors.
  // Browse-mode is debounced 400ms so per-keystroke min/max amount edits
  // don't fire an RPC per character; tab changes get the same 400ms but it
  // is barely perceptible. myAddresses is in the deps so the My-Offers
  // address-match filter applies as soon as wallet.listAddresses resolves.
  useEffect(() => {
    if (activeTab === 'browse') {
      const t = setTimeout(loadOffers, 400);
      return () => clearTimeout(t);
    }
    if (activeTab === 'my-offers') loadMyOffers();
    if (activeTab === 'feeds') loadFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filterSource, filterSort, filterMinIrm, filterMaxIrm, filterPayment, myAddresses]);

  // Phase 5: real-time refresh on offer.* events from the Rust WS bridge.
  // Polling stays as a fallback when the WS connection is down. Silent
  // reload — these are spontaneous updates, the user didn't ask for the
  // skeleton.
  useIriumEvents((event) => {
    if (
      event.type === 'offer.created' ||
      event.type === 'offer.taken' ||
      event.type === 'offer.expired'
    ) {
      if (activeTab === 'browse') loadOffers(true);
      else if (activeTab === 'my-offers') loadMyOffers();
    }
    if (event.type === 'offer.relisted') {
      // LAYER 3 surface: seller's offer was auto-relisted because the
      // buyer never anchored the agreement on-chain within the grace
      // window. Single toast per event, no sticky banner.
      toast(t('marketplace.toasts.relisted_banner_body'), {
        icon: '↩',
        duration: 8000,
      });
      if (activeTab === 'my-offers') loadMyOffers();
    }
  });

  // 60-second auto-refresh on the Browse tab. Each tick (a) runs
  // offer-feed-sync to pull from every URL in feeds.json and the P2P-
  // discovered feed list (~/.irium/discovered_feeds.json), then (b) does a
  // SILENT loadOffers() over the now-updated local cache so the
  // interval doesn't visually re-render the skeleton every minute. The
  // first call on tab entry IS visible (silent=false) so the user gets
  // feedback that a fresh fetch is happening.
  //
  // Cadence was lowered from 30s → 60s after operators noticed the
  // back-to-back sync+list cycle was perceptibly heavy on slower
  // machines (the wallet binary spawn dominates and shows up in the
  // event loop). Half the request volume halves that load.
  //
  // feed-sync failures are swallowed — a transient unreachable feed
  // should never block the cached list from rendering.
  useEffect(() => {
    if (activeTab !== 'browse') return;
    // Each time the Browse tab is (re-)entered, count the next load as
    // "initial" so the skeleton shows once. Subsequent 60 s auto-ticks
    // and event-driven refreshes inside the same browse session flip
    // isInitialLoad to false (inside loadOffers), suppressing the
    // skeleton flicker for everything except the first paint.
    setIsInitialLoad(true);
    const syncAndLoad = async (silent: boolean = false) => {
      try {
        await feeds.sync();
      } catch {
        // silent — partial-failure responses are normal when one of N
        // discovered feeds is temporarily unreachable
      }
      await loadOffers(silent);
    };
    // Tab-entry sync runs NON-SILENT so the user gets the loading skeleton
    // while feeds.sync is in flight (gated by isInitialLoad inside
    // loadOffers — only the first call paints the skeleton; everything
    // else updates in place).
    syncAndLoad(false);
    const id = setInterval(() => syncAndLoad(true), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Feed actions ─────────────────────────────────────────────
  const handleAddFeed = async () => {
    if (!addFeedUrl.trim()) return;
    try {
      await feeds.add(addFeedUrl.trim());
      toast.success('Feed added');
      setAddFeedUrl('');
      setShowAddFeed(false);
      await loadFeeds();
    } catch (e) {
      toast.error(t('marketplace.toasts.failed_add_feed', { reason: String(e) }));
    }
  };

  const handleRemoveFeed = async (url: string) => {
    try {
      await feeds.remove(url);
      toast.success(t('marketplace.toasts.feed_removed'));
      setRemovingFeed(null);
      await loadFeeds();
    } catch (e) {
      toast.error(t('marketplace.toasts.failed_remove_feed', { reason: String(e) }));
    }
  };

  // ── Export / Import single offers ────────────────────────────
  const handleExportOffer = async (offerId: string) => {
    const path = await openSavePicker({
      defaultName: `offer-${offerId.slice(0, 16)}.json`,
      extensions: ['json'],
      title: 'Save Offer',
    });
    if (!path) return;
    try {
      await offers.export(offerId, path);
      toast.success(t('marketplace.toasts.offer_exported', { path }));
    } catch (e) {
      toast.error(t('marketplace.toasts.export_failed', { reason: String(e) }));
    }
  };

  const handleDeleteOffer = async (offer: Offer) => {
    // Block in the UI first — persists to localStorage and survives a
    // feeds.sync() re-import. Even if the backend offers.remove() below
    // fails (offer already taken, file already gone, etc.) the offer
    // stays hidden in the UI for this session and across reloads.
    blockOfferId(offer.id);
    try {
      await offers.remove(offer.id);
      toast.success(t('marketplace.toasts.offer_deleted'));
      setShowDeleteOfferModal(null);
      await loadMyOffers();
    } catch (e) {
      toast.error(t('marketplace.toasts.delete_failed', { reason: String(e) }));
      // Even on backend rejection the local blocklist (blockOfferId above)
      // has already hidden this offer for the rest of the session and
      // across reloads. Close the modal and re-fetch so the row goes
      // away immediately — the user still sees the toast that explains
      // why iriumd refused. Without this, the modal sits open on the
      // same offer and `myOffers` still shows the row until the next
      // tab-switch or WS event, which reads to the user as "delete did
      // nothing." With this, the only difference between success and
      // failure paths is the toast colour.
      setShowDeleteOfferModal(null);
      await loadMyOffers();
    }
  };

  const handleImportOffer = async () => {
    const path = await openFilePicker({
      extensions: ['json'],
      title: 'Select Offer JSON',
    });
    if (!path) return;
    try {
      await offers.import(path);
      toast.success(t('marketplace.toasts.offer_imported'));
      await loadMyOffers();
    } catch (e) {
      toast.error(t('marketplace.toasts.import_failed', { reason: String(e) }));
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const result = await feeds.sync();
      toast.success(
        `Sync complete: ${result.total_offers} offers from ${result.synced} feeds${result.failed > 0 ? ` (${result.failed} failed)` : ''}`
      );
      await loadFeeds();
    } catch (e) {
      toast.error(t('marketplace.toasts.sync_failed', { reason: String(e) }));
    } finally {
      setSyncing(false);
    }
  };

  // ── Filtered offers ──────────────────────────────────────────
  // Browse drops the user's own offers entirely — they belong in My Offers
  // and you can't trade with yourself anyway. Compare via trim() so a
  // legacy offer whose seller carries trailing whitespace still gets
  // hidden. Then phase 8's search filter matches description /
  // payment_method / id / seller. Sort applies last.
  //
  // The console.debug below surfaces a counter snapshot so the filter's
  // correctness can be verified at runtime ("3 own offers dropped" vs
  // "0 own offers dropped"). It only runs when offerList or myAddresses
  // change, not on every render.
  const filteredOffers = useMemo(() => {
    let ownDropped = 0;
    const result = offerList
      // Client-side blocklist — always wins regardless of source. An
      // offer the user Removed stays hidden even if the next feeds.sync()
      // re-imported it from a remote feed.
      .filter((o) => !blockedOfferIds.has(o.id))
      .filter((o) => {
        const sellerTrim = (o.seller ?? '').trim();
        if (sellerTrim && myAddresses.has(sellerTrim)) {
          ownDropped += 1;
          return false;
        }
        return true;
      })
      .filter((o) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          o.description?.toLowerCase().includes(q) ||
          o.payment_method?.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.seller?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => {
        if (filterSort === 'score') return (b.ranking_score ?? 0) - (a.ranking_score ?? 0);
        if (filterSort === 'amount') return b.amount - a.amount;
        return (b.created_at ?? 0) - (a.created_at ?? 0);
      });
    // eslint-disable-next-line no-console
    console.debug('[marketplace] browse filter:', {
      sourceOffers: offerList.length,
      ownAddresses: myAddresses.size,
      ownDropped,
      blocklistSize: blockedOfferIds.size,
      finalCount: result.length,
    });
    return result;
  }, [offerList, myAddresses, blockedOfferIds, searchQuery, filterSort]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="w-full space-y-5 px-8 py-6">
      <NodeOfflineBanner />
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{t('marketplace.page_title')}</h1>
          <p className="page-subtitle">Post public offers for anyone to find and take. For private deals with someone specific, use Settlement.</p>
        </div>
        <button
          onClick={() => navigate('/help#marketplace')}
          className="btn-ghost p-2 text-white/40 hover:text-white/80 flex-shrink-0 mt-1"
          title="Marketplace help"
        >
          <HelpCircle size={18} />
        </button>
      </div>
      {/* Tab bar */}
      <div className="flex border-b border-white/[0.06] mb-5">
        {(['browse', 'my-offers', 'feeds'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-5 py-3 text-sm font-display font-medium capitalize transition-colors ${
              activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {tab === 'my-offers'
              ? 'My Offers'
              : tab === 'feeds'
              ? 'Feed Registry'
              : 'Browse Offers'}
            {activeTab === tab && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-irium-500"
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Browse Tab ────────────────────────────────────────── */}
      {activeTab === 'browse' && (
        <>
          {/* Remote-source filter warning — the `remote` pill hides every
              local offer (the user's own + any imported), which is the
              most common reason a freshly-created offer "disappears" from
              the Browse tab. Surface this explicitly when the filter is
              active so the user sees the cause at a glance. */}
          {filterSource === 'remote' && (
            <div
              className="flex items-start gap-2.5 px-4 py-3 mb-4"
              style={{
                background: 'rgba(245,158,11,0.10)',
                border: '1px solid rgba(245,158,11,0.40)',
                borderRadius: 8,
              }}
            >
              <AlertTriangle size={14} style={{ color: '#fbbf24', marginTop: 1, flexShrink: 0 }} />
              <p style={{ fontSize: 11.5, color: 'rgba(253,230,138,0.90)', lineHeight: 1.5 }}>
                {t('marketplace.browse.remote_filter_warning')}{' '}
                <button
                  onClick={() => setFilterSource('all')}
                  className="font-display font-semibold underline"
                  style={{ color: '#fbbf24' }}
                >
                  {t('marketplace.browse.switch_to_all')}
                </button>
              </p>
            </div>
          )}

          {/* Filter bar */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-wrap gap-3 items-center mb-5"
          >
            {/* Source pills */}
            {(['all', 'local', 'remote'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSource(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-display font-semibold transition-all ${
                  filterSource === s
                    ? 'bg-irium-500 text-white'
                    : 'bg-surface-600 text-white/50 hover:text-white/80'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <div className="w-px h-5 bg-white/10" />
            {/* Sort pills */}
            {(['newest', 'score', 'amount'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSort(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-display font-semibold transition-all ${
                  filterSort === s
                    ? 'bg-irium-500/30 text-irium-300 border border-irium-500/30'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <div className="ml-auto relative">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search offers..."
                className="input pr-8 py-1.5 text-xs w-52"
              />
              <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30" />
            </div>
          </motion.div>

          {/* Secondary filter row — min/max amount + payment method. Server-
              side filters wired into offers.list(). Debounced via the
              loadOffers useEffect above so per-keystroke edits don't spam
              the backend. */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="flex flex-wrap gap-3 items-center mb-5"
          >
            <input
              type="number"
              min="0"
              step="0.0001"
              value={filterMinIrm}
              onChange={(e) => setFilterMinIrm(e.target.value)}
              placeholder="Min IRM"
              className="input py-1.5 text-xs w-28"
              title="Filter offers with amount at least this many IRM"
            />
            <input
              type="number"
              min="0"
              step="0.0001"
              value={filterMaxIrm}
              onChange={(e) => setFilterMaxIrm(e.target.value)}
              placeholder="Max IRM"
              className="input py-1.5 text-xs w-28"
              title="Filter offers with amount at most this many IRM"
            />
            {/* Payment method filter — pill group matching the Source and
                Sort pills above. Top 5 methods by frequency are surfaced as
                pills; anything beyond that goes into an overflow dropdown so
                the filter row doesn't blow up when many methods are
                advertised. */}
            {(() => {
              const counts = new Map<string, number>();
              for (const o of offerList) {
                if (o.payment_method) {
                  counts.set(o.payment_method, (counts.get(o.payment_method) ?? 0) + 1);
                }
              }
              const ranked = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([pm]) => pm);
              const topFive = ranked.slice(0, 5);
              const overflow = ranked.slice(5);
              return (
                <>
                  <button
                    onClick={() => setFilterPayment('')}
                    className={`px-3 py-1.5 rounded-full text-xs font-display font-semibold transition-all ${
                      filterPayment === ''
                        ? 'bg-irium-500 text-white'
                        : 'bg-surface-600 text-white/50 hover:text-white/80'
                    }`}
                    title="Show offers for any payment method"
                  >
                    All
                  </button>
                  {topFive.map((pm) => (
                    <button
                      key={pm}
                      onClick={() => setFilterPayment(pm)}
                      className={`px-3 py-1.5 rounded-full text-xs font-display font-semibold transition-all ${
                        filterPayment === pm
                          ? 'bg-irium-500 text-white'
                          : 'bg-surface-600 text-white/50 hover:text-white/80'
                      }`}
                      title={`Filter to "${pm}" payment method`}
                    >
                      {pm}
                    </button>
                  ))}
                  {overflow.length > 0 && (
                    <select
                      value={overflow.includes(filterPayment) ? filterPayment : ''}
                      onChange={(e) => setFilterPayment(e.target.value)}
                      className="input py-1.5 text-xs pr-3 appearance-none cursor-pointer"
                      title={`${overflow.length} more payment methods`}
                    >
                      <option value="" style={{ background: '#0f0f23', color: '#eef0ff' }}>More ({overflow.length})…</option>
                      {overflow.map((pm) => (
                        <option key={pm} value={pm} style={{ background: '#0f0f23', color: '#eef0ff' }}>{pm}</option>
                      ))}
                    </select>
                  )}
                </>
              );
            })()}
            {(filterMinIrm || filterMaxIrm || filterPayment) && (
              <button
                onClick={() => { setFilterMinIrm(''); setFilterMaxIrm(''); setFilterPayment(''); }}
                className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </motion.div>

          {/* Offer grid */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-20 rounded" />
                </div>
              ))}
            </div>
          ) : filteredOffers.length === 0 ? (
            <div className="text-center py-20 text-white/40 text-sm flex flex-col items-center gap-3">
              <div>
                No offers found.
                {filterSource === 'remote' && ' Try syncing your feeds first.'}
              </div>
              <button
                onClick={() => setActiveTab('feeds')}
                className="btn-primary text-sm py-2 px-4"
              >
                Add feeds to discover offers from other nodes →
              </button>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {filteredOffers.map((offer) => {
                const sellerTrim = (offer.seller ?? '').trim();
                const isOwn = sellerTrim.length > 0 && myAddresses.has(sellerTrim);
                return (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    onTake={() => setShowTakeModal(offer)}
                    onOpenDetail={() => setShowDetailModal(offer)}
                    onExport={isOwn ? () => handleExportOffer(offer.id) : undefined}
                    // Browse: always allow local-cache removal. Backend
                    // deletes by offer_id regardless of origin (source);
                    // remote-fetched offers are still local files on
                    // disk and behave the same as user-created ones.
                    // Users need this to clean stale gossip clutter
                    // (d1-gossip-*, phase-* test data, etc.).
                    onDelete={() => setShowDeleteOfferModal(offer)}
                    isOwnOffer={isOwn}
                    isOnline={!!nodeStatus?.running}
                  />
                );
              })}
            </motion.div>
          )}

          {/* Auto-share confirmation — surfaced when the user has at least
              one local offer in the view. Replaces the old manual
              `feed-add` instruction, which is obsolete since automatic
              feed-URL exchange via P2P handshake landed in v1.0.38. */}
          {filteredOffers.some((o) => o.source === 'local') && (
            <div
              className="flex items-start gap-2.5 px-4 py-3 mt-4"
              style={{
                background: 'rgba(110,198,255,0.05)',
                border: '1px solid rgba(110,198,255,0.15)',
                borderRadius: 8,
              }}
            >
              <Radio size={14} style={{ color: '#6ec6ff', marginTop: 1, flexShrink: 0 }} />
              <p style={{ fontSize: 11.5, color: 'rgba(238,240,255,0.70)', lineHeight: 1.55 }}>
                {t('marketplace.browse.auto_shared_hint')}
              </p>
            </div>
          )}

          {/* NAT / CGNAT FAQ — collapsible. The marketplace works in
              both directions but with different reachability requirements;
              users behind CGNAT often think their setup is broken when in
              fact "Browse" works fine (read-direction) and only their own
              outbound advertisements need a reachable public endpoint
              (write-direction). Spell that out honestly so users don't
              waste time chasing a non-issue or, worse, draw wrong
              conclusions about why their own offers aren't appearing on
              other nodes. */}
          <details
            className="mt-3"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 8,
            }}
          >
            <summary
              className="cursor-pointer px-4 py-2.5 select-none flex items-center gap-2"
              style={{ fontSize: 11.5, color: 'rgba(238,240,255,0.65)', fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600 }}
            >
              <HelpCircle size={13} />
              {t('marketplace.browse.nat_faq_title')}
            </summary>
            <div className="px-4 pb-3 pt-1" style={{ fontSize: 11, color: 'rgba(238,240,255,0.60)', lineHeight: 1.6 }}>
              <p>{t('marketplace.browse.nat_faq_receiving_label')}: {t('marketplace.browse.nat_faq_receiving_body')}</p>
              <p className="mt-2">{t('marketplace.browse.nat_faq_sharing_label')}: {t('marketplace.browse.nat_faq_sharing_body')}</p>
              <p className="mt-2">{t('marketplace.browse.nat_faq_cgnat_label')}: {t('marketplace.browse.nat_faq_cgnat_body')}</p>
            </div>
          </details>
        </>
      )}

      {/* ── My Offers Tab ─────────────────────────────────────── */}
      {activeTab === 'my-offers' && (
        <>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display font-semibold text-white/90">Your active offers</h2>
              <p className="text-white/30 text-xs mt-0.5">Offers you have listed on the marketplace</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleImportOffer} className="btn-secondary">
                <Upload size={14} className="mr-1" />
                Import Offer
              </button>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary">
                <Plus size={14} className="mr-1" />
                Create Offer
              </button>
            </div>
          </div>

          {/* My Offers info banner — clarifies what posting an offer
              actually does. Two common questions from new sellers:
              "can anyone see this?" (yes) and "is my balance locked?"
              (no, not until a buyer takes the offer and funds the
              escrow). Blue left-border info style. */}
          <div
            className="flex items-start gap-2.5 px-4 py-3 mb-5"
            style={{
              background: 'rgba(110,198,255,0.06)',
              border: '1px solid rgba(110,198,255,0.18)',
              borderLeft: '3px solid #6ec6ff',
              borderRadius: 8,
            }}
          >
            <p style={{ fontSize: 11.5, color: 'rgba(238,240,255,0.70)', lineHeight: 1.55 }}>
              Your offers are visible to other Irium users on the network. Your balance only locks when a buyer takes your offer and funds the escrow — not when you create the offer.
            </p>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-20 rounded" />
                </div>
              ))}
            </div>
          ) : myOffers.length === 0 ? (
            <div className="text-center py-20 text-white/30 text-sm">
              No offers yet. Create your first offer to get started.
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {myOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  onTake={() => setShowTakeModal(offer)}
                  onOpenDetail={() => setShowDetailModal(offer)}
                  onExport={() => handleExportOffer(offer.id)}
                  onDelete={() => setShowDeleteOfferModal(offer)}
                  isOwnOffer={true}
                  isOnline={!!nodeStatus?.running}
                />
              ))}
            </motion.div>
          )}
        </>
      )}

      {/* ── Feed Registry Tab ──────────────────────────────────── */}
      {activeTab === 'feeds' && (
        <>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display font-semibold text-white/90">Feed Registry</h2>
              <p className="text-white/30 text-xs mt-0.5">
                Add seller feeds to discover remote offers
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddFeed((v) => !v)}
                className="btn-secondary"
              >
                <Plus size={14} className="mr-1" />
                Add Feed
              </button>
              <button
                onClick={() => setShowDiscoverModal(true)}
                className="btn-secondary"
                title="Ask the wallet binary to discover seller feeds on the network"
              >
                <Compass size={14} className="mr-1" />
                Discover Feeds
              </button>
              <button onClick={handleSyncAll} disabled={syncing} className="btn-primary">
                <RefreshCw size={14} className={syncing ? 'animate-spin mr-1' : 'mr-1'} />
                Sync All
              </button>
            </div>
          </div>

          {/* Add feed row */}
          <AnimatePresence>
            {showAddFeed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex gap-2 p-3 glass rounded-lg mb-3">
                  <input
                    value={addFeedUrl}
                    onChange={(e) => setAddFeedUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFeed()}
                    placeholder="https://seller-node:38300/offers/feed"
                    className="input flex-1 py-1.5 text-xs"
                  />
                  <button onClick={handleAddFeed} className="btn-primary py-1.5 px-3 text-xs">
                    Add
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feed list */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-12 rounded" />
                </div>
              ))}
            </div>
          ) : feedList.length === 0 ? (
            <div className="text-center py-20 text-white/30 text-sm flex flex-col items-center gap-4">
              <Rss size={32} className="mx-auto opacity-30" />
              <div>
                No feeds registered. Add a seller feed URL to discover their offers,
                <br />
                or use the bundled default feeds to get started fast.
              </div>
              <button
                onClick={async () => {
                  try {
                    await feedOps.bootstrap();
                    toast.success(t('marketplace.toasts.default_feeds_added'));
                    await loadFeeds();
                  } catch (e) {
                    toast.error('Failed to add default feeds: ' + String(e));
                  }
                }}
                className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
              >
                <Plus size={13} /> Use Default Feeds
              </button>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {feedList.map((feed) => (
                <motion.div key={feed.url} variants={itemVariants} className="overflow-hidden">
                  <div className="card p-3 flex items-center gap-3 group">
                    <Globe size={16} className="text-irium-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-white/70 truncate">{feed.url}</div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-white/30">
                        {feed.offer_count !== undefined && (
                          <span>{feed.offer_count} offers</span>
                        )}
                        {feed.last_synced && (
                          <span>synced {timeAgo(feed.last_synced)}</span>
                        )}
                        {feed.status && (
                          <span
                            className={
                              feed.status === 'ok'
                                ? 'badge badge-success text-[10px]'
                                : 'badge badge-warning text-[10px]'
                            }
                          >
                            {feed.status}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Remove confirm inline */}
                    {removingFeed === feed.url ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-white/40">Remove?</span>
                        <button
                          onClick={() => handleRemoveFeed(feed.url)}
                          className="text-xs text-red-400 hover:text-red-300 font-medium px-2 py-0.5 rounded border border-red-400/30 hover:border-red-300/50 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setRemovingFeed(null)}
                          className="text-xs text-white/30 hover:text-white/60 font-medium px-2 py-0.5 rounded border border-white/10 hover:border-white/20 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRemovingFeed(feed.url)}
                        className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </>
      )}

      {/* ── Modals ────────────────────────────────────────────── */}
      {showTakeModal && (
        <TakeOfferModal
          offer={showTakeModal}
          defaultBuyerAddress={selectedAddress}
          onClose={() => setShowTakeModal(null)}
          onSuccess={() => {
            // LAYER 4 optimistic update: yank the taken offer from the
            // Browse list immediately so the user doesn't see the same
            // offer they just took for the next ~60 s. The buyer's iriumd
            // emits offer.taken which the useIriumEvents handler above
            // also catches; that emit then triggers a re-sync which is
            // idempotent with this optimistic removal.
            const takenId = showTakeModal.id;
            setOfferList((prev) => prev.filter((o) => o.id !== takenId));
            setShowTakeModal(null);
            if (activeTab === 'browse') loadOffers();
            else if (activeTab === 'my-offers') loadMyOffers();
          }}
          isOnline={!!nodeStatus?.running}
        />
      )}

      {showCreateModal && (
        <CreateOfferModal
          defaultSellerAddress={selectedAddress}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            // Switch to the Browse tab and refresh both lists so the new
            // offer is visible immediately. Prior behaviour only refreshed
            // My Offers, which meant a user creating from the Browse tab
            // would see the modal close and their offer apparently
            // vanish — locally-saved offers don't emit iriumd WS events,
            // so the useIriumEvents fallback never fires for them.
            setActiveTab('browse');
            loadOffers();
            loadMyOffers();
            toast.success(t('marketplace.toasts.offer_created_browse_ready'));
          }}
        />
      )}

      {showDetailModal && (
        <OfferDetailModal
          offer={showDetailModal}
          onClose={() => setShowDetailModal(null)}
          onTake={() => {
            // Hand off to TakeOfferModal — closes detail first to avoid
            // stacked modal overlap.
            const o = showDetailModal;
            setShowDetailModal(null);
            setShowTakeModal(o);
          }}
          isOwnOffer={!!(showDetailModal.seller && myAddresses.has(showDetailModal.seller))}
          isOnline={!!nodeStatus?.running}
        />
      )}

      {showDiscoverModal && (
        <DiscoverFeedsModal
          existingUrls={new Set(feedList.map((f) => f.url))}
          onClose={() => setShowDiscoverModal(false)}
          onAfterAdd={() => loadFeeds()}
        />
      )}

      <AnimatePresence>
        {showDeleteOfferModal && (
          <motion.div
            key="delete-offer-overlay"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="card w-full max-w-md p-6"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Trash2 size={16} className="text-red-400" /> Delete Offer
              </h2>
              <p className="text-sm text-white/60 mb-1">
                Are you sure you want to delete offer <span className="font-mono text-white/80">{showDeleteOfferModal.id.slice(0, 20)}…</span>?
              </p>
              <p className="text-xs text-white/40 mb-5">This removes the offer from your node immediately. Other peers who have already synced this offer will stop seeing it within their next sync cycle. Active agreements are not affected.</p>
              <div className="flex gap-3 justify-end">
                <button className="btn-ghost text-sm py-1.5 px-4" onClick={() => setShowDeleteOfferModal(null)}>
                  Cancel
                </button>
                <button
                  className="btn-primary text-sm py-1.5 px-4 bg-red-600 hover:bg-red-500"
                  onClick={() => handleDeleteOffer(showDeleteOfferModal)}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Offer Detail Modal ────────────────────────────────────────
// Opens when a user clicks an offer card body (the Take Offer button
// stops propagation and bypasses this modal). Shows the full offer
// data — untruncated seller address, full description, timeout height,
// reputation breakdown — and a Take Offer CTA that hands off to the
// existing TakeOfferModal.
function OfferDetailModal({
  offer,
  onClose,
  onTake,
  isOwnOffer,
  isOnline,
}: {
  offer: Offer;
  onClose: () => void;
  onTake: () => void;
  isOwnOffer: boolean;
  isOnline: boolean;
}) {
  const navigate = useNavigate();
  const score = offer.reputation?.score ?? 0;
  const riskClass =
    offer.risk_signal === 'low'
      ? 'badge-success'
      : offer.risk_signal === 'medium'
      ? 'badge-warning'
      : offer.risk_signal === 'high'
      ? 'badge-error'
      : 'badge-info';
  const riskExplanation =
    offer.risk_signal === 'low'
      ? 'Seller has a clean recent record — no sybil suppression, no disputes ≥10%.'
      : offer.risk_signal === 'medium'
      ? 'Seller has limited history or some warning signals. Inspect before trading.'
      : offer.risk_signal === 'high'
      ? 'Seller is sybil-suppressed, self-trading, or has ≥10% disputes. Trade with caution.'
      : 'Risk level not classified yet.';

  return (
    <AnimatePresence>
      <motion.div
        key="detail-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          key="detail-modal"
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card w-full max-w-lg p-6 rounded-2xl overflow-y-auto max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display font-bold text-lg text-white">Offer Details</h2>
              <p className="font-mono text-[10px] text-white/40 mt-0.5">{offer.id}</p>
            </div>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          {/* How this works — plain-English flow for first-time users.
              Matches the cyan-tinted info pattern used by the Settlement
              wizard's escrow notice. */}
          <div
            className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-5 text-xs"
            style={{
              background: 'rgba(110,198,255,0.08)',
              border: '1px solid rgba(110,198,255,0.20)',
              color: 'rgba(238,240,255,0.65)',
            }}
          >
            <span style={{ color: '#6ec6ff', flexShrink: 0, fontSize: 14 }}>ℹ</span>
            <span>
              <strong style={{ color: 'rgba(238,240,255,0.85)' }}>How this works:</strong>{' '}
              Take this offer to lock IRM in escrow. Make your payment to the seller using the method below. Submit payment proof in the Agreements page. Once verified, IRM is released automatically.
            </span>
          </div>

          {/* Amount — gradient hero */}
          <div className="mb-5 text-center">
            <div
              className="font-display font-bold text-4xl tabular-nums"
              style={{
                background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {formatIRM(offer.amount)}
            </div>
            <div className="text-xs text-white/40 mt-1 font-mono">
              {offer.amount.toLocaleString('en-US')} sats
            </div>
          </div>

          {/* Seller — full address, no truncation */}
          {offer.seller && (
            <div className="mb-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Seller Address</p>
              <p className="font-mono text-xs text-white/80 break-all">{offer.seller}</p>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
            {offer.payment_method && (
              <div>
                <p className="text-white/40 uppercase tracking-wider mb-1">Payment Method</p>
                <span className="badge badge-info text-[10px]">{offer.payment_method}</span>
              </div>
            )}
            {offer.timeout_height != null && (
              <div>
                <p className="text-white/40 uppercase tracking-wider mb-1">Timeout Height</p>
                <p className="font-mono text-white/80">#{offer.timeout_height.toLocaleString('en-US')}</p>
              </div>
            )}
            {offer.created_at && (
              <div>
                <p className="text-white/40 uppercase tracking-wider mb-1">Created</p>
                <p className="font-mono text-white/80">{timeAgo(offer.created_at)}</p>
              </div>
            )}
            {offer.status && (
              <div>
                <p className="text-white/40 uppercase tracking-wider mb-1">Status</p>
                <span className="badge badge-info text-[10px] capitalize">{offer.status}</span>
              </div>
            )}
          </div>

          {/* Full description */}
          {offer.description && (
            <div className="mb-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Description</p>
              <p className="text-sm text-white/70 whitespace-pre-wrap">{offer.description}</p>
            </div>
          )}

          {/* Reputation */}
          {(offer.reputation || offer.risk_signal || offer.ranking_score !== undefined) && (
            <div className="mb-5 glass rounded-lg p-3">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Seller Reputation</p>
              <div className="space-y-2 text-xs">
                {offer.reputation?.score !== undefined && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.40)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${score}%`,
                            background: score > 80 ? '#22c55e' : score > 60 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                    </div>
                    <span className="font-mono text-white/70 flex-shrink-0">{score}/100</span>
                  </div>
                )}
                {offer.reputation?.completed !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-white/40">Completed trades</span>
                    <span className="font-mono text-white/70">{offer.reputation.completed}</span>
                  </div>
                )}
                {offer.ranking_score !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-white/40">Ranking score</span>
                    <span className="font-mono text-white/70">{offer.ranking_score}</span>
                  </div>
                )}
                {offer.risk_signal && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/40">Risk signal</span>
                    <span className={`badge ${riskClass} text-[10px] capitalize`}>{offer.risk_signal}</span>
                  </div>
                )}
                {offer.risk_signal && (
                  <p className="text-[11px] text-white/45 pt-1 border-t border-white/5">{riskExplanation}</p>
                )}
                {offer.seller && (
                  <div className="pt-2 border-t border-white/5">
                    <button
                      onClick={() => {
                        onClose();
                        navigate('/reputation', { state: { prefillAddress: offer.seller } });
                      }}
                      className="text-xs text-irium-400 hover:text-irium-300 flex items-center gap-1"
                    >
                      <Star size={11} /> View full reputation →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className={isOwnOffer ? 'btn-primary flex-1 justify-center' : 'btn-secondary flex-1 justify-center'}>
              Close
            </button>
            {/* Take Offer is hidden on the user's own offers — they
                can't trade with themselves. Taken offers swap to a
                grey Taken indicator so a buyer can't try to take
                from this entry point either. */}
            {!isOwnOffer && (
              offer.status === 'taken' ? (
                <span
                  className="flex-1 inline-flex items-center justify-center text-xs font-bold rounded uppercase py-2 px-4"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    color: 'rgba(255,255,255,0.50)',
                    letterSpacing: '0.10em',
                  }}
                  title="This offer has already been taken by another buyer."
                >
                  Taken
                </span>
              ) : (
                <button
                  onClick={onTake}
                  disabled={!isOnline}
                  title={!isOnline ? 'Node must be online to take offers' : undefined}
                  className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Take Offer
                </button>
              )
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Discover Feeds Modal (Phase 7) ────────────────────────────
// Calls feedOps.discover() on mount. Renders the returned list of feed
// URLs; each row offers an Add button unless the URL is already in the
// user's feed registry. Stays open across adds so the user can grab
// multiple. Refreshes the parent feed list whenever an add succeeds.

function DiscoverFeedsModal({
  existingUrls,
  onClose,
  onAfterAdd,
}: {
  existingUrls: Set<string>;
  onClose: () => void;
  onAfterAdd: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [addedLocally, setAddedLocally] = useState<Set<string>>(new Set());
  const [addingUrl, setAddingUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await feedOps.discover();
        if (!mounted) return;
        setDiscovered(Array.isArray(r.discovered) ? r.discovered : []);
      } catch (e) {
        if (mounted) setError(String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleAdd = async (url: string) => {
    setAddingUrl(url);
    try {
      await feeds.add(url);
      setAddedLocally((prev) => { const n = new Set(prev); n.add(url); return n; });
      toast.success('Feed added');
      onAfterAdd();
    } catch (e) {
      toast.error('Failed to add: ' + String(e));
    } finally {
      setAddingUrl(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="discover-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          key="discover-modal"
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="card w-full max-w-lg p-6 rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
              <Compass size={16} className="text-irium-400" /> Discover Feeds
            </h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          <p className="text-xs text-white/45 mb-4">
            The wallet binary scans the network for seller feed URLs and lists them below.
            Add the ones you want to follow — each Add registers the feed with your local registry.
          </p>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="shimmer h-12 rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-300 text-sm">{error}</div>
          ) : discovered.length === 0 ? (
            <div className="text-center py-8 text-white/40 text-sm">No feeds discovered yet.</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {discovered.map((url) => {
                const isExisting = existingUrls.has(url) || addedLocally.has(url);
                return (
                  <div key={url} className="glass rounded-lg p-3 flex items-center gap-3">
                    <Globe size={14} className="text-irium-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0 font-mono text-xs text-white/70 truncate" title={url}>{url}</div>
                    {isExisting ? (
                      <span className="badge badge-success text-[10px]">Already added</span>
                    ) : (
                      <button
                        onClick={() => handleAdd(url)}
                        disabled={addingUrl === url}
                        className="btn-primary text-xs py-1 px-3 flex-shrink-0 disabled:opacity-40"
                      >
                        {addingUrl === url ? <RefreshCw size={11} className="animate-spin" /> : 'Add'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end mt-5">
            <button onClick={onClose} className="btn-secondary">Done</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

