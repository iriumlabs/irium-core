import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { AlertTriangle, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { node } from '../lib/tauri';

// Banner shown at the top of the Dashboard and Miner pages when
// scan_quarantined_blocks (run once per session in App.tsx) reports a
// non-zero file count. Quarantined blocks live on disk under
// $IRIUM_DATA_DIR/blocks/orphaned_*/ — they are blocks iriumd persisted
// during a partial write that the next start couldn't validate. They
// don't break anything on their own, but they don't count toward
// mining history or chain stats, so we surface them so the user can
// recover.
//
// FIX #129 (2026-05-22): "Recover Now" used to navigate to /help and
// leave the user to find the clear flow themselves. The clear command
// also refuses when the node is running, but the banner didn't expose
// that constraint — clicking the button looked like a no-op. Worse,
// even after a successful clear from /help, this banner stayed up
// because QuarantineRecovery wrote to local state, not the global
// store. This rewrite (a) does the clear in-place when the node is
// stopped, (b) shows a Stop Node action when it isn't, and (c) zeros
// quarantinedBlockCount on success so the banner self-dismisses.
//
// The dismiss X still hides the banner for the current session
// without clearing anything — kept for users who want to defer.
export default function QuarantineRecoveryBanner() {
  const { t } = useTranslation();
  const count = useStore((s) => s.quarantinedBlockCount);
  const dirCount = useStore((s) => s.quarantinedDirCount);
  const dismissed = useStore((s) => s.quarantineBannerDismissed);
  const dismiss = useStore((s) => s.dismissQuarantineBanner);
  const setQuarantinedBlockCount = useStore((s) => s.setQuarantinedBlockCount);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const nodeRunning = nodeStatus?.running ?? false;
  const [busy, setBusy] = useState<'stopping' | 'clearing' | null>(null);
  // Persisted dismissal fingerprint in localStorage.
  // null = never dismissed; number = orphan-dir count we dismissed at.
  // Banner stays hidden while the stored number is >= the current scanned
  // dir count, so a fresh quarantine batch (dir count climbs) re-surfaces
  // the banner while the user's earlier dismissal still suppresses the
  // already-known set.
  const STORAGE_KEY = 'irium-quarantine-dismissed-dir-count';
  // Captured-at-mount: the dir count from a PREVIOUS launch. Compared
  // against the current dirCount to decide whether to surface the banner.
  // The actual write happens in the useEffect below — by the time that
  // effect fires, persistedDismissedDirs already holds the OLD value, so
  // the gate decision below is unaffected by the same-render write.
  const [persistedDismissedDirs] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });

  // FIX B: auto-persist the current dir count as the suppress-baseline
  // whenever the scan reports a non-zero number. Combined with the gate
  // below (`persistedDismissedDirs >= dirCount`), this means:
  //   - first launch ever with N dirs: previousSeenDirs is null → banner
  //     shows once. App writes N to localStorage.
  //   - next launch with same N dirs (or fewer, after v1.9.72 7-day prune):
  //     previousSeenDirs(N) >= dirCount → banner suppressed automatically,
  //     no user dismiss click needed.
  //   - next launch with N+M dirs (genuine new corruption): previousSeenDirs(N)
  //     < dirCount(N+M) → banner shows again, with the new higher number.
  // Existing user-dismiss + recover flows still write to the same key,
  // so the explicit-dismiss path remains intact.
  useEffect(() => {
    if (dirCount > 0) {
      try { localStorage.setItem(STORAGE_KEY, String(dirCount)); } catch { /* non-fatal */ }
    }
  }, [dirCount]);

  if (count <= 0 || dismissed) return null;
  if (persistedDismissedDirs !== null && persistedDismissedDirs >= dirCount) return null;

  const handleStopNode = async () => {
    if (busy) return;
    setBusy('stopping');
    try {
      const ok = await node.stop();
      if (ok) {
        toast.success(t('quarantine_banner.toast_node_stopped'));
        // The Dashboard's poll loop will flip nodeStatus.running to false
        // within ~1s; we leave nodeRunning derivation to that signal.
      } else {
        toast.error(t('quarantine_banner.toast_node_stop_failed'));
      }
    } catch (e) {
      toast.error(t('quarantine_banner.toast_node_stop_failed_reason', { reason: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const handleRecover = async () => {
    if (busy) return;
    setBusy('clearing');
    try {
      const result = await node.clearQuarantinedBlocks();
      if (!result) {
        toast.error(t('quarantine_banner.toast_recover_failed', { reason: 'no response' }));
        return;
      }
      if (result.errors.length > 0) {
        toast.error(
          t('quarantine_banner.toast_recover_partial', {
            files: result.deleted_files,
            reason: result.errors[0],
          }),
        );
      } else {
        toast.success(t('quarantine_banner.toast_recovered', { files: result.deleted_files }));
      }
      // Zero the store so the banner self-dismisses via the count <= 0 guard.
      // The next session-start scan in App.tsx will surface any new
      // quarantine that appears later.
      setQuarantinedBlockCount(0);
      // Clean slate: drop the dismissal fingerprint so the next launch
      // starts from "never dismissed" instead of a stale count. Now in
      // localStorage (FIX 1) — was a Tauri RPC against an app-data file.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
    } catch (e) {
      toast.error(t('quarantine_banner.toast_recover_failed', { reason: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="relative flex items-center gap-3 rounded-xl px-5 py-4 overflow-hidden"
      style={{
        background: 'rgba(245,158,11,0.15)',
        border: '1px solid rgba(245,158,11,0.55)',
        boxShadow: '0 0 24px rgba(245,158,11,0.10)',
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.40)' }}
      >
        <AlertTriangle size={18} style={{ color: '#fbbf24' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-display font-bold" style={{ color: '#fbbf24' }}>
          {t('quarantine_banner.title', { count })}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(238,240,255,0.65)' }}>
          {nodeRunning
            ? t('quarantine_banner.node_running_caption')
            : t('quarantine_banner.subtitle')}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {nodeRunning ? (
          <button
            onClick={handleStopNode}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(245,158,11,0.16)',
              border: '1px solid rgba(245,158,11,0.55)',
              color: '#fff',
              boxShadow: '0 0 16px rgba(245,158,11,0.18)',
            }}
            onMouseEnter={(e) => {
              if (busy === null) {
                e.currentTarget.style.background = 'rgba(245,158,11,0.24)';
                e.currentTarget.style.borderColor = 'rgba(245,158,11,0.75)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(245,158,11,0.16)';
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.55)';
            }}
          >
            {busy === 'stopping' ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Square size={14} />
            )}
            {busy === 'stopping'
              ? t('quarantine_banner.stopping_node')
              : t('quarantine_banner.stop_node_button')}
          </button>
        ) : (
          <button
            onClick={handleRecover}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(245,158,11,0.16)',
              border: '1px solid rgba(245,158,11,0.55)',
              color: '#fff',
              boxShadow: '0 0 16px rgba(245,158,11,0.18)',
            }}
            onMouseEnter={(e) => {
              if (busy === null) {
                e.currentTarget.style.background = 'rgba(245,158,11,0.24)';
                e.currentTarget.style.borderColor = 'rgba(245,158,11,0.75)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(245,158,11,0.16)';
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.55)';
            }}
          >
            {busy === 'clearing' ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            {busy === 'clearing'
              ? t('quarantine_banner.clearing')
              : t('quarantine_banner.recover_now')}
          </button>
        )}
        <button
          onClick={() => {
            // FIX 1: persist the orphan-dir fingerprint to localStorage so
            // this same quarantine state stays dismissed across launches.
            // A future quarantine batch raises dirCount above this number
            // and the banner re-surfaces, preserving the signal for new
            // corruption. Was a Tauri RPC; now pure browser storage.
            try { localStorage.setItem(STORAGE_KEY, String(dirCount)); } catch { /* non-fatal */ }
            dismiss();
          }}
          aria-label={t('quarantine_banner.dismiss')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-display font-semibold transition-all active:scale-[0.97]"
          style={{
            background: 'transparent',
            border: '1px solid rgba(245,158,11,0.35)',
            color: 'rgba(251,191,36,0.95)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(245,158,11,0.10)';
            e.currentTarget.style.borderColor = 'rgba(245,158,11,0.60)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(245,158,11,0.35)';
          }}
        >
          <X size={14} />
          {t('quarantine_banner.dismiss')}
        </button>
      </div>
    </div>
  );
}
