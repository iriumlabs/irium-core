import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Upload, RefreshCw, X, Download, PackageOpen } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useStore } from '../lib/store';
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

// StatusFilter uses real binary status values: open / funded / released / refunded
type StatusFilter = 'all' | 'open' | 'funded' | 'released' | 'refunded';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',      label: 'All'      },
  { key: 'open',     label: 'Open'     },
  { key: 'funded',   label: 'Funded'   },
  { key: 'released', label: 'Released' },
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
  if (status === 'funded') return '#7b2fe2'; // irium-500
  if (status === 'released') return '#4ade80'; // green-400
  if (status === 'refunded') return '#fbbf24'; // amber-400
  return 'rgba(255,255,255,0.2)';
}

// ── Main page ─────────────────────────────────────────────────

export default function AgreementsPage() {
  const location = useLocation();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [agreementList, setAgreementList] = useState<Agreement[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proofsByAgreement, setProofsByAgreement] = useState<Record<string, Proof[]>>({});
  const [showProofModal, setShowProofModal] = useState<string | null>(null);
  const [showReleaseModal, setShowReleaseModal] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
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
  }, [location.state]);

  // Load proofs when expanding a card
  useEffect(() => {
    if (!expandedId || proofsByAgreement[expandedId] !== undefined) return;
    proofs
      .list(expandedId)
      .then((ps) => setProofsByAgreement((prev) => ({ ...prev, [expandedId]: ps })))
      .catch(() => {});
  }, [expandedId, proofsByAgreement]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await agreements.list();
      setAgreementList(data);
    } catch (e) {
      // Suppress toast when offline — the empty state already communicates the problem.
      // This also prevents the React 18 strict-mode double-invoke from firing two toasts.
      if (nodeStatus?.running) {
        toast.error('Failed to load agreements');
      }
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
    return a.status === filter;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="w-full space-y-5 px-8 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Agreements</h1>
          <p className="page-subtitle">On-chain settlement agreements</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            <PackageOpen size={13} />
            Import Pack
          </button>
          <button onClick={loadData} className="btn-ghost" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
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
                isOnline={!!nodeStatus?.running}
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
            isOnline={!!nodeStatus?.running}
          />
        )}
      </AnimatePresence>

      {/* Import Pack Modal */}
      <AnimatePresence>
        {showImportModal && (
          <ImportPackModal
            onClose={() => setShowImportModal(false)}
            onSuccess={() => {
              setShowImportModal(false);
              loadData();
            }}
          />
        )}
      </AnimatePresence>
      </div>
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
  isOnline: boolean;
}

