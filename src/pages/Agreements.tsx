import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Upload, RefreshCw, X, Download, PackageOpen, FileJson, AlertCircle, Copy, FileText, Receipt, PenLine, ShieldCheck, Gavel, CheckCircle2, XCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';
import { useStore } from '../lib/store';
import { agreements, proofs, agreementSpend, disputes, invoices, agreementStore } from '../lib/tauri';
import { useIriumEvents } from '../lib/hooks';
import {
  formatIRM,
  timeAgo,
  truncateAddr,
  truncateHash,
  statusColor,
} from '../lib/types';
import type { Agreement, Proof, SpendEligibilityResult, AgreementStatusResult, Invoice, DisputeEntry } from '../lib/types';

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
// Pending = agreement created but funding tx not yet confirmed on-chain.
type StatusFilter = 'all' | 'pending' | 'open' | 'funded' | 'released' | 'refunded';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',      label: 'All'      },
  { key: 'pending',  label: 'Pending'  },
  { key: 'open',     label: 'Open'     },
  { key: 'funded',   label: 'Funded'   },
  { key: 'released', label: 'Released' },
  { key: 'refunded', label: 'Refunded' },
];

// Proof types accepted by `agreement-proof-create` — limited to the common
// settlement variants the wizard surfaces in its dropdown. Advanced users
// fall through to the Upload File mode for niche proof_kinds.
const PROOF_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'delivery_confirmed', label: 'Delivery Confirmed' },
  { value: 'payment_received',   label: 'Payment Received'   },
  { value: 'otc_release',        label: 'OTC Release'        },
  { value: 'milestone_complete', label: 'Milestone Complete' },
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

// Top-level Agreements page view — agreements list or disputes view.
// Phase 7 adds a top-level Disputes view that lists DisputeEntry items
// returned by the wallet's agreement-dispute-list command.
type PageView = 'agreements' | 'disputes';

