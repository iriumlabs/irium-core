import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  Loader2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";
import { useStore } from "../lib/store";
import { wallet } from "../lib/tauri";
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
  const [addresses, setAddresses] = useState<AddressInfo[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

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

  const handleNewAddress = async () => {
    try {
      const addr = await wallet.newAddress();
      toast.success("New address: " + addr.slice(0, 16) + "...");
      loadData();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const selectedAddress = addresses[0]?.address ?? "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="p-6 space-y-6">
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
                className="btn-primary gap-2"
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
                {addresses.map((addr) => (
                  <motion.div
                    key={addr.address}
                    variants={itemVariants}
                    className="card-interactive p-4"
                  >
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
        {/* Direction icon */}
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

        {/* Details */}
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

        {/* Amount */}
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
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 glass-heavy rounded-t-2xl z-50 p-6 max-w-lg mx-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-lg text-white">
            Send IRM
          </h2>
          <button onClick={onClose} className="btn-ghost text-white/40 p-1">
            <X size={16} />
          </button>
        </div>

        {/* Step content with AnimatePresence */}
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
              {/* To address */}
              <div>
                <label className="label">To Address</label>
                <input
                  className="input"
                  placeholder="Recipient address…"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                />
              </div>

              {/* Amount */}
              <div>
                <label className="label">Amount (IRM)</label>
                <input
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
                    ={" "}
                    {Math.round(
                      parseFloat(sendAmountIrm) * SATS_PER_IRM
                    ).toLocaleString()}{" "}
                    sats
                  </div>
                )}
              </div>

              {/* Fee estimate */}
              <div className="text-white/30 text-xs font-mono">
                Estimated fee: ~1,000 sats
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setSendStep("confirm")}
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
              {/* Summary */}
              <div className="card p-4 space-y-3">
                <div className="text-white/50 text-sm font-display">
                  Send{" "}
                  <span className="gradient-text font-bold">
                    {sendAmountIrm} IRM
                  </span>{" "}
                  to
                </div>
                <div className="font-mono text-sm text-white/80 break-all">
                  {truncateAddr(sendTo)}
                </div>
                <div className="border-t border-white/5 pt-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-white/40">
                    <span>Amount (sats)</span>
                    <span className="font-mono">
                      {Math.round(
                        parseFloat(sendAmountIrm) * SATS_PER_IRM
                      ).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-white/40">
                    <span>Estimated fee</span>
                    <span className="font-mono">~1,000 sats</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
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
                  {sendLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  Confirm Send
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
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
  return (
    <>
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 glass-heavy rounded-t-2xl z-50 p-6 max-w-lg mx-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-lg text-white">
            Receive IRM
          </h2>
          <button onClick={onClose} className="btn-ghost text-white/40 p-1">
            <X size={16} />
          </button>
        </div>

        {/* Address display */}
        <div className="text-center space-y-4">
          <div className="text-white/40 text-sm">
            Send IRM to this address:
          </div>

          {/* QR placeholder */}
          <div className="w-48 h-48 border-2 border-irium-500/30 rounded-xl flex items-center justify-center mx-auto my-4 glass">
            <div className="font-mono text-[8px] text-white/30 text-center break-all px-2">
              {address}
            </div>
          </div>

          {/* Address text */}
          <div className="font-mono text-sm text-white/80 bg-surface-700 rounded-lg p-3 break-all">
            {address || "No address available"}
          </div>

          {/* Copy button */}
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
    </>
  );
}
