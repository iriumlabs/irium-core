import React, { useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Filter,
  Search,
  Globe,
  Star,
  Shield,
  AlertTriangle,
  Rss,
  X,
  ChevronDown,
} from "lucide-react";
import { offers, feeds } from "../lib/tauri";
import { formatIRM, IRMToSats, timeAgo, truncateAddr } from "../lib/types";
import type { Offer, FeedEntry, FeedSyncResult } from "../lib/types";
import { useStore } from "../lib/store";

type Tab = "browse" | "my-offers" | "feeds";
type SortMode = "newest" | "amount" | "score";
type SourceMode = "local" | "remote" | "all";

export default function MarketplacePage() {
  const [tab, setTab] = useState<Tab>("browse");

  return (
    <div className="flex flex-col h-full page-enter">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-0 border-b border-white/5 flex-shrink-0">
        <div className="flex gap-1">
          {(["browse", "my-offers", "feeds"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-display font-semibold rounded-t-lg border-b-2 transition-all ${
                tab === t
                  ? "text-white border-irium-500"
                  : "text-white/40 border-transparent hover:text-white/70"
              }`}
            >
              {t === "browse" ? "Browse Offers" : t === "my-offers" ? "My Offers" : "Feed Registry"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "browse" && <BrowseTab />}
        {tab === "my-offers" && <MyOffersTab />}
        {tab === "feeds" && <FeedsTab />}
      </div>
    </div>
  );
}

function BrowseTab() {
  const [allOffers, setAllOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceMode>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [search, setSearch] = useState("");
  const [showTakeModal, setShowTakeModal] = useState<Offer | null>(null);
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    loadOffers();
  }, [source, sort]);

  const loadOffers = async () => {
    setLoading(true);
    try {
      const data = await offers.list({ source, sort, limit: 50 });
      setAllOffers(data);
    } catch (e) {
      addNotification({ type: "error", title: "Failed to load offers", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const filtered = allOffers.filter((o) => {
    if (!search) return true;
    return (
      o.id.toLowerCase().includes(search.toLowerCase()) ||
      o.description?.toLowerCase().includes(search.toLowerCase()) ||
      o.seller?.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            className="input pl-8"
            placeholder="Search offers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={source}
          onChange={(v) => setSource(v as SourceMode)}
          options={[
            { value: "all", label: "All Sources" },
            { value: "local", label: "Local Only" },
            { value: "remote", label: "Remote Feeds" },
          ]}
        />
        <Select
          value={sort}
          onChange={(v) => setSort(v as SortMode)}
          options={[
            { value: "newest", label: "Newest First" },
            { value: "score", label: "By Score" },
            { value: "amount", label: "By Amount" },
          ]}
        />
        <button onClick={loadOffers} className="btn-ghost" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Offer grid */}
      {loading ? (
        <div className="text-center py-16 text-white/30 text-sm">Loading offers...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30 text-sm">
          No offers found.{" "}
          {source === "remote" && "Try syncing your feeds first."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              onTake={() => setShowTakeModal(offer)}
            />
          ))}
        </div>
      )}

      {showTakeModal && (
        <TakeOfferModal
          offer={showTakeModal}
          onClose={() => setShowTakeModal(null)}
          onSuccess={() => { setShowTakeModal(null); loadOffers(); }}
        />
      )}
    </div>
  );
}

function OfferCard({ offer, onTake }: { offer: Offer; onTake: () => void }) {
  const risk = offer.risk_signal ?? "unknown";
  const riskIcon = risk === "high" ? <AlertTriangle size={12} className="text-red-400" /> :
                   risk === "medium" ? <AlertTriangle size={12} className="text-amber-400" /> :
                   risk === "low" ? <Shield size={12} className="text-green-400" /> : null;

  return (
    <div className="card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs text-white/40 truncate">{offer.id}</div>
          {offer.seller && (
            <div className="font-mono text-xs text-white/60 truncate mt-0.5">
              {truncateAddr(offer.seller)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {riskIcon}
          {offer.reputation?.score !== undefined && (
            <span className="text-xs text-white/40">
              <Star size={10} className="inline text-amber-400" /> {offer.reputation.score.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Amount */}
      <div>
        <div className="font-display font-bold text-lg gradient-text">{formatIRM(offer.amount)}</div>
        {offer.description && (
          <div className="text-white/50 text-xs mt-0.5 line-clamp-2">{offer.description}</div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-white/30">
          {offer.payment_method && <span className="badge badge-irium">{offer.payment_method}</span>}
          {offer.created_at && <span>{timeAgo(offer.created_at)}</span>}
        </div>
        <button onClick={onTake} className="btn-primary py-1.5 px-3 text-xs">
          Take Offer
        </button>
      </div>
    </div>
  );
}

function MyOffersTab() {
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    loadMyOffers();
  }, []);

  const loadMyOffers = async () => {
    setLoading(true);
    try {
      const data = await offers.list({ source: "local" });
      setMyOffers(data);
    } catch {}
    setLoading(false);
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-white/90">My Offers</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={14} />
          Create Offer
        </button>
      </div>
      {loading ? (
        <div className="text-center py-16 text-white/30">Loading...</div>
      ) : myOffers.length === 0 ? (
        <div className="text-center py-16 text-white/30 text-sm">No offers yet.</div>
      ) : (
        <div className="space-y-2">
          {myOffers.map((o) => (
            <div key={o.id} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-white/60 truncate">{o.id}</div>
                <div className="font-display font-semibold text-sm text-white mt-0.5">{formatIRM(o.amount)}</div>
              </div>
              <span className="badge badge-irium">{o.status ?? "open"}</span>
            </div>
          ))}
        </div>
      )}
      {showCreate && (
        <CreateOfferModal onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); loadMyOffers(); }} />
      )}
    </div>
  );
}

function FeedsTab() {
  const [feedList, setFeedList] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [syncResult, setSyncResult] = useState<FeedSyncResult | null>(null);
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    loadFeeds();
  }, []);

  const loadFeeds = async () => {
    setLoading(true);
    try {
      const data = await feeds.list();
      setFeedList(data);
    } catch {}
    setLoading(false);
  };

  const addFeed = async () => {
    if (!newUrl) return;
    try {
      await feeds.add(newUrl);
      setNewUrl("");
      addNotification({ type: "success", title: "Feed added" });
      await loadFeeds();
    } catch (e) {
      addNotification({ type: "error", title: "Failed to add feed", message: String(e) });
    }
  };

  const removeFeed = async (url: string) => {
    try {
      await feeds.remove(url);
      await loadFeeds();
    } catch (e) {
      addNotification({ type: "error", title: "Failed to remove feed", message: String(e) });
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    try {
      const result = await feeds.sync();
      setSyncResult(result);
      addNotification({
        type: "success",
        title: "Feed sync complete",
        message: `${result.total_offers} offers from ${result.synced} feeds`,
      });
    } catch (e) {
      addNotification({ type: "error", title: "Sync failed", message: String(e) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-semibold text-white/90">Feed Registry</h2>
          <p className="text-white/30 text-xs mt-0.5">Add seller feeds to discover remote offers</p>
        </div>
        <button onClick={syncAll} className="btn-primary" disabled={syncing}>
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          Sync All Feeds
        </button>
      </div>

      {syncResult && (
        <div className="card p-3 flex items-center gap-3 text-sm">
          <Rss size={16} className="text-irium-400" />
          <span className="text-white/60">
            Last sync: <span className="text-white">{syncResult.total_offers}</span> offers from{" "}
            <span className="text-white">{syncResult.synced}</span> feeds
            {syncResult.failed > 0 && <span className="text-red-400"> ({syncResult.failed} failed)</span>}
          </span>
        </div>
      )}

      {/* Add feed */}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="http://seller-node:38300/offers/feed"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFeed()}
        />
        <button onClick={addFeed} disabled={!newUrl} className="btn-primary flex-shrink-0">
          <Plus size={14} />
          Add
        </button>
      </div>

      {/* Feed list */}
      {loading ? (
        <div className="text-center py-8 text-white/30">Loading feeds...</div>
      ) : feedList.length === 0 ? (
        <div className="text-center py-8 text-white/30 text-sm">
          No feeds registered. Add a seller's feed URL to discover their offers.
        </div>
      ) : (
        <div className="space-y-2">
          {feedList.map((f) => (
            <div key={f.url} className="card p-3 flex items-center gap-3 group">
              <Globe size={16} className="text-irium-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-white/70 truncate">{f.url}</div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-white/30">
                  {f.offer_count !== undefined && <span>{f.offer_count} offers</span>}
                  {f.last_synced && <span>synced {timeAgo(f.last_synced)}</span>}
                  {f.status && (
                    <span className={f.status === "ok" ? "text-green-400" : "text-red-400"}>
                      {f.status}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeFeed(f.url)}
                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MODALS
// ============================================================

function TakeOfferModal({
  offer,
  onClose,
  onSuccess,
}: {
  offer: Offer;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const handleTake = async () => {
    setLoading(true);
    try {
      const result = await offers.take(offer.id);
      addNotification({
        type: "success",
        title: "Offer taken!",
        message: `Agreement: ${result.agreement_id}`,
      });
      onSuccess();
    } catch (e) {
      addNotification({ type: "error", title: "Failed to take offer", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-sm p-6">
        <h2 className="font-display font-bold text-lg text-white mb-4">Take This Offer</h2>
        <div className="space-y-3 mb-5">
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Offer ID</span>
            <span className="font-mono text-xs text-white/70">{offer.id}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Amount</span>
            <span className="font-display font-semibold gradient-text">{formatIRM(offer.amount)}</span>
          </div>
          {offer.seller && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Seller</span>
              <span className="font-mono text-xs text-white/60">{truncateAddr(offer.seller)}</span>
            </div>
          )}
          {offer.description && (
            <div className="text-white/40 text-xs bg-surface-700 rounded p-2">{offer.description}</div>
          )}
        </div>
        <div className="text-xs text-white/30 mb-4">
          Taking this offer will auto-create a policy and agreement. The seller's pubkey is embedded in the offer.
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button onClick={handleTake} disabled={loading} className="btn-primary flex-1 justify-center">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateOfferModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [payment, setPayment] = useState("");
  const [offerId, setOfferId] = useState("");
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const submit = async () => {
    if (!amount) return;
    setLoading(true);
    try {
      const result = await offers.create({
        amount_sats: IRMToSats(parseFloat(amount)),
        description: desc || undefined,
        payment_method: payment || undefined,
        offer_id: offerId || undefined,
      });
      addNotification({ type: "success", title: "Offer created", message: result.id });
      onSuccess();
    } catch (e) {
      addNotification({ type: "error", title: "Failed to create offer", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-lg text-white">Create Offer</h2>
          <button onClick={onClose} className="btn-ghost text-white/40">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Amount (IRM)</label>
            <input className="input" type="number" min="0" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input className="input" placeholder="What are you selling?" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div>
            <label className="label">Payment Method (optional)</label>
            <input className="input" placeholder="bank-transfer, crypto, etc." value={payment} onChange={(e) => setPayment(e.target.value)} />
          </div>
          <div>
            <label className="label">Offer ID (optional, auto-generated if empty)</label>
            <input className="input font-mono" placeholder="my-offer-001" value={offerId} onChange={(e) => setOfferId(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button onClick={submit} disabled={!amount||loading} className="btn-primary flex-1 justify-center">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Minimal select
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input appearance-none pr-7 cursor-pointer"
        style={{ paddingRight: "1.75rem" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
      />
    </div>
  );
}