export default function AgreementsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selectedAddress = addresses[activeAddrIdx]?.address ?? '';
  const [pageView, setPageView] = useState<PageView>('agreements');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [agreementList, setAgreementList] = useState<Agreement[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proofsByAgreement, setProofsByAgreement] = useState<Record<string, Proof[]>>({});
  const [showProofModal, setShowProofModal] = useState<string | null>(null);
  const [showReleaseModal, setShowReleaseModal] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showImportInvoiceModal, setShowImportInvoiceModal] = useState(false);
  // Phase 7 — Sign Agreement modal. Holds the id of the agreement being
  // signed. Surface when the user clicks the Sign CTA on a card.
  const [signingId, setSigningId] = useState<string | null>(null);
  // Holds the agreement id currently being funded — drives the Fund modal.
  // Null when the modal is closed.
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [proofFilePath, setProofFilePath] = useState('');
  // Per-agreement on-expand RPC caches — populate when the card expands,
  // and pass into AgreementCard so it can disable refund / surface release
  // reason / render the proof-finality warning.
  const [refundEligByAgreement, setRefundEligByAgreement] = useState<Record<string, SpendEligibilityResult>>({});
  const [releaseEligByAgreement, setReleaseEligByAgreement] = useState<Record<string, SpendEligibilityResult>>({});
  const [statusByAgreement, setStatusByAgreement] = useState<Record<string, AgreementStatusResult>>({});
  // Drives the Open Dispute confirmation modal — id of the agreement being
  // disputed, or null when the modal is closed.
  const [disputeAgreementId, setDisputeAgreementId] = useState<string | null>(null);
  // Drives the Agreement Audit modal — id of the agreement whose audit
  // record is being viewed. The modal also needs the hash for the RPC
  // call; we look it up from agreementList by id.
  const [auditAgreementId, setAuditAgreementId] = useState<string | null>(null);
  // Friendly labels per agreement, persisted to localStorage. Mirrors the
  // address-labels pattern in store.ts but kept local to this page since
  // labels only appear on the Agreements UI.
  const [agreementLabels, setAgreementLabels] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('irium_agreement_labels');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, string>;
      }
    } catch {}
    return {};
  });

  const saveAgreementLabel = (id: string, label: string) => {
    setAgreementLabels((prev) => {
      const next = { ...prev };
      const trimmed = label.trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      try { localStorage.setItem('irium_agreement_labels', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    loadData();
  }, []);

  // Phase 5: real-time refresh on agreement.* events from the Rust WS bridge.
  // Polling stays as a fallback when the WS connection is down.
  useIriumEvents((event) => {
    if (
      event.type === 'agreement.funded' ||
      event.type === 'agreement.proof_submitted' ||
      event.type === 'agreement.satisfied' ||
      event.type === 'agreement.timeout' ||
      event.type === 'agreement.disputed' ||
      event.type === 'agreement.proof_reorged'
    ) {
      loadData();
    }
  });

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

  // Load release / refund eligibility + full status on expand. Each call is
  // independent and silently swallowed on failure — when undefined, the
  // card falls back to the agreement.release_eligible boolean from the
  // list response and shows no proof-finality warning.
  useEffect(() => {
    if (!expandedId) return;
    const id = expandedId;
    if (refundEligByAgreement[id] === undefined) {
      agreementSpend.refundEligibility(id)
        .then((r) => setRefundEligByAgreement((prev) => ({ ...prev, [id]: r })))
        .catch(() => {});
    }
    if (releaseEligByAgreement[id] === undefined) {
      agreementSpend.releaseEligibility(id)
        .then((r) => setReleaseEligByAgreement((prev) => ({ ...prev, [id]: r })))
        .catch(() => {});
    }
    if (statusByAgreement[id] === undefined) {
      agreementSpend.status(id)
        .then((s) => setStatusByAgreement((prev) => ({ ...prev, [id]: s })))
        .catch(() => {});
    }
  }, [expandedId, refundEligByAgreement, releaseEligByAgreement, statusByAgreement]);

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
      // broadcast=true so the refund tx is actually transmitted; without it
      // the binary only builds the tx and the UI would falsely report success.
      const res = await agreements.refund(id, true);
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
            onClick={() => setShowImportInvoiceModal(true)}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            title="Import a payment invoice JSON and create an agreement from it"
          >
            <Receipt size={13} />
            Import Invoice
          </button>
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

      {/* Page-view tabs — Agreements list vs Disputes list (Phase 7).
          Disputes view comes from agreement-dispute-list and has its own
          shape, so it gets a separate top-level view rather than a status
          filter on the agreements list. */}
      <div className="flex border-b border-white/[0.06] mb-3">
        {(['agreements', 'disputes'] as PageView[]).map((v) => (
          <button
            key={v}
            onClick={() => setPageView(v)}
            className={`relative px-5 py-3 text-sm font-display font-medium capitalize transition-colors ${
              pageView === v ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {v === 'agreements' ? 'Agreements' : 'Disputes'}
            {pageView === v && (
              <motion.div
                layoutId="agr-pageview"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-irium-500"
              />
            )}
          </button>
        ))}
      </div>

      {pageView === 'agreements' && (
      <>
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
                onFund={() => setFundingId(a.id)}
                onSubmitProof={() => setShowProofModal(a.id)}
                onRelease={() => {
                  if (a.release_eligible) setShowReleaseModal(a.id);
                }}
                onRefund={() => handleRefund(a.id)}
                onDispute={() => setDisputeAgreementId(a.id)}
                onViewAudit={() => setAuditAgreementId(a.id)}
                onSign={() => setSigningId(a.id)}
                label={agreementLabels[a.id]}
                onSaveLabel={(l) => saveAgreementLabel(a.id, l)}
                actionLoading={actionLoading}
                isOnline={!!nodeStatus?.running}
                selectedAddress={selectedAddress}
                refundElig={refundEligByAgreement[a.id]}
                releaseElig={releaseEligByAgreement[a.id]}
                statusInfo={statusByAgreement[a.id]}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
      </>
      )}

      {pageView === 'disputes' && (
        <DisputesView
          agreementsById={Object.fromEntries(agreementList.map((a) => [a.id, a]))}
          onOpenAgreement={(id) => {
            setPageView('agreements');
            setExpandedId(id);
          }}
          isOnline={!!nodeStatus?.running}
        />
      )}

      {/* Submit Proof Modal */}
      <AnimatePresence>
        {showProofModal !== null && (
          <ProofModal
            agreementId={showProofModal}
            agreementHashDefault={agreementList.find((a) => a.id === showProofModal)?.hash ?? ''}
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

      {/* Fund Escrow Modal */}
      <AnimatePresence>
        {fundingId !== null && (
          <FundModal
            agreement={agreementList.find((a) => a.id === fundingId)!}
            onClose={() => setFundingId(null)}
            onSuccess={() => {
              setFundingId(null);
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

      {/* Import Invoice Modal (Phase 6) */}
      <AnimatePresence>
        {showImportInvoiceModal && (
          <ImportInvoiceModal
            onClose={() => setShowImportInvoiceModal(false)}
            onUseInvoice={(inv) => {
              setShowImportInvoiceModal(false);
              navigate('/settlement', { state: { prefillInvoice: inv } });
            }}
          />
        )}
      </AnimatePresence>

      {/* Sign Agreement Modal (Phase 7) */}
      <AnimatePresence>
        {signingId !== null && (
          <SignAgreementModal
            agreement={agreementList.find((a) => a.id === signingId)!}
            walletAddresses={addresses.map((a) => a.address)}
            preferredAddress={selectedAddress}
            onClose={() => setSigningId(null)}
            onSuccess={() => {
              setSigningId(null);
              loadData();
            }}
          />
        )}
      </AnimatePresence>

      {/* Open Dispute Modal */}
      <AnimatePresence>
        {disputeAgreementId !== null && (
          <DisputeModal
            agreement={agreementList.find((a) => a.id === disputeAgreementId)!}
            onClose={() => setDisputeAgreementId(null)}
            onSuccess={() => {
              setDisputeAgreementId(null);
              loadData();
            }}
            isOnline={!!nodeStatus?.running}
          />
        )}
      </AnimatePresence>

      {/* Audit Modal */}
      <AnimatePresence>
        {auditAgreementId !== null && (() => {
          const a = agreementList.find((x) => x.id === auditAgreementId);
          if (!a || !a.hash) return null;
          return (
            <AuditModal
              agreementId={a.id}
              agreementHash={a.hash}
              onClose={() => setAuditAgreementId(null)}
            />
          );
        })()}
      </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Agreement lifecycle timeline ──────────────────────────────
// Visualises where the agreement is in its on-chain lifecycle:
// Created → Funded → Proof Submitted → Released / Refunded.
// The active step is the first non-done step; refund flow swaps
// the last label when status === 'refunded'.
function AgreementTimeline({
  status,
  proofStatus,
  hasProofs,
}: {
  status: Agreement['status'];
  proofStatus?: string;
  hasProofs: boolean;
}) {
  const isRefunded = status === 'refunded';
  const steps = [
    { label: 'Created', done: true },
    {
      label: 'Funded',
      done: status === 'funded' || status === 'released' || status === 'refunded',
    },
    {
      label: 'Proof Submitted',
      done: hasProofs || (proofStatus !== undefined && proofStatus !== 'none'),
    },
    {
      label: isRefunded ? 'Refunded' : 'Released',
      done: status === 'released' || status === 'refunded',
    },
  ];
  const activeIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="flex items-start gap-1 mb-1">
      {steps.map((step, i) => {
        const isDone = step.done;
        const isActive = i === activeIdx;
        const dotClass = isDone
          ? 'bg-irium-500 border-irium-500'
          : isActive
          ? 'border-irium-300 bg-transparent'
          : 'border-white/10 bg-transparent';
        return (
          <React.Fragment key={step.label}>
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 ${dotClass} ${isActive ? 'animate-pulse' : ''}`}
              />
              <span
                className={`text-[10px] whitespace-nowrap ${
                  isDone
                    ? 'text-white/70'
                    : isActive
                    ? 'text-irium-300'
                    : 'text-white/25'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-0.5 flex-1 mt-[7px] ${
                  isDone && steps[i + 1].done ? 'bg-irium-500' : 'bg-white/10'
                }`}
                style={{ minWidth: 24 }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Agreement card ────────────────────────────────────────────

interface AgreementCardProps {
  agreement: Agreement;
  expanded: boolean;
  onToggle: () => void;
  proofs: Proof[] | undefined;
  onFund: () => void;
  onSubmitProof: () => void;
  onRelease: () => void;
  onRefund: () => void;
  onDispute: () => void;
  onViewAudit: () => void;
  // Phase 7 — open the SignAgreementModal for this agreement.
  onSign: () => void;
  label?: string;
  onSaveLabel: (label: string) => void;
  actionLoading: boolean;
  isOnline: boolean;
  // Currently-selected wallet address. Used to decide whether the user is
  // a party to the agreement and should see the Sign CTA.
  selectedAddress: string;
  // Populated on expand by AgreementsPage's eligibility/status useEffect.
  // Undefined while the call is in flight or if the RPC failed.
  refundElig?: SpendEligibilityResult;
  releaseElig?: SpendEligibilityResult;
  statusInfo?: AgreementStatusResult;
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
  onFund,
  onSubmitProof,
  onRelease,
  onRefund,
  onDispute,
  onViewAudit,
  onSign,
  label,
  onSaveLabel,
  actionLoading,
  isOnline,
  selectedAddress,
  refundElig,
  releaseElig,
  statusInfo,
}: AgreementCardProps) {
  // Phase 7 — surface a prominent "Sign Agreement" CTA before funding when
  // the currently-selected wallet address matches one of the parties.
  // Without a way to introspect existing signatures from the local store
  // (AgreementStoreEntry doesn't expose them), we always show the CTA on
  // open/pending agreements and let the user decide; if they sign twice,
  // the wallet binary handles idempotency.
  const isParty =
    !!selectedAddress &&
    (a.buyer === selectedAddress || a.seller === selectedAddress);
  const signNeeded = isParty && (a.status === 'open' || a.status === 'pending');
  // Local label-input state — synced with the prop so external updates
  // (e.g. saving from another card with the same agreement, hypothetical)
  // flow back in without losing the user's mid-edit text.
  const [labelDraft, setLabelDraft] = useState(label ?? '');
  useEffect(() => { setLabelDraft(label ?? ''); }, [label]);

  const handleSaveLabel = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onSaveLabel(labelDraft);
    toast.success('Label saved');
  };
  // Refund eligibility: when the RPC has come back and says ineligible,
  // we disable the button and show the binary's reason in the tooltip.
  // Undefined (RPC not yet returned, or failed) → fall back to permissive
  // behaviour so a working refund path isn't blocked by a slow RPC.
  const refundBlocked = refundElig !== undefined && !refundElig.eligible;
  // Proof-finality warning: only meaningful once the backend has told us
  // release is eligible AND we know proof_final/proof_depth. If either is
  // unknown, we don't warn — UX is honest about its uncertainty.
  const finalityDepth = 6; // matches IRIUM_PROOF_FINALITY_DEPTH default
  const showFinalityWarning =
    !!a.release_eligible &&
    statusInfo !== undefined &&
    (statusInfo.proof_final === false ||
      (statusInfo.proof_depth != null && statusInfo.proof_depth < finalityDepth));
  // Fund button only meaningful before the agreement has been funded.
  // Once status moves to 'funded'/'released'/'refunded' the HTLC is on-chain
  // and re-funding is invalid.
  const isUnfunded = a.status === 'open' || a.status === 'pending';
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

          {/* Friendly label — Phase 4 addition. Subtle italic accent line so
              the at-a-glance scan picks up the user's name for this
              agreement (e.g. "Laptop purchase from John") without
              competing with the structural data above. */}
          {label && (
            <div className="text-xs text-irium-300 italic mt-1 truncate" title={label}>
              {label}
            </div>
          )}
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
              {/* Lifecycle timeline — Created → Funded → Proof → Released/Refunded */}
              <AgreementTimeline
                status={a.status}
                proofStatus={a.proof_status}
                hasProofs={(agreementProofs?.length ?? 0) > 0}
              />

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Hash row — replaces the plain Detail with a clickable
                    copy affordance. truncated for readability; full hash
                    goes to clipboard on click. */}
                <div>
                  <span className="text-white/30">Hash: </span>
                  {a.hash ? (
                    <>
                      <span className="font-mono text-white/70">{truncateHash(a.hash)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(a.hash!);
                          toast.success('Copied');
                        }}
                        title="Copy full agreement hash"
                        className="ml-1.5 text-white/30 hover:text-white/70 align-middle"
                      >
                        <Copy size={11} />
                      </button>
                    </>
                  ) : (
                    <span className="font-mono text-white/70">—</span>
                  )}
                </div>
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

              {/* Release eligibility reason — surfaced inline when the
                  binary returns a human-readable reason for the current
                  eligibility state. Per SETTLEMENT-DEV.md error table:
                  "Refund timeout not reached. Current height: ... " etc. */}
              {releaseElig?.reason && (
                <div className="text-xs text-white/50">
                  <span className="text-white/30">Release reason: </span>
                  <span className="font-mono">{releaseElig.reason}</span>
                </div>
              )}

              {/* Proof-finality warning — release_eligible became true but
                  the proof block isn't yet 6 deep. Per SETTLEMENT-DEV.md
                  §"Proof Finality and Reorg Protection": "Do not act on
                  proof_final: false as the proof may be rolled back by a
                  chain reorg." */}
              {showFinalityWarning && (
                <div
                  className="flex items-start gap-2 rounded-lg p-3 text-xs"
                  style={{
                    background: 'rgba(251,191,36,0.08)',
                    border: '1px solid rgba(251,191,36,0.30)',
                    color: 'rgba(251,191,36,0.85)',
                  }}
                >
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Proof not yet final</strong>
                    {statusInfo?.proof_depth != null && (
                      <span> (depth: {statusInfo.proof_depth}/{finalityDepth})</span>
                    )}
                    . Wait for more block confirmations before releasing — a chain reorg could roll the proof back.
                  </span>
                </div>
              )}

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

              {/* Phase 7 — Sign Agreement CTA. Promoted above the regular
                  action row with a pulsing amber border when signing is
                  required so a first-time user knows what to do next.
                  Pulse uses Tailwind's animate-pulse on a ring wrapper. */}
              {signNeeded && (
                <div className="pt-2">
                  <div className="rounded-lg ring-2 ring-amber-400/60 animate-pulse">
                    <button
                      onClick={onSign}
                      disabled={actionLoading || !isOnline}
                      title={!isOnline ? 'Node must be online to sign' : 'Sign this agreement to confirm your participation'}
                      className="w-full btn-primary py-2 px-4 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-400 border-amber-300/40"
                    >
                      <PenLine size={14} /> Action required: Sign Agreement
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-300/70 mt-1.5 ml-1">
                    Signing confirms your participation. Both parties must sign before funding.
                  </p>
                </div>
              )}

              {/* Action buttons — context-aware. Each lifecycle stage
                  surfaces only the actions that are valid for that stage:
                    open/pending → just Fund Escrow (no point submitting a
                                   proof on an unfunded HTLC)
                    funded       → Release (when eligible, prominent),
                                   Submit Proof, Open Dispute, Refund (off
                                   until timeout), Export Pack
                    released/
                    refunded     → only Export Pack — terminal states. */}
              <div className="flex gap-2 pt-2 flex-wrap">
                {isUnfunded && (
                  <button
                    onClick={onFund}
                    disabled={actionLoading || !isOnline}
                    title={!isOnline ? 'Node must be online to fund escrow' : 'Lock the agreement amount into the HTLC escrow'}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Fund Escrow
                  </button>
                )}

                {a.status === 'funded' && (
                  <>
                    {a.release_eligible && (
                      <button
                        onClick={onRelease}
                        disabled={actionLoading || !isOnline}
                        title={!isOnline ? 'Node must be online to release funds' : 'Release funds to counterparty'}
                        className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Release to Counterparty
                      </button>
                    )}
                    <button
                      onClick={onSubmitProof}
                      className="btn-secondary text-xs py-1.5 px-3"
                      title="Submit your proof of delivery"
                    >
                      Submit Proof
                    </button>
                    <button
                      onClick={onDispute}
                      disabled={actionLoading || !isOnline}
                      title={!isOnline ? 'Node must be online to open a dispute' : 'Mark this agreement as disputed — requires a resolver attestation to settle'}
                      className="btn-ghost text-xs py-1.5 px-3 text-amber-400 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      <AlertCircle size={12} /> Open Dispute
                    </button>
                    <button
                      onClick={onRefund}
                      disabled={actionLoading || !isOnline || refundBlocked}
                      title={
                        !isOnline
                          ? 'Node must be online to refund'
                          : refundBlocked
                          ? (refundElig?.reason ?? 'Timeout not yet reached')
                          : undefined
                      }
                      className="btn-ghost text-xs py-1.5 px-3 text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Refund
                    </button>
                    <ExportPackRow agreementId={a.id} />
                  </>
                )}

                {(a.status === 'released' || a.status === 'refunded') && (
                  <ExportPackRow agreementId={a.id} />
                )}

                {/* disputed_metadata_only — agreement is locked pending a
                    resolver attestation per WHITEPAPER §8. No release / no
                    refund is permitted until the resolver acts; surface a
                    clear non-actionable button so the user knows they're
                    waiting on someone else, plus Export Pack so they can
                    share evidence. */}
                {a.status === 'disputed_metadata_only' && (
                  <>
                    <button
                      disabled
                      title="A resolver attestation is required to settle this dispute. Contact your designated resolver."
                      className="btn-ghost text-xs py-1.5 px-3 text-white/40 cursor-not-allowed flex items-center gap-1"
                    >
                      <AlertCircle size={12} /> Awaiting Resolver
                    </button>
                    <ExportPackRow agreementId={a.id} />
                  </>
                )}

                {/* expired — deadline passed without proof or release.
                    Terminal state for practical purposes; only auditing
                    actions remain. */}
                {a.status === 'expired' && (
                  <>
                    <button
                      disabled
                      title="This agreement's deadline has passed without resolution."
                      className="btn-ghost text-xs py-1.5 px-3 text-white/40 cursor-not-allowed"
                    >
                      Agreement Expired
                    </button>
                    <ExportPackRow agreementId={a.id} />
                  </>
                )}

                {/* Common footer — View Audit + Share Text are always
                    available so users can inspect on-chain history and
                    share a quick plain-text summary at any lifecycle stage.
                    View Audit is disabled when the hash hasn't been
                    computed yet (rare; only happens for very-early-state
                    local drafts). */}
                <button
                  onClick={onViewAudit}
                  disabled={!a.hash}
                  title={a.hash ? 'View full on-chain audit record' : 'Agreement hash not available yet'}
                  className="btn-ghost text-xs py-1.5 px-3 text-irium-400 hover:text-irium-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <FileText size={12} /> View Audit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const lines = [
                      'Irium Agreement',
                      `ID:       ${a.id}`,
                      `Hash:     ${a.hash ?? '—'}`,
                      `Amount:   ${formatIRM(a.amount)}`,
                      `Buyer:    ${a.buyer ?? '—'}`,
                      `Seller:   ${a.seller ?? '—'}`,
                      `Status:   ${a.status}`,
                      `Template: ${a.template ?? '—'}`,
                    ];
                    navigator.clipboard.writeText(lines.join('\n'));
                    toast.success('Copied');
                  }}
                  title="Copy a plain-text summary of this agreement to clipboard"
                  className="btn-ghost text-xs py-1.5 px-3 text-irium-400 hover:text-irium-300 flex items-center gap-1"
                >
                  <Copy size={12} /> Share Text
                </button>
              </div>

              {/* Phase 7 — Verify Signatures. The local store doesn't
                  expose per-party signature paths (AgreementStoreEntry only
                  has agreement_id/agreement_hash/path), so this is a
                  file-picker driven flow: the user picks a signature file,
                  we run verifySignature(path, agreement.id), and surface
                  the parsed result inline. Repeat for each party. */}
              <VerifySignaturesRow agreementId={a.id} />

              {/* Friendly label editor — saved to localStorage under
                  irium_agreement_labels, displayed in the collapsed card
                  header. onClick=stopPropagation prevents the input from
                  collapsing the card when focused. */}
              <div className="flex items-center gap-2 pt-3 border-t border-white/[0.05]">
                <input
                  type="text"
                  placeholder='Friendly name (e.g. "Laptop from John")'
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLabel(e); }}
                  onClick={(e) => e.stopPropagation()}
                  className="input text-xs flex-1"
                />
                <button
                  onClick={handleSaveLabel}
                  className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
                  title="Save a friendly name for this agreement (stored locally)"
                >
                  Save Label
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
  // Pre-fill for the Create-from-Evidence form when the parent has the
  // agreement's hash on hand (it usually does — comes from agreement.hash
  // in the local store list). Falls back to empty if unknown.
  agreementHashDefault: string;
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
  agreementHashDefault,
  proofFilePath,
  onPathChange,
  onClose,
  onSuccess,
}: ProofModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [browsing, setBrowsing]     = useState(false);

  // Create-from-Evidence form state.
  const addresses = useStore((s) => s.addresses);
  const activeAddrIdx = useStore((s) => s.activeAddrIdx);
  const selectedAddress = addresses[activeAddrIdx]?.address ?? '';

  const [proofMode, setProofMode] = useState<'create' | 'upload'>('create');
  const [proofType, setProofType] = useState('delivery_confirmed');
  const [agreementHash, setAgreementHash] = useState(agreementHashDefault);
  const [attestedBy, setAttestedBy] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

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

  // Create-from-Evidence path: build the signed JSON in-app via the
  // proof_create_and_submit Tauri command. Mirrors the SellerWizard
  // create-mode handler.
  const handleCreateSubmit = async () => {
    setCreateError(null);
    const hash = agreementHash.trim();
    if (!hash) { setCreateError('Agreement hash required'); return; }
    if (!proofType) { setCreateError('Pick a proof type'); return; }
    const attestor = (attestedBy.trim() || selectedAddress).trim();
    if (!attestor) { setCreateError('Attested-by address required'); return; }
    if (!evidenceSummary.trim()) { setCreateError('Describe what happened in the Evidence Summary'); return; }
    setSubmitting(true);
    try {
      const result = await proofs.createAndSubmit({
        agreementHash: hash,
        proofType,
        attestedBy: attestor,
        address: attestor,
        evidenceSummary: evidenceSummary.trim(),
      });
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
        <p className="text-xs mb-4" style={{ color: 'rgba(238,240,255,0.35)' }}>
          Build a signed proof in-app, or upload one you already have.
        </p>

        {/* Mode toggle — default "create" so normal users can build the
            proof in-app without ever opening a CLI. Advanced users switch
            to "upload" for a pre-signed .json from `irium-wallet proof-sign`. */}
        <div className="flex gap-1 rounded-lg bg-white/5 p-1 mb-4">
          {(['create', 'upload'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setProofMode(m); setCreateError(null); }}
              className={`flex-1 px-3 py-2 rounded-md text-xs font-display font-semibold transition-colors ${
                proofMode === m
                  ? 'bg-irium-500 text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              <div>{m === 'create' ? 'Create from Evidence' : 'Upload File'}</div>
              <div className="text-[10px] font-normal opacity-70 mt-0.5">
                {m === 'create' ? 'Build in-app' : 'Use existing file'}
              </div>
            </button>
          ))}
        </div>

        {proofMode === 'create' ? (
          <>
            <div className="space-y-3 mb-4">
              <div>
                <label className="label">Agreement Hash</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="64-character hex"
                  value={agreementHash}
                  onChange={(e) => { setAgreementHash(e.target.value); setCreateError(null); }}
                  spellCheck={false}
                  autoComplete="off"
                />
                {!agreementHashDefault && (
                  <p className="text-[11px] text-white/30 mt-1">
                    No hash on file for this agreement — paste the hash shared by the counterparty.
                  </p>
                )}
              </div>

              <div>
                <label className="label">Proof Type</label>
                <div className="relative">
                  <select
                    className="input w-full appearance-none pr-8"
                    value={proofType}
                    onChange={(e) => setProofType(e.target.value)}
                  >
                    {PROOF_TYPES.map((t) => (
                      <option key={t.value} value={t.value} style={{ background: '#0f0f23', color: '#eef0ff' }}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="label">Attested By</label>
                <input
                  className="input font-mono text-xs"
                  placeholder="Your wallet address"
                  value={attestedBy || selectedAddress}
                  onChange={(e) => setAttestedBy(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="text-[11px] text-white/30 mt-1">
                  Pre-filled with your selected wallet address.
                </p>
              </div>

              <div>
                <label className="label">Evidence Summary</label>
                <textarea
                  className="input resize-none"
                  rows={4}
                  placeholder="e.g. Payment of $50 received via bank transfer, reference #12345."
                  value={evidenceSummary}
                  onChange={(e) => setEvidenceSummary(e.target.value)}
                />
              </div>
            </div>

            {createError && (
              <p className="text-xs text-red-400 flex items-center gap-1 mb-3">
                <AlertCircle size={12} />{createError}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={submitting}
                className="btn-primary flex-1 justify-center"
              >
                {submitting
                  ? <><RefreshCw size={14} className="animate-spin" /> Submitting…</>
                  : 'Create & Submit Proof'
                }
              </button>
            </div>
          </>
        ) : (
          <>
            {/* File selector */}
            <div
              className="rounded-xl p-5 mb-4"
              style={{
                background: 'rgba(110,198,255,0.04)',
                border: '1px dashed rgba(110,198,255,0.25)',
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <FileJson size={18} style={{ color: '#a78bfa' }} className="flex-shrink-0" />
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
                Use this tab only if you already have a proof file — for example, one a counterparty or attestor signed for you, or one you produced via{' '}
                <span className="font-mono text-white/70">irium-wallet agreement-proof-create</span>.
                {' '}If you are submitting your own proof, use the{' '}
                <strong className="text-white/80">Create from Evidence</strong>
                {' '}tab above — it builds and submits the proof without leaving the app.
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
          </>
        )}
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
  const [secret, setSecret] = useState('');

  // Validate the HTLC preimage. Empty is allowed (the wallet binary will try
  // to auto-derive a secret it owns) — non-empty must be a 64-char hex string.
  const trimmedSecret = secret.trim();
  const secretError =
    trimmedSecret.length > 0 && !/^[0-9a-fA-F]{64}$/.test(trimmedSecret)
      ? 'Must be exactly 64 hex characters (0-9, a-f).'
      : null;

  const handleConfirm = async () => {
    if (secretError) return;
    setReleasing(true);
    try {
      const result = await agreements.release(
        agreement.id,
        trimmedSecret.length > 0 ? trimmedSecret : undefined,
        true,
      );
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
        className="glass-heavy w-full max-w-md rounded-2xl p-6"
      >
        <h2 className="font-display font-bold text-xl text-white mb-3 text-center">
          Release Funds?
        </h2>

        {/* Large gradient amount */}
        <div className="font-display font-bold text-3xl gradient-text mb-3 text-center">
          {formatIRM(agreement.amount)}
        </div>

        <p className="text-white/50 text-sm mb-5 text-center">
          This will release{' '}
          <span className="text-white/70 font-semibold">
            {formatIRM(agreement.amount)}
          </span>{' '}
          to the seller.
        </p>

        {/* Secret preimage input — optional. The binary's auto-derive path
            works only when the wallet funded the agreement; otherwise the
            counterparty must paste the 64-hex preimage of the agreement's
            secret-hash. */}
        <div className="mb-5 text-left">
          <label htmlFor="release-secret" className="label">Secret Preimage (hex)</label>
          <input
            id="release-secret"
            className={`input font-mono text-xs ${secretError ? 'border-red-500/50' : ''}`}
            placeholder="Optional · 64-character hex"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {secretError ? (
            <p className="text-xs text-red-400 mt-1">{secretError}</p>
          ) : (
            <p className="text-xs text-white/40 mt-1">
              Required if you did not create this agreement yourself. Leave blank if your wallet auto-derives it.
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={releasing || !isOnline || !!secretError}
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

// ── Fund Escrow Modal ─────────────────────────────────────────
// Calls agreement-fund (with --broadcast) so the HTLC funding tx is
// actually transmitted. Without funding, the on-chain escrow does not
// exist and Release/Refund have nothing to spend.

interface FundModalProps {
  agreement: Agreement;
  onClose: () => void;
  onSuccess: () => void;
  isOnline: boolean;
}

function FundModal({ agreement, onClose, onSuccess, isOnline }: FundModalProps) {
  const [funding, setFunding] = useState(false);

  const handleConfirm = async () => {
    setFunding(true);
    try {
      const result = await agreementSpend.fund(agreement.id, true);
      if (result.success) {
        toast.success('Escrow funded · txid: ' + (result.txid?.slice(0, 12) ?? ''));
        onSuccess();
      } else {
        toast.error(result.message ?? 'Funding failed');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setFunding(false);
    }
  };

  return (
    <motion.div
      key="fund-backdrop"
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
          Fund Escrow?
        </h2>

        <div className="font-display font-bold text-3xl gradient-text mb-3">
          {formatIRM(agreement.amount)}
        </div>

        <p className="text-white/50 text-sm mb-6">
          This will lock{' '}
          <span className="text-white/70 font-semibold">
            {formatIRM(agreement.amount)}
          </span>{' '}
          into the HTLC escrow. Funds release to the counterparty on proof acceptance, or refund after the timeout height.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={funding || !isOnline}
            title={!isOnline ? 'Node must be online to fund escrow' : undefined}
            className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {funding ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              'Confirm Fund'
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

// ── Import Invoice Modal (Phase 6) ────────────────────────────
// Two-step flow: user picks an invoice JSON → backend imports it via
// `invoice-import` and parses the on-disk file to return the structured
// fields → modal shows the parsed invoice → "Use This Invoice" hands
// off to Settlement.tsx with prefillInvoice in router state. The wallet
// CLI registers the invoice for record-keeping; the renderer's prefill
// is what actually drives the new-agreement flow.

interface ImportInvoiceModalProps {
  onClose: () => void;
  onUseInvoice: (invoice: Invoice) => void;
}

function ImportInvoiceModal({ onClose, onUseInvoice }: ImportInvoiceModalProps) {
  const [filePath, setFilePath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<Invoice | null>(null);

  const handleBrowse = async () => {
    setBrowsing(true);
    const path = await openFilePicker({
      extensions: ['json'],
      title: 'Select Invoice JSON',
    });
    if (path) setFilePath(path);
    setBrowsing(false);
  };

  const handleImport = async () => {
    if (!filePath.trim()) return;
    setImporting(true);
    try {
      const result = await invoices.import(filePath.trim());
      if (!result.invoice) {
        toast.error('Imported, but could not parse invoice fields for prefill');
        onClose();
        return;
      }
      setParsed(result.invoice);
      toast.success('Invoice imported');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <motion.div
      key="import-invoice-backdrop"
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
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-display font-bold text-lg text-white">Import Invoice</h2>
            <p className="text-white/40 text-xs mt-0.5">
              Pick an invoice JSON to pre-fill a new agreement on the Settlement page.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>

        {!parsed ? (
          <>
            <div
              className="rounded-xl p-5 mb-4 mt-2"
              style={{
                background: 'rgba(110,198,255,0.04)',
                border: '1px dashed rgba(110,198,255,0.25)',
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <Receipt size={18} style={{ color: '#a78bfa' }} className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-display font-semibold text-white mb-0.5">Invoice File</div>
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
                placeholder="/path/to/invoice.json"
                className="input text-xs w-full"
                style={{ fontFamily: '"JetBrains Mono", monospace' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleImport(); }}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
              <button
                onClick={handleImport}
                disabled={!filePath.trim() || importing}
                className="btn-primary flex-1 justify-center"
              >
                {importing ? <RefreshCw size={14} className="animate-spin" /> : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="glass rounded-lg p-3 mb-4 mt-2 space-y-1.5 text-xs">
              {parsed.id && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/40 flex-shrink-0">Invoice ID</span>
                  <span className="font-mono text-white/70 text-right break-all">{parsed.id}</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-white/40 flex-shrink-0">Recipient</span>
                <span className="font-mono text-white/70 text-right break-all">{parsed.recipient || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Amount</span>
                <span className="font-mono text-white/70">{formatIRM(parsed.amount)} IRM</span>
              </div>
              {parsed.reference && (
                <div className="flex justify-between gap-3">
                  <span className="text-white/40 flex-shrink-0">Reference</span>
                  <span className="font-mono text-white/70 text-right break-all">{parsed.reference}</span>
                </div>
              )}
              {parsed.expires_height != null && (
                <div className="flex justify-between">
                  <span className="text-white/40">Expires (height)</span>
                  <span className="font-mono text-white/70">#{parsed.expires_height.toLocaleString()}</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-white/45 mb-4">
              Clicking <strong>Use This Invoice</strong> jumps to Settlement with the OTC template pre-filled.
              You can change the template, edit fields, and confirm before creating the agreement.
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">Close</button>
              <button
                onClick={() => onUseInvoice(parsed)}
                className="btn-primary flex-1 justify-center"
              >
                Use This Invoice →
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Open Dispute Modal ────────────────────────────────────────
// Marks a funded agreement as disputed_metadata_only. The settlement
// engine then requires the designated resolver to submit an attestation
// before release becomes eligible. See WHITEPAPER §8 for the dispute
// workflow and SETTLEMENT-DEV.md for the on-chain semantics.

interface DisputeModalProps {
  agreement: Agreement;
  onClose: () => void;
  onSuccess: () => void;
  isOnline: boolean;
}

function DisputeModal({ agreement, onClose, onSuccess, isOnline }: DisputeModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const trimmed = reason.trim();
      const result = await disputes.open(agreement.id, trimmed.length > 0 ? trimmed : undefined);
      if (result.success) {
        toast.success('Dispute opened');
        onSuccess();
      } else {
        toast.error(result.message ?? 'Failed to open dispute');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      key="dispute-backdrop"
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
        className="glass-heavy w-full max-w-md rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-xl text-white">Open Dispute?</h2>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>

        {/* Agreement summary */}
        <div className="glass rounded-lg p-3 mb-4 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-white/40">Agreement</span>
            <span className="font-mono text-white/70">{agreement.id.slice(0, 18)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Amount</span>
            <span className="font-display font-semibold gradient-text">
              {formatIRM(agreement.amount)}
            </span>
          </div>
        </div>

        {/* Plain-English warning */}
        <div
          className="flex items-start gap-2 rounded-lg p-3 mb-4 text-xs"
          style={{
            background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: 'rgba(248,113,113,0.85)',
          }}
        >
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Opening a dispute means the agreement needs a resolver to review the evidence from both sides. Make sure you have a good reason and supporting proof before proceeding. This action cannot be undone.
          </span>
        </div>

        {/* Optional reason */}
        <div className="mb-5 text-left">
          <label htmlFor="dispute-reason" className="label">Reason (optional)</label>
          <textarea
            id="dispute-reason"
            className="input resize-none"
            rows={3}
            placeholder="Describe what went wrong — this is shared with the resolver."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || !isOnline}
            title={!isOnline ? 'Node must be online to open a dispute' : undefined}
            className="btn-primary flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: '#ef4444' }}
          >
            {submitting ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              'Confirm Open Dispute'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Audit Modal ───────────────────────────────────────────────
// Fetches a full audit record from iriumd's POST /rpc/agreementaudit and
// renders it with structured sections + a raw-JSON fallback. The exact
// response shape is undocumented in API.md beyond "full audit record
// including all on-chain events, proofs, and policy evaluations" — so we
// extract fields defensively (optional chaining + unknown casts) and
// always include the raw JSON so nothing is hidden.

interface AuditModalProps {
  agreementId: string;
  agreementHash: string;
  onClose: () => void;
}

function AuditModal({ agreementId, agreementHash, onClose }: AuditModalProps) {
  const rpcUrl = useStore((s) => s.settings.rpc_url) || 'http://127.0.0.1:38300';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await tauriFetch<Record<string, unknown>>(
          `${rpcUrl}/rpc/agreementaudit`,
          {
            method: 'POST',
            timeout: 10,
            responseType: ResponseType.JSON,
            body: Body.json({ agreement_hash: agreementHash }),
          },
        );
        if (!mounted) return;
        if (res.ok && res.data) {
          setData(res.data);
        } else {
          setError(`Audit RPC returned HTTP ${res.status}`);
        }
      } catch (e) {
        if (mounted) setError(String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [agreementHash, rpcUrl]);

  // Defensive field extraction. Any missing key collapses to null and the
  // corresponding section just doesn't render.
  const agreement = (data?.agreement ?? null) as Record<string, unknown> | null;
  const parties = (agreement?.parties ?? null) as unknown[] | null;
  const fundingLegs = (data?.funding_legs ?? null) as unknown[] | null;
  const linkedTxs = (data?.linked_transactions ?? null) as unknown[] | null;
  const events = ((data?.events ?? data?.timeline ?? null)) as unknown[] | null;
  const auditProofs = (data?.proofs ?? null) as unknown[] | null;
  const policy = (data?.policy ?? data?.policy_evaluation ?? null) as Record<string, unknown> | null;
  const rawJson = data ? JSON.stringify(data, null, 2) : '';

  return (
    <motion.div
      key="audit-backdrop"
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
        className="glass-heavy w-full max-w-2xl rounded-2xl p-6 overflow-y-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display font-bold text-lg text-white">Agreement Audit</h2>
            <p className="font-mono text-[10px] text-white/40 mt-0.5">{agreementId}</p>
          </div>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-8 justify-center text-white/40 text-sm">
            <RefreshCw size={14} className="animate-spin" /> Fetching audit record…
          </div>
        )}

        {error && (
          <div className="rounded-lg p-3 text-xs text-red-400 border border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Agreement summary */}
            {agreement && (
              <div className="glass rounded-lg p-3 text-xs space-y-1.5">
                <div className="font-display font-semibold text-white/70 mb-2">Agreement</div>
                {parties && (
                  <Detail label="Parties" value={`${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`} />
                )}
                {agreement.template_type != null && (
                  <Detail label="Template" value={String(agreement.template_type)} />
                )}
                {typeof agreement.total_amount === 'number' && (
                  <Detail label="Amount" value={formatIRM(agreement.total_amount as number)} />
                )}
                {agreement.payer != null && (
                  <Detail label="Payer" value={truncateAddr(String(agreement.payer), 8, 6)} />
                )}
                {agreement.payee != null && (
                  <Detail label="Payee" value={truncateAddr(String(agreement.payee), 8, 6)} />
                )}
              </div>
            )}

            {/* Events / timeline */}
            {(events?.length ?? 0) > 0 && (
              <div>
                <div className="font-display font-semibold text-white/70 text-xs mb-2">
                  Timeline ({events!.length} event{events!.length !== 1 ? 's' : ''})
                </div>
                <div className="space-y-1.5">
                  {events!.map((e, i) => {
                    const ev = e as Record<string, unknown>;
                    const kind = ev.kind ?? ev.event_type ?? ev.type ?? 'event';
                    return (
                      <div key={i} className="glass rounded-lg p-2.5 text-xs flex items-center justify-between">
                        <span className="font-mono text-white/70">{String(kind)}</span>
                        {ev.height != null && (
                          <span className="font-mono text-white/40">#{Number(ev.height).toLocaleString()}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Proofs */}
            {(auditProofs?.length ?? 0) > 0 && (
              <div>
                <div className="font-display font-semibold text-white/70 text-xs mb-2">
                  Proofs ({auditProofs!.length})
                </div>
                <div className="space-y-1.5">
                  {auditProofs!.map((p, i) => {
                    const pr = p as Record<string, unknown>;
                    const id = String(pr.proof_id ?? pr.id ?? `proof-${i}`);
                    const status = pr.status ?? pr.state;
                    return (
                      <div key={i} className="glass rounded-lg p-2.5 text-xs flex items-center justify-between">
                        <span className="font-mono text-white/50">{id.slice(0, 24)}</span>
                        {status != null && <span className="badge badge-info text-[10px]">{String(status)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Funding legs */}
            {(fundingLegs?.length ?? 0) > 0 && (
              <div>
                <div className="font-display font-semibold text-white/70 text-xs mb-2">
                  Funding ({fundingLegs!.length} leg{fundingLegs!.length !== 1 ? 's' : ''})
                </div>
                <div className="space-y-1.5">
                  {fundingLegs!.map((l, i) => {
                    const leg = l as Record<string, unknown>;
                    const txid = String(leg.txid ?? leg.funding_txid ?? '');
                    return (
                      <div key={i} className="glass rounded-lg p-2.5 text-xs space-y-1">
                        {txid && (
                          <div className="flex justify-between">
                            <span className="text-white/40">Txid</span>
                            <span className="font-mono text-white/70">{truncateHash(txid)}</span>
                          </div>
                        )}
                        {leg.value != null && (
                          <div className="flex justify-between">
                            <span className="text-white/40">Value</span>
                            <span className="font-mono text-white/70">{formatIRM(Number(leg.value))}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Linked transactions */}
            {(linkedTxs?.length ?? 0) > 0 && (
              <div>
                <div className="font-display font-semibold text-white/70 text-xs mb-2">
                  Linked Transactions ({linkedTxs!.length})
                </div>
                <div className="space-y-1.5">
                  {linkedTxs!.map((t, i) => {
                    const tx = t as Record<string, unknown>;
                    const txid = String(tx.txid ?? '');
                    return (
                      <div key={i} className="glass rounded-lg p-2.5 text-xs flex items-center justify-between">
                        <span className="font-mono text-white/70">{txid ? truncateHash(txid) : '—'}</span>
                        {tx.role != null && <span className="badge badge-info text-[10px]">{String(tx.role)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Policy evaluation */}
            {policy && (
              <div className="glass rounded-lg p-3 text-xs space-y-1.5">
                <div className="font-display font-semibold text-white/70 mb-2">Policy</div>
                {policy.outcome != null && <Detail label="Outcome" value={String(policy.outcome)} />}
                {policy.satisfied != null && <Detail label="Satisfied" value={policy.satisfied ? 'Yes' : 'No'} />}
                {policy.reason != null && <Detail label="Reason" value={String(policy.reason)} />}
                {policy.kind != null && <Detail label="Kind" value={String(policy.kind)} />}
              </div>
            )}

            {/* Raw JSON disclosure */}
            <div>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs text-irium-400 hover:text-irium-300"
              >
                {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
              </button>
              {showRaw && (
                <div className="mt-2 glass rounded-lg p-3">
                  <div className="flex justify-end mb-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(rawJson);
                        toast.success('Copied');
                      }}
                      className="text-xs text-irium-400 hover:text-irium-300 flex items-center gap-1"
                    >
                      <Copy size={11} /> Copy
                    </button>
                  </div>
                  <pre className="text-[10px] font-mono text-white/60 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
                    {rawJson}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Verify Signatures Row (Phase 7) ────────────────────────────
// File-picker driven verification. The local agreement store doesn't
// expose per-party signature paths, so the user picks a signature file
// (.sig or .json) and we run agreementStore.verifySignature(path, id).
// Results accumulate inline so the user can verify both buyer and seller
// signatures in one session without losing the previous result.

function VerifySignaturesRow({ agreementId }: { agreementId: string }) {
  const [results, setResults] = useState<Array<{ filename: string; valid: boolean; signer?: string; message?: string }>>([]);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    const path = await openFilePicker({
      extensions: ['sig', 'json'],
      title: 'Select Signature File',
    });
    if (!path) return;
    setVerifying(true);
    try {
      const r = await agreementStore.verifySignature(path, agreementId);
      const filename = path.split(/[\\/]/).pop() ?? path;
      setResults((prev) => [{ filename, valid: r.valid, signer: r.signer, message: r.message }, ...prev]);
      if (r.valid) toast.success(`Signature valid (signer ${r.signer ? r.signer.slice(0, 10) + '…' : 'unknown'})`);
      else toast.error('Signature invalid: ' + (r.message ?? 'rejected'));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="pt-3 border-t border-white/[0.05]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-white/35 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck size={12} /> Signatures
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleVerify(); }}
          disabled={verifying}
          className="btn-ghost text-xs py-1 px-2 text-irium-400 hover:text-irium-300 flex items-center gap-1"
          title="Verify a signature file (.sig or .json) against this agreement"
        >
          {verifying ? <RefreshCw size={11} className="animate-spin" /> : <PenLine size={11} />}
          Verify a Signature File…
        </button>
      </div>
      {results.length === 0 ? (
        <p className="text-[11px] text-white/40">No signatures verified yet. Use the button above to verify one.</p>
      ) : (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div
              key={i}
              className={`glass rounded-lg p-2 flex items-center gap-2 text-xs ${
                r.valid ? 'border border-green-500/30' : 'border border-red-500/30'
              }`}
            >
              {r.valid ? (
                <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
              ) : (
                <XCircle size={14} className="text-red-400 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-white/70 truncate">{r.filename}</div>
                {r.signer && (
                  <div className="font-mono text-[10px] text-white/40 truncate">signer {r.signer}</div>
                )}
                {!r.valid && r.message && (
                  <div className="text-[10px] text-red-300/80 truncate">{r.message}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sign Agreement Modal (Phase 7) ─────────────────────────────
// Calls agreementStore.sign(agreementId, signerAddr, role) where role
// auto-derives from whether the signer matches buyer or seller. If the
// preferred (currently-selected) wallet address isn't a party, the user
// can pick another wallet address from a dropdown. outPath is omitted
// so the wallet binary writes to its default signature location.

interface SignAgreementModalProps {
  agreement: Agreement;
  walletAddresses: string[];
  preferredAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

function SignAgreementModal({ agreement, walletAddresses, preferredAddress, onClose, onSuccess }: SignAgreementModalProps) {
  const initialAddr = (() => {
    if (preferredAddress && (preferredAddress === agreement.buyer || preferredAddress === agreement.seller)) {
      return preferredAddress;
    }
    // Fall back to whichever wallet address matches a party, else first wallet.
    return walletAddresses.find((a) => a === agreement.buyer || a === agreement.seller) ?? walletAddresses[0] ?? '';
  })();

  const [signerAddr, setSignerAddr] = useState(initialAddr);
  const [submitting, setSubmitting] = useState(false);

  const derivedRole =
    signerAddr === agreement.buyer ? 'buyer' :
    signerAddr === agreement.seller ? 'seller' :
    '';

  const handleSign = async () => {
    if (!signerAddr) return;
    setSubmitting(true);
    try {
      const r = await agreementStore.sign(agreement.id, signerAddr, derivedRole || undefined);
      if (r.success) {
        toast.success(
          <div className="flex flex-col gap-1">
            <span>Agreement signed.</span>
            {r.signature_path && (
              <span className="text-[10px] font-mono opacity-70 break-all">{r.signature_path}</span>
            )}
          </div>,
          { duration: 8000 },
        );
        onSuccess();
      } else {
        toast.error('Sign failed');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      key="sign-backdrop"
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
        className="glass-heavy w-full max-w-md rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
            <PenLine size={16} className="text-amber-400" /> Sign Agreement
          </h2>
          <button onClick={onClose} className="btn-ghost text-white/40">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-white/55 mb-4 leading-relaxed">
          Signing this agreement with your wallet key confirms your participation.
          Both parties must sign before funding.
        </p>

        <div className="glass rounded-lg p-3 mb-4 space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-white/40 flex-shrink-0">Agreement</span>
            <span className="font-mono text-white/70 text-right break-all">{agreement.id}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 flex-shrink-0">Buyer</span>
            <span className="font-mono text-white/70 text-right break-all">{agreement.buyer ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-white/40 flex-shrink-0">Seller</span>
            <span className="font-mono text-white/70 text-right break-all">{agreement.seller ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Amount</span>
            <span className="font-mono text-white/70">{formatIRM(agreement.amount)} IRM</span>
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Signer wallet address</label>
          <select
            value={signerAddr}
            onChange={(e) => setSignerAddr(e.target.value)}
            className="input text-xs"
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {walletAddresses.length === 0 && <option value="">No wallet addresses</option>}
            {walletAddresses.map((a) => (
              <option key={a} value={a} style={{ background: '#0f0f23', color: '#eef0ff' }}>
                {a} {a === agreement.buyer ? '(buyer)' : a === agreement.seller ? '(seller)' : ''}
              </option>
            ))}
          </select>
          {derivedRole ? (
            <p className="text-[11px] text-irium-300 mt-1.5">Role: <strong>{derivedRole}</strong></p>
          ) : (
            <p className="text-[11px] text-amber-400 mt-1.5">
              This address is not the buyer or seller — signing will be recorded without a party role.
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button
            onClick={handleSign}
            disabled={submitting || !signerAddr}
            className="btn-primary flex-1 justify-center disabled:opacity-40"
          >
            {submitting ? <RefreshCw size={14} className="animate-spin" /> : <><PenLine size={13} /> Sign</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Disputes View (Phase 7) ────────────────────────────────────
// Top-level alternate view for the Agreements page. Lists DisputeEntry
// records returned by the wallet's agreement-dispute-list command. Each
// row links back to the underlying agreement in the agreements view.

interface DisputesViewProps {
  agreementsById: Record<string, Agreement>;
  onOpenAgreement: (id: string) => void;
  isOnline: boolean;
}

function DisputesView({ agreementsById, onOpenAgreement, isOnline }: DisputesViewProps) {
  const [list, setList] = useState<DisputeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const data = await disputes.list();
      setList(data);
    } catch {
      // Suppress when offline — empty state communicates.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // Real-time refresh on dispute lifecycle events.
  useIriumEvents((event) => {
    if (event.type === 'agreement.disputed' || event.type === 'agreement.satisfied') {
      refresh();
    }
  });

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-4 h-20 shimmer rounded-xl" />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="text-center py-20 text-white/30 text-sm flex flex-col items-center gap-3">
        <Gavel size={32} className="opacity-30" />
        <div>No disputes.{!isOnline && ' (Node is offline — dispute list may be unavailable.)'}</div>
      </div>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-3">
      {list.map((d) => (
        <motion.div key={d.id} variants={itemVariants} className="card p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Gavel size={14} className="text-amber-400 flex-shrink-0" />
            <span className="font-mono text-xs text-white/70">{d.id.slice(0, 14)}</span>
            <span className={`badge ${d.status === 'open' || d.status === 'pending' ? 'badge-warning' : 'badge-info'}`}>
              {d.status}
            </span>
            <div className="ml-auto flex items-center gap-2 text-[11px] text-white/40">
              {d.opened_at != null && <span>opened {timeAgo(d.opened_at)}</span>}
              {d.resolved_at != null && <span>· resolved {timeAgo(d.resolved_at)}</span>}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-white/40">Agreement</span>
              <button
                onClick={() => onOpenAgreement(d.agreement_id)}
                className="font-mono text-irium-400 hover:text-irium-300 underline underline-offset-2"
                title={agreementsById[d.agreement_id] ? 'Open this agreement' : 'Agreement not in current list — try refreshing the Agreements view'}
              >
                {truncateHash(d.agreement_id, 10)}
              </button>
            </div>
            {d.reason && (
              <div className="text-white/55 mt-1">
                <span className="text-white/40">Reason: </span>
                {d.reason}
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
