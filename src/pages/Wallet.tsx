import React, { useEffect, useState } from "react";
import {
  Copy,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Check,
  RefreshCw,
  Send,
  Download,
  ExternalLink,
} from "lucide-react";
import { useStore } from "../lib/store";
import { wallet } from "../lib/tauri";
import {
  formatIRM,
  formatSats,
  truncateAddr,
  truncateHash,
  timeAgo,
  IRMToSats,
  SATS_PER_IRM,
} from "../lib/types";
import type { AddressInfo, Transaction, SendResult } from "../lib/types";

export default function WalletPage() {
  const balance = useStore((s) => s.balance);
  const [addresses, setAddresses] = useState<AddressInfo[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [addrs, transactions] = await Promise.allSettled([
        wallet.listAddresses(),
        wallet.transactions(20),
      ]);
      if (addrs.status === "fulfilled") setAddresses(addrs.value);
      if (transactions.status === "fulfilled") setTxs(transactions.value);
    } catch {}
    setLoading(false);
  };

  const handleNewAddress = async () => {
    try {
      const addr = await wallet.newAddress();
      addNotification({ type: "success", title: "New address created", message: addr });
      await loadData();
    } catch (e) {
      addNotification({ type: "error", title: "Error", message: String(e) });
    }
  };

  return (
    <div className="p-6 space-y-6 page-enter overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Wallet</h1>
          <p className="text-white/40 text-sm mt-0.5">Manage your IRM</p>
        </div>
        <button onClick={loadData} className="btn-ghost" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Balance hero */}
      <div
        className="relative rounded-2xl p-6 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(123,47,226,0.2) 0%, rgba(37,99,235,0.15) 100%)",
          border: "1px solid rgba(123,47,226,0.3)",
        }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(ellipse at 80% 20%, rgba(123,47,226,0.4) 0%, transparent 60%)`,
          }}
        />
        <div className="relative">
          <div className="text-white/50 text-sm font-display mb-1">Total Balance</div>
          <div className="font-display font-bold text-4xl gradient-text">
            {balance ? formatIRM(balance.total) : "—"}
          </div>
          {balance && (
            <div className="text-white/30 font-mono text-sm mt-1">
              {balance.total.toLocaleString()} satoshis
            </div>
          )}
          {balance?.unconfirmed ? (
            <div className="text-amber-400 text-sm font-display mt-2">
              +{formatIRM(balance.unconfirmed)} unconfirmed
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-5 relative">
          <button onClick={() => setShowSend(true)} className="btn-primary">
            <ArrowUpRight size={16} />
            Send
          </button>
          <button onClick={() => setShowReceive(true)} className="btn-secondary">
            <Download size={16} />
            Receive
          </button>
          <button onClick={handleNewAddress} className="btn-ghost">
            <Plus size={16} />
            New Address
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Addresses */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white/90">
              Addresses
            </h2>
            <span className="badge badge-irium">{addresses.length}</span>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {addresses.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">
                No addresses yet. Create one to get started.
              </div>
            ) : (
              addresses.map((a) => (
                <AddressRow key={a.address} addr={a} />
              ))
            )}
          </div>
        </div>

        {/* Recent transactions */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-white/90">
              Transactions
            </h2>
            <span className="badge badge-irium">{txs.length}</span>
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {txs.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">
                No transactions yet.
              </div>
            ) : (
              txs.map((tx) => <TxRow key={tx.txid} tx={tx} />)
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showSend && (
        <SendModal onClose={() => setShowSend(false)} onSuccess={loadData} />
      )}
      {showReceive && addresses.length > 0 && (
        <ReceiveModal
          address={addresses[0].address}
          onClose={() => setShowReceive(false)}
        />
      )}
    </div>
  );
}

function AddressRow({ addr }: { addr: AddressInfo }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(addr.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 group">
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-white/80 truncate">
          {addr.address}
        </div>
        {addr.balance !== undefined && (
          <div className="text-xs text-white/30 mt-0.5">
            {formatIRM(addr.balance)}
          </div>
        )}
      </div>
      <button
        onClick={copy}
        className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-white transition-all"
      >
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const isSend = tx.direction === "send";
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/3 group cursor-pointer">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isSend ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
        }`}
      >
        {isSend ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-white/50 truncate">{tx.txid}</div>
        <div className="text-xs text-white/25 mt-0.5">
          {tx.confirmations} conf
          {tx.timestamp ? ` · ${timeAgo(tx.timestamp)}` : ""}
        </div>
      </div>
      <div className={`font-display font-semibold text-sm ${isSend ? "text-red-400" : "text-green-400"}`}>
        {isSend ? "-" : "+"}
        {formatIRM(Math.abs(tx.amount))}
      </div>
    </div>
  );
}

function SendModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const addNotification = useStore((s) => s.addNotification);

  const handleSend = async () => {
    if (!to || !amount) return;
    setLoading(true);
    try {
      const sats = IRMToSats(parseFloat(amount));
      const feeSats = fee ? parseInt(fee) : undefined;
      const res = await wallet.send(to, sats, feeSats);
      setResult(res);
      addNotification({ type: "success", title: "Transaction sent", message: res.txid });
      onSuccess();
    } catch (e) {
      addNotification({ type: "error", title: "Send failed", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Send IRM" onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-500/15 text-green-400 mx-auto">
            <Check size={24} />
          </div>
          <div className="text-center">
            <div className="font-display font-semibold text-white">Transaction sent!</div>
            <div className="font-mono text-xs text-white/40 mt-2 break-all">{result.txid}</div>
          </div>
          <button onClick={onClose} className="btn-primary w-full justify-center">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Recipient Address</label>
            <input
              className="input"
              placeholder="P... or Q..."
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Amount (IRM)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.0001"
              placeholder="0.0000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amount && (
              <div className="text-xs text-white/30 mt-1 font-mono">
                = {IRMToSats(parseFloat(amount) || 0).toLocaleString()} satoshis
              </div>
            )}
          </div>
          <div>
            <label className="label">Fee (satoshis, optional)</label>
            <input
              className="input"
              type="number"
              min="0"
              placeholder="Auto"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button
              onClick={handleSend}
              disabled={!to || !amount || loading}
              className="btn-primary flex-1 justify-center"
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReceiveModal({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="Receive IRM" onClose={onClose}>
      <div className="space-y-4 text-center">
        <div className="text-white/40 text-sm">Send IRM to this address:</div>
        {/* QR placeholder */}
        <div className="w-40 h-40 mx-auto rounded-xl bg-white p-3 flex items-center justify-center">
          <QRPlaceholder address={address} />
        </div>
        <div
          className="font-mono text-sm text-white/80 bg-surface-700 rounded-lg p-3 break-all cursor-pointer hover:bg-surface-600 transition-colors"
          onClick={copy}
        >
          {address}
        </div>
        <button onClick={copy} className="btn-primary mx-auto">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied!" : "Copy Address"}
        </button>
      </div>
    </Modal>
  );
}

// Very simple QR-like grid placeholder
function QRPlaceholder({ address }: { address: string }) {
  const size = 9;
  const cells = Array.from({ length: size * size }, (_, i) => {
    const code = address.charCodeAt(i % address.length);
    return (code + i * 7) % 3 !== 0;
  });
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${size}, 1fr)`, gap: 1 }}>
      {cells.map((filled, i) => (
        <div
          key={i}
          style={{
            width: 12,
            height: 12,
            background: filled ? "#0a0a0f" : "transparent",
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-md p-6 relative">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-lg text-white">{title}</h2>
          <button onClick={onClose} className="btn-ghost text-white/40">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
