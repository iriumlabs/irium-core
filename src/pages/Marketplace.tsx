import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Search, Globe, X, Rss, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { offers, feeds } from '../lib/tauri';
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

// ─── Offer Card ────────────────────────────────────────────────
function OfferCard({ offer, onTake }: { offer: Offer; onTake: () => void }) {
  const [hovered, setHovered] = useState(false);
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
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="card p-4 relative overflow-hidden cursor-pointer group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="font-mono text-xs text-white/40 truncate flex-1">{offer.id}</div>
        <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
          {offer.risk_signal && (
            <span className={`badge ${riskBadge} text-[10px]`}>{offer.risk_signal}</span>
          )}
          {offer.ranking_score !== undefined && (
            <span className="badge badge-irium text-[10px]">⭐ {offer.ranking_score}</span>
          )}
        </div>
      </div>

      {/* Seller */}
      {offer.seller && (
        <div className="mb-2">
          <div className="font-mono text-[11px] text-white/30">
            {truncateAddr(offer.seller, 8, 6)}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/reputation', { state: { prefillAddress: offer.seller } });
            }}
            className="text-[10px] text-irium-400 hover:text-irium-300 mt-1 flex items-center gap-1 transition-colors"
          >
            <Star size={10} /> View Seller Reputation
          </button>
        </div>
      )}

      {/* Amount */}
      <div className="font-display font-bold text-2xl gradient-text mb-1">
        {formatIRM(offer.amount)}
      </div>

      {/* Description */}
      {offer.description && (
        <div className="text-white/50 text-xs mb-3 line-clamp-2">{offer.description}</div>
      )}

      {/* Payment method + time */}
      <div className="flex items-center gap-2 mb-3">
        {offer.payment_method && (
          <span className="badge badge-info text-[10px]">{offer.payment_method}</span>
        )}
        {offer.created_at && (
          <span className="text-white/30 text-[10px]">{timeAgo(offer.created_at)}</span>
        )}
      </div>

      {/* Reputation score bar */}
      {offer.reputation?.score !== undefined && (
        <div className="mb-3">
          <div className="h-1 bg-surface-600 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: score > 80 ? '#22c55e' : score > 60 ? '#f59e0b' : '#ef4444',
              }}
              initial={{ width: 0 }}
              animate={{ width: `${score}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <div className="text-[10px] text-white/30 mt-0.5">
            {offer.reputation.completed ?? 0} completed
          </div>
        </div>
      )}

      {/* Take Offer button — slides up on hover */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-surface-800 to-transparent"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTake();
              }}
              className="btn-primary w-full justify-center py-2 text-xs"
            >
              Take Offer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Take Offer Modal ──────────────────────────────────────────
function TakeOfferModal({
  offer,
  onClose,
  onSuccess,
}: {
  offer: Offer;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [takingOffer, setTakingOffer] = useState(false);

  const handleTake = async () => {
    setTakingOffer(true);
    try {
      const result = await offers.take(offer.id);
      toast.success('Offer taken! Agreement: ' + result.agreement_id);
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

          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button
              onClick={handleTake}
              disabled={takingOffer}
              className="btn-primary flex-1 justify-center"
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
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    amount: '',
    desc: '',
    paymentMethod: '',
    id: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.amount) return;
    setLoading(true);
    try {
      const result = await offers.create({
        amount_sats: Math.round(parseFloat(form.amount) * SATS_PER_IRM),
        description: form.desc || undefined,
        payment_method: form.paymentMethod || undefined,
        offer_id: form.id || undefined,
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
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          key="create-modal"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          className="card w-full max-w-lg p-6 rounded-b-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white">Create Offer</h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Amount (IRM)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                placeholder="0.0000"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <input
                className="input"
                placeholder="What are you selling?"
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
                Create
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
  const [addFeedUrl, setAddFeedUrl] = useState('');
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [removingFeed, setRemovingFeed] = useState<string | null>(null);

  // ── Data loaders ─────────────────────────────────────────────
  const loadOffers = async () => {
    setLoading(true);
    try {
      const data = await offers.list({ source: filterSource, sort: filterSort, limit: 50 });
      setOfferList(data);
    } catch (e) {
      toast.error('Failed to load offers: ' + String(e));
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
      toast.error('Failed to load your offers: ' + String(e));
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
      toast.error('Failed to load feeds: ' + String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'browse') loadOffers();
    else if (activeTab === 'my-offers') loadMyOffers();
    else if (activeTab === 'feeds') loadFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'browse') loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSource, filterSort]);

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
  const filteredOffers = offerList
    .filter((o) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          o.description?.toLowerCase().includes(q) ||
          o.payment_method?.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q)
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
      className="h-full overflow-y-auto p-6 space-y-5"
    >
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

          {/* Offer grid */}
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="shimmer h-20 rounded" />
                </div>
              ))}
            </div>
          ) : filteredOffers.length === 0 ? (
            <div className="text-center py-20 text-white/30 text-sm">
              No offers found.{filterSource === 'remote' && ' Try syncing your feeds first.'}
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              {filteredOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  onTake={() => setShowTakeModal(offer)}
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
            <button onClick={() => setShowCreateModal(true)} className="btn-primary">
              <Plus size={14} className="mr-1" />
              Create Offer
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
              className="grid grid-cols-1 lg:grid-cols-2 gap-4"
            >
              {myOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  onTake={() => setShowTakeModal(offer)}
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
            <div className="text-center py-20 text-white/30 text-sm">
              <Rss size={32} className="mx-auto mb-3 opacity-30" />
              No feeds registered. Add a seller feed URL to discover their offers.
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
          onClose={() => setShowTakeModal(null)}
          onSuccess={() => {
            setShowTakeModal(null);
            if (activeTab === 'browse') loadOffers();
            else if (activeTab === 'my-offers') loadMyOffers();
          }}
        />
      )}

      {showCreateModal && (
        <CreateOfferModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadMyOffers();
          }}
        />
      )}
    </motion.div>
  );
}
