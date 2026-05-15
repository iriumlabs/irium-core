import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Search, Globe, X, Rss, Star, Download, Upload, Compass, HelpCircle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { offers, feeds, feedOps } from '../lib/tauri';
import { useIriumEvents } from '../lib/hooks';
import NodeOfflineBanner from '../components/NodeOfflineBanner';
import { formatIRM, timeAgo, truncateAddr, SATS_PER_IRM } from '../lib/types';
import type { Offer, FeedEntry } from '../lib/types';

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
function OfferCard({ offer, onTake, onOpenDetail, onExport, onDelete, isOnline }: { offer: Offer; onTake: () => void; onOpenDetail: () => void; onExport?: () => void; onDelete?: () => void; isOnline: boolean }) {
  const navigate = useNavigate();
  const score = offer.reputation?.score ?? 0;
  const riskBadge =
    offer.risk_signal === 'low'
      ? 'badge-success'
      : offer.risk_signal === 'medium'
      ? 'badge-warning'
      : 'badge-error';

  return (
    <motion.div
      variants={itemVariants}
      onClick={onOpenDetail}
      className="card-interactive flex items-center gap-4 px-4 py-3.5 cursor-pointer"
    >
      {/* Left: id, seller, optional description — flexes to fill */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[11px] text-white/55 truncate">{offer.id}</span>
          {offer.payment_method && (
            <span className="badge badge-info text-[9px]">{offer.payment_method}</span>
          )}
          {offer.risk_signal && (
            <span
              className={`badge ${riskBadge} text-[9px]`}
              title={
                offer.risk_signal === 'low'
                  ? 'Low risk — seller has a clean recent record (no sybil suppression, no disputes ≥10%).'
                  : offer.risk_signal === 'medium'
                  ? 'Medium risk — limited reputation history or some warning signals. Inspect the seller before trading.'
                  : 'High risk — sybil-suppressed, self-trading, or disputes ≥10%. Trade with caution.'
              }
            >
              {offer.risk_signal}
            </span>
          )}
          {offer.ranking_score !== undefined && (
            <span className="badge badge-irium text-[9px]">⭐ {offer.ranking_score}</span>
          )}
        </div>
        {offer.seller && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-white/35">{truncateAddr(offer.seller, 8, 6)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/reputation', { state: { prefillAddress: offer.seller } });
              }}
              className="text-[10px] text-irium-400 hover:text-irium-300 flex items-center gap-1 transition-colors"
            >
              <Star size={9} /> reputation
            </button>
            {offer.created_at && (
              <span className="text-[10px] text-white/30">· {timeAgo(offer.created_at)}</span>
            )}
          </div>
        )}
        {offer.description && (
          <div className="text-white/45 text-[11px] mt-1 line-clamp-1">{offer.description}</div>
        )}
        {/* Reputation score bar */}
        {offer.reputation?.score !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="h-1 flex-1 max-w-[140px] rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.40)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: score > 80 ? '#22c55e' : score > 60 ? '#f59e0b' : '#ef4444' }}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <span className="text-[9px] text-white/35">{offer.reputation.completed ?? 0} completed</span>
          </div>
        )}
      </div>

      {/* Center: amount in brand-gradient */}
      <div
        className="font-display font-bold text-lg tabular-nums flex-shrink-0"
        style={{
          background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          letterSpacing: '0.01em',
        }}
      >
        {formatIRM(offer.amount)}
      </div>

      {/* Right: Export (My Offers only) + Delete (My Offers only) + Take Offer */}
      {onExport && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
          title="Export this offer as JSON to share with a buyer"
          className="btn-ghost text-xs p-1.5 flex-shrink-0 text-irium-400 hover:text-irium-300"
        >
          <Download size={13} />
        </button>
      )}
      {onDelete && (!offer.status || offer.status === 'open') && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete this offer from your local store"
          className="btn-ghost text-xs p-1.5 flex-shrink-0 text-red-400 hover:text-red-300"
        >
          <Trash2 size={13} />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTake();
        }}
        disabled={!isOnline}
        title={!isOnline ? 'Node must be online to take offers' : undefined}
        className="btn-primary text-xs py-1.5 px-4 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Take Offer
      </button>
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
            <h2 className="font-display font-bold text-lg text-white">Take This Offer</h2>
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
  const [form, setForm] = useState({
    amount: '',
    desc: '',
    paymentMethod: '',
    id: '',
    // Pre-fill with the currently selected wallet address. Blank is accepted —
    // the backend falls back to the wallet's first derived address.
    sellerAddress: defaultSellerAddress,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.amount) return;
    setLoading(true);
    try {
      const trimmedSeller = form.sellerAddress.trim();
      const result = await offers.create({
        amount_sats: Math.round(parseFloat(form.amount) * SATS_PER_IRM),
        description: form.desc || undefined,
        payment_method: form.paymentMethod || undefined,
        offer_id: form.id || undefined,
        seller_address: trimmedSeller.length > 0 ? trimmedSeller : undefined,
      });
      toast.success('Offer created: ' + result.id);
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
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-bold text-lg text-white">Create Sell Offer</h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          {/* Escrow notice */}
          <div
            className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-5 text-xs"
            style={{
              background: 'rgba(110,198,255,0.08)',
              border: '1px solid rgba(110,198,255,0.20)',
              color: 'rgba(238,240,255,0.55)',
            }}
          >
            <span style={{ color: '#A78BFA', flexShrink: 0, fontSize: 14 }}>🔒</span>
            <span>
              The IRM amount is <strong style={{ color: 'rgba(238,240,255,0.8)' }}>locked in on-chain escrow</strong> the moment your offer is created. When a buyer takes the offer and their payment proof is accepted, the funds are automatically released to them.
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
              <label className="label">Price / Notes (optional)</label>
              <input
                className="input"
                placeholder="e.g. 1 IRM = $0.50 USD via PayPal"
                value={form.desc}
                onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Payment Method (optional)</label>
              <input
                className="input"
                placeholder="bank-transfer, crypto, etc."
                value={form.paymentMethod}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
              />
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
            <div className="flex gap-3 pt-1">
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
  const [feedList, setFeedList] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
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

  // ── Data loaders ─────────────────────────────────────────────
  const loadOffers = async () => {
    setLoading(true);
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
      setOfferList(data);
    } catch (e) {
      // Suppress toast when offline — empty state communicates the problem.
      if (nodeStatus?.running) {
        toast.error('Failed to load offers: ' + String(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const loadMyOffers = async () => {
    setLoading(true);
    try {
      const data = await offers.list({ source: 'local' });
      setMyOffers(data);
    } catch (e) {
      if (nodeStatus?.running) {
        toast.error('Failed to load your offers: ' + String(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const loadFeeds = async () => {
    setLoading(true);
    try {
      const data = await feeds.list();
      setFeedList(data);
    } catch (e) {
      if (nodeStatus?.running) {
        toast.error('Failed to load feeds: ' + String(e));
      }
    } finally {
      setLoading(false);
    }
  };

  // Single effect handles initial load + tab changes + filter changes.
  // Merging prevents the second useEffect([filterSource, filterSort]) from
  // firing a redundant loadOffers() on mount, which caused 4 toast errors.
  // Browse-mode is debounced 400ms so per-keystroke min/max amount edits
  // don't fire an RPC per character; tab changes get the same 400ms but it
  // is barely perceptible.
  useEffect(() => {
    if (activeTab === 'browse') {
      const t = setTimeout(loadOffers, 400);
      return () => clearTimeout(t);
    }
    if (activeTab === 'my-offers') loadMyOffers();
    if (activeTab === 'feeds') loadFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filterSource, filterSort, filterMinIrm, filterMaxIrm, filterPayment]);

  // Phase 5: real-time refresh on offer.* events from the Rust WS bridge.
  // Polling stays as a fallback when the WS connection is down.
  useIriumEvents((event) => {
    if (event.type === 'offer.created' || event.type === 'offer.taken') {
      if (activeTab === 'browse') loadOffers();
      else if (activeTab === 'my-offers') loadMyOffers();
    }
  });

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
      toast.error('Failed to add feed: ' + String(e));
    }
  };

  const handleRemoveFeed = async (url: string) => {
    try {
      await feeds.remove(url);
      toast.success('Feed removed');
      setRemovingFeed(null);
      await loadFeeds();
    } catch (e) {
      toast.error('Failed to remove feed: ' + String(e));
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
      toast.success('Offer exported to ' + path);
    } catch (e) {
      toast.error('Export failed: ' + String(e));
    }
  };

  const handleDeleteOffer = async (offer: Offer) => {
    try {
      await offers.remove(offer.id);
      toast.success('Offer deleted');
      setShowDeleteOfferModal(null);
      await loadMyOffers();
    } catch (e) {
      toast.error('Delete failed: ' + String(e));
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
      toast.success('Offer imported');
      await loadMyOffers();
    } catch (e) {
      toast.error('Import failed: ' + String(e));
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
      toast.error('Sync failed: ' + String(e));
    } finally {
      setSyncing(false);
    }
  };

  // ── Filtered offers ──────────────────────────────────────────
  // Phase 8 — also match against the seller's full address so users can
  // grep for a known counterparty. Existing matches (description /
  // payment_method / id) are preserved.
  const filteredOffers = offerList
    .filter((o) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          o.description?.toLowerCase().includes(q) ||
          o.payment_method?.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.seller?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (filterSort === 'score') return (b.ranking_score ?? 0) - (a.ranking_score ?? 0);
      if (filterSort === 'amount') return b.amount - a.amount;
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    });

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
          <h1 className="page-title">Marketplace</h1>
          <p className="page-subtitle">Browse and post settlement offers on the Irium peer-to-peer network.</p>
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
              {filteredOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  onTake={() => setShowTakeModal(offer)}
                  onOpenDetail={() => setShowDetailModal(offer)}
                  isOnline={!!nodeStatus?.running}
                />
              ))}
            </motion.div>
          )}
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
                    toast.success('Default feeds added');
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
            loadMyOffers();
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
              <p className="text-xs text-white/40 mb-5">This removes it from your local store only. Buyers who already received this offer are not affected.</p>
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
  isOnline,
}: {
  offer: Offer;
  onClose: () => void;
  onTake: () => void;
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
              {offer.amount.toLocaleString()} sats
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
                <p className="font-mono text-white/80">#{offer.timeout_height.toLocaleString()}</p>
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
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">
              Close
            </button>
            <button
              onClick={onTake}
              disabled={!isOnline}
              title={!isOnline ? 'Node must be online to take offers' : undefined}
              className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Take Offer
            </button>
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

