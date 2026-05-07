import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Upload, RefreshCw, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { agreements, proofs } from '../lib/tauri';
import {
  formatIRM,
  timeAgo,
  truncateAddr,
  truncateHash,
  statusColor,
} from '../lib/types';
import type { Agreement, Proof } from '../lib/types';

// ── Animation variants ────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ── Types & constants ─────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'released' | 'expired' | 'refunded';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'released', label: 'Completed' },
  { key: 'expired', label: 'Expired' },
  { key: 'refunded', label: 'Refunded' },
];

// ── Helper component ──────────────────────────────────────────

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/30">{label}: </span>
      <span className="font-mono text-white/70">{value}</span>
    </div>
  );
}

function borderColorForStatus(status: Agreement['status']): string {
  if (status === 'active') return '#7b2fe2'; // irium-500
  if (status === 'released') return '#4ade80'; // green-400
  if (status === 'expired' || status === 'timeout') return '#f87171'; // red-400
  if (status === 'refunded') return '#fbbf24'; // amber-400
  return 'rgba(255,255,255,0.2)';
}

// ── Main page ─────────────────────────────────────────────────

export default function AgreementsPage() {
  const location = useLocation();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [agreementList, setAgreementList] = useState<Agreement[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proofsByAgreement, setProofsByAgreement] = useState<Record<string, Proof[]>>({});
  const [showProofModal, setShowProofModal] = useState<string | null>(null);
  const [showReleaseModal, setShowReleaseModal] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [proofFilePath, setProofFilePath] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const incoming = (location.state as { expandId?: string } | null)?.expandId;
    if (incoming) {
      setExpandedId(incoming);
    }
  }, []);

  // Load proofs when expanding a card
  useEffect(() => {
    if (!expandedId || proofsByAgreement[expandedId] !== undefined) return;
    proofs
      .list(expandedId)
      .then((ps) => setProofsByAgreement((prev) => ({ ...prev, [expandedId]: ps })))
      .catch(() => {});
  }, [expandedId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await agreements.list();
      setAgreementList(data);
    } catch (e) {
      toast.error('Failed to load agreements');
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await agreements.refund(id);
      if (res.success) toast.success('Refund initiated');
      else toast.error(res.message ?? 'Refund failed');
      loadData();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setActionLoading(false);
    }
  };

  const filteredAgreements = agreementList.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'active') return ['active', 'pending', 'satisfied'].includes(a.status);
    return a.status === filter;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto p-6 space-y-5"
    >
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Agreements</h1>
          <p className="text-white/40 text-sm mt-0.5">On-chain settlement agreements</p>
        </div>
        <button onClick={loadData} className="btn-ghost" disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex border-b border-white/[0.06] mb-5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`relative px-4 py-2.5 text-sm font-display font-medium transition-colors ${
              filter === f.key ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {f.label}
            {filter === f.key && (
              <motion.div
                layoutId="agr-tab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-irium-500"
              />
            )}
          </button>
        ))}
      </div>

      {/* Loading shimmer */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-4 h-20 shimmer rounded-xl" />
          ))}
        </div>
      ) : filteredAgreements.length === 0 ? (
        <div className="text-center py-20 text-white/30 text-sm">
          No agreements found
          {filter !== 'all' && (
            <span>
              {' '}
              with status <strong>{filter}</strong>
            </span>
          )}
          .
        </div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          {filteredAgreements.map((a) => (
            <motion.div key={a.id} variants={itemVariants}>
              <AgreementCard
                agreement={a}
                expanded={expandedId === a.id}
                onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                proofs={proofsByAgreement[a.id]}
                onSubmitProof={() => setShowProofModal(a.id)}
                onRelease={() => {
                  if (a.release_eligible) setShowReleaseModal(a.id);
                }}
                onRefund={() => handleRefund(a.id)}
                actionLoading={actionLoading}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Submit Proof Modal */}
      <AnimatePresence>
        {showProofModal !== null && (
          <ProofModal
            agreementId={showProofModal}
            proofFilePath={proofFilePath}
            onPathChange={setProofFilePath}
            onClose={() => {
              setShowProofModal(null);
              setProofFilePath('');
            }}
            onSuccess={() => {
              setShowProofModal(null);
              setProofFilePath('');
              // Reload proofs for the agreement
              if (expandedId) {
                proofs
                  .list(expandedId)
                  .then((ps) =>
                    setProofsByAgreement((prev) => ({ ...prev, [expandedId]: ps }))
                  )
                  .catch(() => {});
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Release Funds Modal */}
      <AnimatePresence>
        {showReleaseModal !== null && (
          <ReleaseModal
            agreement={agreementList.find((a) => a.id === showReleaseModal)!}
            onClose={() => setShowReleaseModal(null)}
            onSuccess={() => {
              setShowReleaseModal(null);
              loadData();
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Agreement card ────────────────────────────────────────────

interface AgreementCardProps {
  agreement: Agreement;
  expanded: boolean;
  onToggle: () => void;
  proofs: Proof[] | undefined;
  onSubmitProof: () => void;
  onRelease: () => void;
  onRefund: () => void;
  actionLoading: boolean;
}

function AgreementCard({
  agreement: a,
  expanded,
  onToggle,
  proofs: agreementProofs,
  onSubmitProof,
  onRelease,
  onRefund,
  actionLoading,
}: AgreementCardProps) {
  const borderColor = borderColorForStatus(a.status);

  // Deadline progress
  let deadlinePct = 0;
  if (a.deadline && a.status === 'active') {
    const total = a.deadline - (a.created_at ?? a.deadline);
    const elapsed = Date.now() / 1000 - (a.created_at ?? a.deadline);
    deadlinePct = Math.min(100, Math.max(0, total > 0 ? (elapsed / total) * 100 : 0));
  }

  return (
    <div
      className="card overflow-hidden"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      {/* Card header — clickable to expand */}
      <div
        className="p-4 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        {/* Left: ID + status badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-xs text-white/60">
              {a.id.slice(0, 14)}
            </span>
            <span className={`badge ${statusColor(a.status)}`}>{a.status}</span>
            {a.template && (
              <span className="badge badge-irium">{a.template}</span>
            )}
          </div>

          {/* Buyer → Seller flow */}
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="font-mono">
              {a.buyer ? truncateAddr(a.buyer, 6, 4) : '—'}
            </span>
            <span className="text-white/20">→</span>
            <span className="font-mono">
              {a.seller ? truncateAddr(a.seller, 6, 4) : '—'}
            </span>
            <span className="mx-1 text-white/20">·</span>
            <span className="font-display font-semibold text-white/70">
              {formatIRM(a.amount)}
            </span>
          </div>
        </div>

        {/* Right: chevron */}
        <div className="flex-shrink-0 text-white/30">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Deadline progress bar */}
      {a.deadline && a.status === 'active' && (
        <div className="h-1 bg-white/[0.04]">
          <div
            className="h-full bg-irium-500/60 transition-all duration-500"
            style={{ width: `${deadlinePct}%` }}
          />
        </div>
      )}

      {/* Expanded detail panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-white/[0.05] space-y-4">
              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Detail label="Hash" value={a.hash ? truncateHash(a.hash) : '—'} />
                <Detail label="Template" value={a.template ?? '—'} />
                <Detail
                  label="Created"
                  value={a.created_at ? timeAgo(a.created_at) : '—'}
                />
                <Detail
                  label="Deadline"
                  value={a.deadline ? timeAgo(a.deadline) : '—'}
                />
                <Detail label="Proof Status" value={a.proof_status ?? 'none'} />
                <Detail
                  label="Release Eligible"
                  value={a.release_eligible ? 'Yes' : 'No'}
                />
              </div>

              {/* Policy */}
              {a.policy && (
                <div className="glass rounded-lg p-3 text-xs space-y-1">
                  <div className="font-display font-semibold text-white/70 mb-2">
                    Policy
                  </div>
                  <Detail label="Kind" value={a.policy.kind} />
                  <Detail
                    label="Threshold"
                    value={String(a.policy.threshold ?? 1)}
                  />
                  <Detail
                    label="Attestors"
                    value={(a.policy.attestors ?? []).join(', ') || '—'}
                  />
                </div>
              )}

              {/* Proofs */}
              {(agreementProofs ?? []).length > 0 && (
                <div>
                  <div className="font-display font-semibold text-white/70 text-xs mb-2">
                    Proofs
                  </div>
                  {(agreementProofs ?? []).map((p) => (
                    <div
                      key={p.id}
                      className="glass rounded-lg p-2.5 text-xs mb-1.5 flex items-center justify-between"
                    >
                      <div className="font-mono text-white/50">{p.id}</div>
                      <span
                        className={`badge ${
                          p.status === 'satisfied'
                            ? 'badge-success'
                            : p.status === 'active'
                            ? 'badge-info'
                            : 'badge-warning'
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 flex-wrap">
                <button
                  onClick={onSubmitProof}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  Submit Proof
                </button>
                <button
                  onClick={onRelease}
                  disabled={!a.release_eligible || actionLoading}
                  title={
                    !a.release_eligible
                      ? 'Release not eligible — proof conditions not yet satisfied'
                      : undefined
                  }
                  className={`btn-primary text-xs py-1.5 px-3 ${
                    !a.release_eligible ? 'opacity-40 cursor-not-allowed' : ''
                  }`}
                >
                  Release Funds
                </button>
                <button
                  onClick={onRefund}
                  disabled={actionLoading}
                  className="btn-ghost text-xs py-1.5 px-3 text-red-400 hover:text-red-300"
                >
                  Refund
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Submit Proof Modal ────────────────────────────────────────

interface ProofModalProps {
  agreementId: string;
  proofFilePath: string;
  onPathChange: (v: string) => void;
  onClose: () => void;
  onSuccess: () => void;
}

function ProofModal({
  agreementId,
  proofFilePath,
  onPathChange,
  onClose,
  onSuccess,
}: ProofModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!proofFilePath.trim()) return;
    setSubmitting(true);
    try {
      const result = await proofs.submit(agreementId, proofFilePath.trim());
      if (result.success) {
        toast.success('Proof submitted: ' + result.proof_id);
        onSuccess();
      } else {
        toast.error(result.message ?? result.status ?? 'Submission failed');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      key="proof-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="glass-heavy w-full max-w-lg rounded-2xl p-6 mb-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-bold text-lg text-white">Submit Proof</h2>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>

        {/* Drop zone */}
        <div
          className="border-2 border-dashed border-irium-500/30 rounded-xl p-8 text-center"
          style={{
            backgroundImage:
              'linear-gradient(135deg, rgba(123,47,226,0.03) 0%, transparent 100%)',
          }}
        >
          <Upload size={24} className="mx-auto mb-2 text-irium-400" />
          <div className="text-white/50 text-sm mb-3">Drop proof file here</div>
          <div className="text-white/30 text-xs mb-4">— or enter path manually —</div>
          <input
            value={proofFilePath}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder="/path/to/proof.json"
            className="input text-xs"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!proofFilePath.trim() || submitting}
            className="btn-primary flex-1 justify-center"
          >
            {submitting ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              'Submit'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Release Funds Modal ───────────────────────────────────────

interface ReleaseModalProps {
  agreement: Agreement;
  onClose: () => void;
  onSuccess: () => void;
}

function ReleaseModal({ agreement, onClose, onSuccess }: ReleaseModalProps) {
  const [releasing, setReleasing] = useState(false);

  const handleConfirm = async () => {
    setReleasing(true);
    try {
      const result = await agreements.release(agreement.id);
      if (result.success) {
        toast.success('Funds released · txid: ' + (result.txid?.slice(0, 12) ?? ''));
        onSuccess();
      } else {
        toast.error(result.message ?? 'Release failed');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setReleasing(false);
    }
  };

  return (
    <motion.div
      key="release-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="glass-heavy w-full max-w-sm rounded-2xl p-6 text-center"
      >
        <h2 className="font-display font-bold text-xl text-white mb-3">
          Release Funds?
        </h2>

        {/* Large gradient amount */}
        <div className="font-display font-bold text-3xl gradient-text mb-3">
          {formatIRM(agreement.amount)}
        </div>

        <p className="text-white/50 text-sm mb-6">
          This will release{' '}
          <span className="text-white/70 font-semibold">
            {formatIRM(agreement.amount)}
          </span>{' '}
          to the seller.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={releasing}
            className="btn-primary flex-1 justify-center"
          >
            {releasing ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              'Confirm Release'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
