import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  Loader2,
  X,
  Upload,
  FolderOpen,
  KeyRound,
  FileText,
  Hash,
} from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";
import { useStore } from "../lib/store";
import { wallet, config } from "../lib/tauri";
import {
  formatIRM,
  truncateAddr,
  timeAgo,
  SATS_PER_IRM,
} from "../lib/types";
import type { AddressInfo, Transaction, SendResult } from "../lib/types";

// ── Animation variants ────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ── Main page ─────────────────────────────────────────────────
export default function WalletPage() {
  const balance = useStore((s) => s.balance);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const nodeStatusRef = useRef(nodeStatus);
  useEffect(() => { nodeStatusRef.current = nodeStatus; }, [nodeStatus]);
  const [addresses, setAddresses] = useState<AddressInfo[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [addrs, transactions] = await Promise.allSettled([
        wallet.listAddresses(),
        wallet.transactions(20),
      ]);
      if (addrs.status === "fulfilled") setAddresses(addrs.value);
      if (transactions.status === "fulfilled") setTxs(transactions.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const openSend = () => {
      if (nodeStatusRef.current?.running) setShowSend(true);
      else toast.error('Node must be online to send transactions');
    };
    const openReceive = () => setShowReceive(true);
    window.addEventListener('irium:open-send', openSend);
    window.addEventListener('irium:open-receive', openReceive);
    return () => {
      window.removeEventListener('irium:open-send', openSend);
      window.removeEventListener('irium:open-receive', openReceive);
    };
  }, []);

  const handleNewAddress = async () => {
    try {
      const addr = await wallet.newAddress();
      toast.success("New address: " + addr.slice(0, 16) + "...");
      loadData();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDisconnectWallet = async () => {
    try {
      await config.setWalletConfig(null, settings.data_dir ?? null);
      updateSettings({ wallet_path: undefined });
      setAddresses([]);
      setTxs([]);
      toast.success("Wallet disconnected");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const selectedAddress = addresses[0]?.address ?? "";
  const walletFileName = settings.wallet_path
    ? settings.wallet_path.split(/[\\/]/).pop()
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* ── Balance Hero Card ─────────────────────────────── */}
        <div className="card p-8 relative overflow-hidden">
          {/* Animated bg orb */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 30% 40%, rgba(123,47,226,0.15) 0%, transparent 70%)",
              animation: "mesh-drift 20s ease-in-out infinite alternate",
            }}
          />

          {/* Content */}
          <div className="relative z-10">
            {/* Wallet file info bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {walletFileName ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-400" style={{ boxShadow: '0 0 6px rgba(74,222,128,0.6)' }} />
                    <span className="font-mono text-xs text-white/40">
                      {walletFileName}
                    </span>
                    {selectedAddress && (
                      <span className="font-mono text-xs text-white/25">
                        · {selectedAddress.slice(0, 8)}…{selectedAddress.slice(-6)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                    <span className="text-xs text-white/30">Default wallet</span>
                    {selectedAddress && (
                      <span className="font-mono text-xs text-white/25">
                        · {selectedAddress.slice(0, 8)}…{selectedAddress.slice(-6)}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowImport(true)}
                  className="btn-ghost py-1 px-2 text-xs gap-1.5 text-irium-300"
                >
                  <Upload size={11} /> Import
                </button>
                {walletFileName && (
                  <button
                    onClick={handleDisconnectWallet}
                    className="btn-ghost py-1 px-2 text-xs gap-1.5 text-white/30 hover:text-red-400"
                    title="Disconnect this wallet"
                  >
                    <X size={11} /> Disconnect
                  </button>
                )}
              </div>
            </div>

            <div className="text-white/40 text-sm font-display mb-2">
              Total Balance
            </div>

            {loading ? (
              <div className="shimmer h-12 w-48 rounded mb-2" />
            ) : (
              <>
                <div className="font-display font-bold text-5xl gradient-text mb-1">
                  {formatIRM(balance?.total ?? 0)}
                </div>
                <div className="font-mono text-white/30 text-sm mb-1">
                  {(balance?.total ?? 0).toLocaleString()} satoshis
                </div>
                {(balance?.unconfirmed ?? 0) > 0 && (
                  <div className="text-amber-400 text-sm">
                    +{formatIRM(balance!.unconfirmed)} unconfirmed
                  </div>
                )}
              </>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 mt-6 flex-wrap">
              <button
                onClick={() => setShowSend(true)}
                disabled={!nodeStatus?.running}
                title={!nodeStatus?.running ? 'Node must be online to send transactions' : undefined}
                className="btn-primary gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUpRight size={16} /> Send
              </button>
              <button
                onClick={() => setShowReceive(true)}
                className="btn-secondary gap-2"
              >
                <ArrowDownLeft size={16} /> Receive
              </button>
              <button
                onClick={handleNewAddress}
                className="btn-ghost gap-2"
              >
                <Plus size={16} /> New Address
              </button>
            </div>
          </div>
        </div>

        {/* ── Two-column layout ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Address list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-white/90">
                Addresses
              </h2>
              <span className="badge badge-irium">{addresses.length}</span>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="card p-4">
                    <div className="shimmer h-4 w-full rounded mb-2" />
                    <div className="shimmer h-3 w-24 rounded" />
                  </div>
                ))}
              </div>
            ) : addresses.length === 0 ? (
              <div className="card p-8 text-center text-white/30 text-sm">
                No addresses yet. Click "New Address" to get started.
              </div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              >
                {addresses.map((addr, idx) => (
                  <motion.div
                    key={addr.address}
                    variants={itemVariants}
                    className="card-interactive p-4"
                  >
                    {/* Primary badge on first address */}
                    {idx === 0 && (
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-irium-400" />
                        <span className="text-[10px] text-irium-400 font-display font-semibold uppercase tracking-wider">Primary</span>
                      </div>
                    )}
                    <div className="font-mono text-xs text-white/60 truncate">
                      {addr.address}
                    </div>
                    {addr.label && (
                      <div className="text-xs text-irium-400 mt-0.5">
                        {addr.label}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div className="font-display font-semibold text-sm">
                        {addr.balance !== undefined
                          ? formatIRM(addr.balance)
                          : "—"}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(addr.address);
                          toast.success("Address copied");
                        }}
                        className="btn-ghost p-1.5 text-white/40 hover:text-white"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>

          {/* Transaction list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-white/90">
                Transactions
              </h2>
              <span className="badge badge-irium">{txs.length}</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="card p-4">
                    <div className="shimmer h-4 w-full rounded mb-2" />
                    <div className="shimmer h-3 w-32 rounded" />
                  </div>
                ))}
              </div>
            ) : txs.length === 0 ? (
              <div className="card p-8 text-center text-white/30 text-sm">
                No transactions yet.
              </div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-2"
              >
                {txs.map((tx) => (
                  <TxRow key={tx.txid} tx={tx} />
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* ── Send Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {showSend && (
          <SendModal
            onClose={() => setShowSend(false)}
            onSuccess={() => {
              setShowSend(false);
              loadData();
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Receive Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showReceive && (
          <ReceiveModal
            address={selectedAddress}
            onClose={() => setShowReceive(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Import / Switch Wallet Modal ──────────────────────── */}
      <AnimatePresence>
        {showImport && (
          <ImportModal
            onClose={() => setShowImport(false)}
            onSuccess={() => {
              setShowImport(false);
              loadData();
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Transaction row ───────────────────────────────────────────
function TxRow({ tx }: { tx: Transaction }) {
  const isSend = tx.direction === "send";
  const borderColor = isSend
    ? "rgba(248,113,113,0.6)"
    : "rgba(74,222,128,0.6)";

  return (
    <motion.div
      variants={itemVariants}
      className="card p-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
      style={{ borderLeft: `3px solid ${borderColor}` }}
      onClick={() => {
        navigator.clipboard.writeText(tx.txid);
        toast.success("TX ID copied");
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
            isSend
              ? "bg-red-500/10 text-red-400"
              : "bg-green-500/10 text-green-400"
          )}
        >
          {isSend ? (
            <ArrowUpRight size={13} />
          ) : (
            <ArrowDownRight size={13} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs text-white/50 truncate">
            {tx.txid.slice(0, 16)}...
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-white/25">
              {tx.timestamp ? timeAgo(tx.timestamp) : "pending"}
            </span>
            <span
              className={clsx(
                "badge",
                tx.confirmations > 0 ? "badge-success" : "badge-warning"
              )}
            >
              {tx.confirmations} conf
            </span>
          </div>
        </div>

        <div
          className={clsx(
            "font-display font-semibold text-sm flex-shrink-0",
            isSend ? "text-red-400" : "text-green-400"
          )}
        >
          {isSend ? "−" : "+"}
          {formatIRM(Math.abs(tx.amount))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Import / Switch Wallet Modal ──────────────────────────────
type ImportTab = "mnemonic" | "wif" | "hex";

function ImportModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tab, setTab] = useState<ImportTab>("mnemonic");
  const [mnemonic, setMnemonic] = useState("");
  const [wif, setWif] = useState("");
  const [hexKey, setHexKey] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('irium:close-modal', handler);
    return () => window.removeEventListener('irium:close-modal', handler);
  }, [onClose]);

  const handleImport = async () => {
    setLoading(true);
    try {
      if (tab === "mnemonic") {
        const words = mnemonic.trim();
        if (words.split(/\s+/).length < 12) {
          toast.error("Enter at least 12 mnemonic words");
          setLoading(false);
          return;
        }
        await wallet.importMnemonic(words);
      } else if (tab === "wif") {
        if (!wif.trim()) { toast.error("Enter a WIF key"); setLoading(false); return; }
        await wallet.importWif(wif.trim());
      } else {
        if (!hexKey.trim()) { toast.error("Enter a hex private key"); setLoading(false); return; }
        await wallet.importPrivateKey(hexKey.trim());
      }
      toast.success("Wallet imported successfully");
      onSuccess();
    } catch (e) {
      toast.error(String(e));
      setLoading(false);
    }
  };

  const tabs: { id: ImportTab; label: string; icon: React.ReactNode }[] = [
    { id: "mnemonic", label: "Mnemonic", icon: <FileText size={13} /> },
    { id: "wif",      label: "WIF Key",  icon: <KeyRound size={13} /> },
    { id: "hex",      label: "Hex Key",  icon: <Hash size={13} /> },
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
              <Upload size={18} className="text-irium-400" /> Import Wallet
            </h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mb-5 p-1 bg-white/5 rounded-xl">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-display font-medium transition-all duration-150",
                  tab === t.id
                    ? "bg-irium-600/50 text-irium-200 shadow-sm"
                    : "text-white/40 hover:text-white/60"
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            {tab === "mnemonic" && (
              <motion.div
                key="mnemonic"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <label className="label">Recovery Phrase (12 or 24 words)</label>
                <textarea
                  autoFocus
                  rows={4}
                  className="input resize-none font-mono text-sm"
                  placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                />
                <p className="text-white/30 text-xs">
                  Enter your BIP39 recovery phrase separated by spaces.
                </p>
              </motion.div>
            )}

            {tab === "wif" && (
              <motion.div
                key="wif"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <label className="label">WIF Private Key</label>
                <input
                  autoFocus
                  className="input font-mono text-sm"
                  placeholder="5J… or K… or L…"
                  value={wif}
                  onChange={(e) => setWif(e.target.value)}
                />
                <p className="text-white/30 text-xs">
                  Wallet Import Format — starts with 5, K, or L.
                </p>
              </motion.div>
            )}

            {tab === "hex" && (
              <motion.div
                key="hex"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <label className="label">Hex Private Key</label>
                <input
                  autoFocus
                  className="input font-mono text-sm"
                  placeholder="64-character hex string"
                  value={hexKey}
                  onChange={(e) => setHexKey(e.target.value)}
                />
                <p className="text-white/30 text-xs">
                  32-byte private key as a 64-character hexadecimal string.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={loading}
              className="btn-primary flex-1 justify-center gap-2"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Import
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}

// ── Send Modal ────────────────────────────────────────────────
function SendModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [sendTo, setSendTo] = useState("");
  const [sendAmountIrm, setSendAmountIrm] = useState("");
  const [sendStep, setSendStep] = useState<"form" | "confirm">("form");
  const [sendLoading, setSendLoading] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);

  const validateAddress = (addr: string): boolean => {
    if (!addr) return false;
    if (!/^[QP]/.test(addr)) { setAddrError("Address must start with Q or P"); return false; }
    if (addr.length < 30 || addr.length > 40) { setAddrError("Invalid address length"); return false; }
    setAddrError(null);
    return true;
  };

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('irium:close-modal', handler);
    return () => window.removeEventListener('irium:close-modal', handler);
  }, [onClose]);

  const handleConfirmSend = async () => {
    if (!sendTo || !sendAmountIrm) return;
    setSendLoading(true);
    try {
      const amountSats = Math.round(parseFloat(sendAmountIrm) * SATS_PER_IRM);
      const result: SendResult = await wallet.send(sendTo, amountSats);
      toast.success("Transaction sent · " + result.txid.slice(0, 12));
      onSuccess();
    } catch (e) {
      toast.error(String(e));
      setSendLoading(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white">
              Send IRM
            </h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          <AnimatePresence mode="wait">
            {sendStep === "form" ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="send-to" className="label">
                    To Address <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="send-to"
                    autoFocus
                    className={`input ${addrError ? 'border-red-500/60' : ''}`}
                    placeholder="Q… or P… address"
                    value={sendTo}
                    onChange={(e) => { setSendTo(e.target.value); if (addrError) validateAddress(e.target.value); }}
                    onBlur={(e) => { if (e.target.value) validateAddress(e.target.value); }}
                  />
                  {addrError && (
                    <p className="text-red-400 text-xs mt-1">{addrError}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="send-amount" className="label">
                    Amount (IRM) <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="send-amount"
                    className="input"
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder="0.0000"
                    value={sendAmountIrm}
                    onChange={(e) => setSendAmountIrm(e.target.value)}
                  />
                  {sendAmountIrm && (
                    <div className="text-white/30 font-mono text-xs mt-1">
                      = {Math.round(parseFloat(sendAmountIrm) * SATS_PER_IRM).toLocaleString()} sats
                    </div>
                  )}
                </div>

                <div className="text-white/30 text-xs font-mono">
                  Estimated fee: ~1,000 sats
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={onClose} className="btn-secondary flex-1 justify-center">
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const amt = parseFloat(sendAmountIrm);
                      if (isNaN(amt) || amt <= 0) { toast.error('Enter a valid positive amount'); return; }
                      if (validateAddress(sendTo)) setSendStep("confirm");
                    }}
                    disabled={!sendTo || !sendAmountIrm}
                    className="btn-primary flex-1 justify-center"
                  >
                    Review →
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="card p-4 space-y-3">
                  <div className="text-white/50 text-sm font-display">
                    Send <span className="gradient-text font-bold">{sendAmountIrm} IRM</span> to
                  </div>
                  <div className="font-mono text-sm text-white/80 break-all">
                    {truncateAddr(sendTo)}
                  </div>
                  <div className="border-t border-white/5 pt-3 space-y-1.5">
                    <div className="flex justify-between text-xs text-white/40">
                      <span>Amount (sats)</span>
                      <span className="font-mono">
                        {Math.round(parseFloat(sendAmountIrm) * SATS_PER_IRM).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-white/40">
                      <span>Estimated fee</span>
                      <span className="font-mono">~1,000 sats</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setSendStep("form")}
                    className="btn-secondary flex-1 justify-center"
                    disabled={sendLoading}
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleConfirmSend}
                    disabled={sendLoading}
                    className="btn-primary flex-1 justify-center"
                  >
                    {sendLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                    Confirm Send
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}

// ── Receive Modal ─────────────────────────────────────────────
function ReceiveModal({
  address,
  onClose,
}: {
  address: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('irium:close-modal', handler);
    return () => window.removeEventListener('irium:close-modal', handler);
  }, [onClose]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="glass-heavy rounded-2xl p-6 w-full max-w-lg pointer-events-auto"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-bold text-lg text-white">
              Receive IRM
            </h2>
            <button onClick={onClose} className="btn-ghost text-white/40 p-1">
              <X size={16} />
            </button>
          </div>

          <div className="text-center space-y-4">
            <div className="text-white/40 text-sm">
              Send IRM to this address:
            </div>

            <div className="w-48 h-48 border-2 border-irium-500/30 rounded-xl flex items-center justify-center mx-auto my-4 glass">
              <div className="font-mono text-[8px] text-white/30 text-center break-all px-2">
                {address}
              </div>
            </div>

            <div className="font-mono text-sm text-white/80 bg-surface-700 rounded-lg p-3 break-all">
              {address || "No address available"}
            </div>

            <button
              onClick={() => {
                if (address) {
                  navigator.clipboard.writeText(address);
                  toast.success("Address copied");
                }
              }}
              className="btn-primary mx-auto gap-2"
              disabled={!address}
            >
              <Copy size={14} />
              Copy Address
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}
