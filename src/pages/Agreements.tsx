import React, { useEffect, useState } from "react";
import {
  FileText,
  RefreshCw,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  Send,
  Info,
} from "lucide-react";
import { agreements, proofs } from "../lib/tauri";
import {
  formatIRM,
  truncateHash,
  truncateAddr,
  timeAgo,
  statusColor,
} from "../lib/types";
import type { Agreement, Proof, AgreementStatus } from "../lib/types";
import { useStore } from "../lib/store";

export default function AgreementsPage() {
  const [list, setList] = useState<Agreement[]>([]);
  const [selected, setSelected] = useState<Agreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AgreementStatus | "all">("all");

  useEffect(() => {
    loadAgreements();
  }, []);

  const loadAgreements = async () => {
    setLoading(true);
    try {
      const data = await agreements.list();
      setList(data);
    } catch {}
    setLoading(false);
  };

  const filtered = filter === "all" ? list : list.filter((a) => a.status === filter);

  if (selected) {
    return (
      <AgreementDetail
        agreement={selected}
        onBack={() => { setSelected(null); loadAgreements(); }}
        onRefresh={loadAgreements}
      />
    );
  }

  return (
    <div className="p-6 space-y-4 page-enter overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Agreements</h1>
          <p className="text-white/40 text-sm mt-0.5">On-chain settlement agreements</p>
        </div>
        <button onClick={loadAgreements} className="btn-ghost" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "active", "satisfied", "released", "timeout", "refunded"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-display font-semibold transition-all ${
              filter === f
                ? "bg-irium-500/20 text-irium-300 border border-irium-500/30"
                : "text-white/40 hover:text-white/70 hover:bg-white/5"
            }`}
          >
            {f === "all" ? `All (${list.length})` : f}
          </button>
        ))}
      </div>

      {/* Agreement list */}
      {loading ? (
        <div className="text-center py-16 text-white/30">Loading agreements...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30 text-sm">
          No agreements found. Create a settlement to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <AgreementRow
              key={a.id}
              agreement={a}
              onSelect={() => setSelected(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgreementRow({ agreement: a, onSelect }: { agreement: Agreement; onSelect: () => void }) {
  return (
    <div
      className="card-interactive p-4 flex items-center gap-4"
      onClick={onSelect}
    >
      <div className="w-10 h-10 rounded-lg bg-irium-500/10 flex items-center justify-center flex-shrink-0">
        <FileText size={18} className="text-irium-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-white/60 truncate">{a.id}</span>
          <span className={`badge ${statusColor(a.status)}`}>{a.status}</span>
          {a.template && <span className="badge badge-irium">{a.template}</span>}
        </div>
        <div className="flex items-center gap-4 mt-1 text-xs text-white/30">
          <span className="font-display font-semibold text-white/70">{formatIRM(a.amount)}</span>
          {a.buyer && <span>Buyer: {truncateAddr(a.buyer, 4, 4)}</span>}
          {a.seller && <span>Seller: {truncateAddr(a.seller, 4, 4)}</span>}
          {a.created_at && <span>{timeAgo(a.created_at)}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <ProofStatusBadge status={a.proof_status} />
        {a.release_eligible && (
          <span className="badge badge-success text-xs">Release Ready</span>
        )}
      </div>
    </div>
  );
}

function ProofStatusBadge({ status }: { status?: string | null }) {
  if (!status || status === "none") return <span className="text-white/20 text-xs font-mono">No proof</span>;
  if (status === "active") return <span className="badge badge-info">Proof active</span>;
  if (status === "satisfied") return <span className="badge badge-success">Proof satisfied</span>;
  if (status === "expired") return <span className="badge badge-warning">Proof expired</span>;
  if (status === "unsatisfied") return <span className="badge badge-error">Unsatisfied</span>;
  return <span className="badge badge-irium">{status}</span>;
}

// ============================================================
// DETAIL VIEW
// ============================================================

function AgreementDetail({
  agreement,
  onBack,
  onRefresh,
}: {
  agreement: Agreement;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [agreementData, setAgreementData] = useState<Agreement>(agreement);
  const [proofList, setProofList] = useState<Proof[]>([]);
  const [showProofModal, setShowProofModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    loadDetail();
  }, []);

  const loadDetail = async () => {
    try {
      const [detail, pfs] = await Promise.allSettled([
        agreements.show(agreement.id),
        proofs.list(agreement.id),
      ]);
      if (detail.status === "fulfilled") setAgreementData(detail.value);
      if (pfs.status === "fulfilled") setProofList(pfs.value);
    } catch {}
  };

  const handleRelease = async () => {
    setLoading(true);
    try {
      const result = await agreements.release(agreementData.id);
      if (result.success) {
        addNotification({ type: "success", title: "Funds released!", message: result.txid });
        onRefresh();
        await loadDetail();
      } else {
        addNotification({ type: "error", title: "Release failed", message: result.message });
      }
    } catch (e) {
      addNotification({ type: "error", title: "Error", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async () => {
    setLoading(true);
    try {
      const result = await agreements.refund(agreementData.id);
      if (result.success) {
        addNotification({ type: "success", title: "Refund initiated", message: result.txid });
        onRefresh();
        await loadDetail();
      } else {
        addNotification({ type: "error", title: "Refund failed", message: result.message });
      }
    } catch (e) {
      addNotification({ type: "error", title: "Error", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const a = agreementData;

  return (
    <div className="p-6 space-y-5 page-enter overflow-y-auto h-full">
      <button onClick={onBack} className="btn-ghost text-white/40">← Back to Agreements</button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display font-bold text-xl text-white">Agreement</h1>
            <span className={`badge ${statusColor(a.status)}`}>{a.status}</span>
            {a.template && <span className="badge badge-irium">{a.template}</span>}
          </div>
          <div className="font-mono text-sm text-white/40 mt-1">{a.id}</div>
        </div>
        <div className="font-display font-bold text-2xl gradient-text flex-shrink-0">
          {formatIRM(a.amount)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Details card */}
        <div className="card p-4 space-y-3">
          <h2 className="font-display font-semibold text-white/80 text-sm mb-3">Details</h2>
          <InfoRow label="Agreement Hash" value={a.hash ? truncateHash(a.hash, 12) : "—"} mono />
          <InfoRow label="Amount" value={formatIRM(a.amount)} />
          <InfoRow label="Buyer" value={a.buyer ? truncateAddr(a.buyer) : "—"} mono />
          <InfoRow label="Seller" value={a.seller ? truncateAddr(a.seller) : "—"} mono />
          <InfoRow label="Created" value={a.created_at ? timeAgo(a.created_at) : "—"} />
          <InfoRow label="Deadline" value={a.deadline ? timeAgo(a.deadline) : "No deadline"} />
          <InfoRow label="Proof Status" value={a.proof_status ?? "none"} />
          {a.release_eligible !== undefined && (
            <InfoRow
              label="Release Eligible"
              value={a.release_eligible ? "Yes ✓" : "No"}
              highlight={a.release_eligible}
            />
          )}
        </div>

        {/* Policy card */}
        {a.policy && (
          <div className="card p-4 space-y-3">
            <h2 className="font-display font-semibold text-white/80 text-sm mb-3">Policy</h2>
            <InfoRow label="Policy ID" value={truncateHash(a.policy.id, 8)} mono />
            <InfoRow label="Kind" value={a.policy.kind} />
            {a.policy.threshold && (
              <InfoRow label="Threshold" value={String(a.policy.threshold)} />
            )}
            {a.policy.attestors && a.policy.attestors.length > 0 && (
              <div>
                <div className="text-xs text-white/40 mb-1">Attestors</div>
                <div className="space-y-1">
                  {a.policy.attestors.map((att) => (
                    <div key={att} className="font-mono text-xs text-white/60 bg-surface-700 rounded px-2 py-1 truncate">
                      {att}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card p-4">
        <h2 className="font-display font-semibold text-white/80 text-sm mb-3">Actions</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowProofModal(true)}
            className="btn-primary"
          >
            <Upload size={14} />
            Submit Proof
          </button>
          <button
            onClick={handleRelease}
            disabled={!a.release_eligible || loading}
            className={`btn-secondary ${a.release_eligible ? "" : "opacity-40 cursor-not-allowed"}`}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Release Funds
          </button>
          <button
            onClick={handleRefund}
            disabled={loading}
            className="btn-secondary"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
            Request Refund
          </button>
        </div>
        {!a.release_eligible && a.status === "active" && (
          <div className="flex items-center gap-2 mt-3 text-xs text-amber-400/70">
            <Info size={12} />
            <span>Release requires a satisfied proof. Submit proof of completion above.</span>
          </div>
        )}
      </div>

      {/* Proofs */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-white/80 text-sm">Proofs</h2>
          <button onClick={loadDetail} className="btn-ghost text-xs">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {proofList.length === 0 ? (
          <div className="text-center py-6 text-white/30 text-sm">No proofs submitted yet.</div>
        ) : (
          <div className="space-y-2">
            {proofList.map((p) => (
              <ProofRow key={p.id} proof={p} />
            ))}
          </div>
        )}
      </div>

      {showProofModal && (
        <ProofSubmitModal
          agreementId={a.id}
          onClose={() => setShowProofModal(false)}
          onSuccess={() => { setShowProofModal(false); loadDetail(); }}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-white/40 flex-shrink-0">{label}</span>
      <span className={`${mono ? "font-mono text-xs" : ""} ${highlight ? "text-green-400 font-semibold" : "text-white/70"} truncate max-w-48`}>
        {value}
      </span>
    </div>
  );
}

function ProofRow({ proof }: { proof: Proof }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-surface-700/50">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        proof.status === "satisfied" ? "bg-green-400" :
        proof.status === "active" ? "bg-blue-400" :
        proof.status === "expired" ? "bg-amber-400" : "bg-white/20"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-white/60 truncate">{proof.id}</div>
        <div className="text-xs text-white/30 mt-0.5 flex items-center gap-2">
          <span>{proof.status}</span>
          {proof.submitted_at && <span>· {timeAgo(proof.submitted_at)}</span>}
          {proof.policy_result && <span>· {proof.policy_result}</span>}
        </div>
      </div>
    </div>
  );
}

function ProofSubmitModal({
  agreementId,
  onClose,
  onSuccess,
}: {
  agreementId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [proofData, setProofData] = useState("");
  const [proofFile, setProofFile] = useState("");
  const [loading, setLoading] = useState(false);
  const addNotification = useStore((s) => s.addNotification);

  const submit = async () => {
    if (!proofFile && !proofData) return;
    setLoading(true);
    try {
      const result = await proofs.submit(agreementId, proofFile || proofData);
      addNotification({
        type: result.success ? "success" : "error",
        title: result.success ? "Proof submitted" : "Submission failed",
        message: result.message ?? result.status,
      });
      if (result.success) onSuccess();
    } catch (e) {
      addNotification({ type: "error", title: "Error", message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-lg text-white">Submit Proof</h2>
          <button onClick={onClose} className="btn-ghost text-white/40">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Proof File Path</label>
            <input
              className="input font-mono"
              placeholder="/path/to/proof.json"
              value={proofFile}
              onChange={(e) => setProofFile(e.target.value)}
            />
            <div className="text-xs text-white/30 mt-1">
              Path to a signed proof file (from proof-sign command)
            </div>
          </div>
          <div className="text-center text-white/30 text-xs">— or —</div>
          <div>
            <label className="label">Proof Data (JSON)</label>
            <textarea
              className="input h-24 resize-none font-mono text-xs"
              placeholder='{"type":"delivery","data":"...","sig":"..."}'
              value={proofData}
              onChange={(e) => setProofData(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button
              onClick={submit}
              disabled={(!proofFile && !proofData) || loading}
              className="btn-primary flex-1 justify-center"
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