function ExportPackRow({ agreementId }: { agreementId: string }) {
  const [showInput, setShowInput] = useState(false);
  const [outPath, setOutPath] = useState('');
  const [exporting, setExporting] = useState(false);
  const [browsing, setBrowsing]   = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    const path = await openSavePicker({
      defaultName: `agreement-${agreementId.slice(0, 8)}.pack.json`,
      extensions: ['json'],
      title: 'Save Agreement Pack',
    });
    if (path) setOutPath(path);
    setBrowsing(false);
  };

  const handleExport = async () => {
    if (!outPath.trim()) return;
    setExporting(true);
    try {
      await agreements.pack(agreementId, outPath.trim());
      toast.success('Agreement pack exported to ' + outPath.trim());
      setShowInput(false);
      setOutPath('');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };

  if (!showInput) {
    return (
      <button
        onClick={() => setShowInput(true)}
        className="btn-ghost text-xs py-1.5 px-3 text-irium-400 hover:text-irium-300"
      >
        <Download size={12} />
        Export Pack
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full mt-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={outPath}
          onChange={(e) => setOutPath(e.target.value)}
          placeholder="/path/to/output.pack.json"
          className="input text-xs flex-1"
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleExport(); if (e.key === 'Escape') setShowInput(false); }}
        />
        <button
          onClick={handleBrowse}
          disabled={browsing}
          className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
          title="Choose save location"
        >
          {browsing ? <RefreshCw size={12} className="animate-spin" /> : <><Download size={12} /> Browse</>}
        </button>
        <button
          onClick={handleExport}
          disabled={!outPath.trim() || exporting}
          className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
        >
          {exporting ? <RefreshCw size={12} className="animate-spin" /> : 'Save'}
        </button>
        <button onClick={() => setShowInput(false)} className="btn-ghost py-1.5 px-2">
          <X size={12} />
        </button>
      </div>
    </div>
  );
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
  isOnline,
}: AgreementCardProps) {
  const borderColor = borderColorForStatus(a.status);

  // Deadline progress
  let deadlinePct = 0;
  if (a.deadline && a.status === 'funded') {
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
      {a.deadline && a.status === 'funded' && (
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
                  title="Submit your proof of delivery"
                >
                  Submit Proof
                </button>
                <button
                  onClick={onRelease}
                  disabled={!a.release_eligible || actionLoading || !isOnline}
                  title={
                    !isOnline
                      ? 'Node must be online to release funds'
                      : !a.release_eligible
                      ? 'Release not eligible — proof conditions not yet satisfied'
                      : 'Release funds to counterparty'
                  }
                  className={`btn-primary text-xs py-1.5 px-3 ${
                    !a.release_eligible || !isOnline ? 'opacity-40 cursor-not-allowed' : ''
                  }`}
                >
                  Release to Counterparty
                </button>
                <button
                  onClick={onRefund}
                  disabled={actionLoading || !isOnline}
                  title={!isOnline ? 'Node must be online to refund' : undefined}
                  className="btn-ghost text-xs py-1.5 px-3 text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Refund
                </button>
                <ExportPackRow agreementId={a.id} />
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
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.extensions.map(e => `.${e}`).join(',');
    input.onchange = () => resolve(input.files?.[0]?.name ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
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

function ProofModal({
  agreementId,
  proofFilePath,
  onPathChange,
  onClose,
  onSuccess,
}: ProofModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing]     = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    const path = await openFilePicker({
      extensions: ['json'],
      title: 'Select Proof File (.json)',
    });
    if (path) onPathChange(path);
    setBrowsing(false);
  };

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="glass-heavy w-full max-w-lg rounded-2xl p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display font-bold text-lg text-white">Submit Proof</h2>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs mb-5" style={{ color: 'rgba(238,240,255,0.35)' }}>
          Accepted format: <span className="font-mono text-irium-300">.json</span> — proof file generated by{' '}
          <span className="font-mono">irium-wallet agreement-proof-sign</span>
        </p>

        {/* File selector */}
        <div
          className="rounded-xl p-5 mb-4"
          style={{
            background: 'rgba(110,198,255,0.04)',
            border: '1px dashed rgba(110,198,255,0.25)',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <Upload size={18} style={{ color: '#a78bfa' }} className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-display font-semibold text-white mb-0.5">Proof File</div>
              <div className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
                {proofFilePath
                  ? proofFilePath.split(/[\\/]/).pop()
                  : 'No file selected'}
              </div>
            </div>
            <button
              onClick={handleBrowse}
              disabled={browsing}
              className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
            >
              {browsing
                ? <RefreshCw size={12} className="animate-spin" />
                : <><Upload size={12} /> Browse</>
              }
            </button>
          </div>

          {/* Manual path input */}
          <div className="flex items-center gap-2">
            <input
              value={proofFilePath}
              onChange={(e) => onPathChange(e.target.value)}
              placeholder="/path/to/proof.json"
              className="input text-xs flex-1"
              style={{ fontFamily: '"JetBrains Mono", monospace' }}
            />
          </div>
        </div>

        {/* Format note */}
        <div
          className="flex items-start gap-2 rounded-lg p-3 mb-4 text-xs"
          style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(110,198,255,0.30)' }}
        >
          <span style={{ color: '#60a5fa', flexShrink: 0 }}>ℹ</span>
          <span style={{ color: 'rgba(238,240,255,0.50)' }}>
            The proof file must be a signed JSON document produced by{' '}
            <span className="font-mono text-white/70">irium-wallet agreement-proof-sign</span>.
            Only <span className="font-mono text-white/70">.json</span> files are accepted.
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!proofFilePath.trim() || submitting}
            className="btn-primary flex-1 justify-center"
          >
            {submitting
              ? <><RefreshCw size={14} className="animate-spin" /> Submitting…</>
              : 'Submit Proof'
            }
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
  isOnline: boolean;
}

function ReleaseModal({ agreement, onClose, onSuccess, isOnline }: ReleaseModalProps) {
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
            disabled={releasing || !isOnline}
            title={!isOnline ? 'Node must be online to release funds' : undefined}
            className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
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

// ── Import Pack Modal ─────────────────────────────────────────
// Party B uses this to import an agreement pack sent by Party A

interface ImportPackModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function ImportPackModal({ onClose, onSuccess }: ImportPackModalProps) {
  const [filePath, setFilePath] = useState('');
  const [importing, setImporting] = useState(false);
  const [browsing, setBrowsing]   = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    const path = await openFilePicker({
      extensions: ['json'],
      title: 'Select Agreement Pack (.pack.json)',
    });
    if (path) setFilePath(path);
    setBrowsing(false);
  };

  const handleImport = async () => {
    if (!filePath.trim()) return;
    setImporting(true);
    try {
      const result = await agreements.unpack(filePath.trim());
      toast.success('Agreement imported: ' + (result.id || 'OK'));
      onSuccess();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <motion.div
      key="import-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="glass-heavy w-full max-w-lg rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="font-display font-bold text-lg text-white">Import Agreement Pack</h2>
            <p className="text-white/40 text-xs mt-0.5">
              Accepted format: <span className="font-mono text-irium-300">.pack.json</span> — exported by Party A
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>

        {/* File selector area */}
        <div
          className="rounded-xl p-5 mb-4 mt-4"
          style={{
            background: 'rgba(110,198,255,0.04)',
            border: '1px dashed rgba(110,198,255,0.25)',
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <PackageOpen size={18} style={{ color: '#a78bfa' }} className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-display font-semibold text-white mb-0.5">Pack File</div>
              <div className="text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
                {filePath ? filePath.split(/[\\/]/).pop() : 'No file selected'}
              </div>
            </div>
            <button
              onClick={handleBrowse}
              disabled={browsing}
              className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
            >
              {browsing
                ? <RefreshCw size={12} className="animate-spin" />
                : <><PackageOpen size={12} /> Browse</>
              }
            </button>
          </div>

          <input
            autoFocus
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="/path/to/agreement.pack.json"
            className="input text-xs w-full"
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!filePath.trim() || importing}
            className="btn-primary flex-1 justify-center"
          >
            {importing ? <RefreshCw size={14} className="animate-spin" /> : 'Import Pack'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
