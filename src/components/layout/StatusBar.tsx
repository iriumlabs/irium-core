import { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useStore } from '../../lib/store';

const CHAIN_NODES = 7;

const StatusBar = memo(function StatusBar() {
  const nodeStatus = useStore((s) => s.nodeStatus);
  const rpcUrl     = useStore((s) => s.settings.rpc_url);

  const height  = nodeStatus?.height       ?? 0;
  const tipH    = nodeStatus?.network_tip  ?? 0;
  const synced  = nodeStatus?.synced       ?? false;
  const running = nodeStatus?.running      ?? false;
  const peers   = nodeStatus?.peers        ?? 0;
  const upnp    = nodeStatus?.upnp_active  ?? false;

  const syncPct = running && tipH > 0 ? Math.min(100, (height / tipH) * 100) : 0;

  // Flash the height digit on new block
  const prevHeightRef = useRef(0);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (height > 0 && height !== prevHeightRef.current) {
      prevHeightRef.current = height;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(id);
    }
  }, [height]);

  const peerColor = !running
    ? 'rgba(238,240,255,0.18)'
    : peers >= 3 ? '#34d399'
    : peers >= 1 ? '#fbbf24'
    : '#f87171';

  // How many chain nodes to fill based on sync
  const filledCount = running ? Math.round((syncPct / 100) * CHAIN_NODES) : 0;

  const handleCopyTip = async () => {
    if (!nodeStatus?.tip) return;
    try {
      await navigator.clipboard.writeText(nodeStatus.tip);
      toast.success('Tip hash copied');
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div
      className="relative flex items-center justify-between px-4 flex-shrink-0 overflow-hidden"
      style={{
        height: 26,
        background: 'rgba(8,11,20,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
        color: 'rgba(238,240,255,0.22)',
      }}
    >
      {/* ── Sync progress bar at bottom edge ──────────────────── */}
      <AnimatePresence>
        {running && !synced && tipH > 0 && (
          <motion.div
            key="progress"
            className="absolute bottom-0 left-0 h-px"
            style={{
              background: 'linear-gradient(90deg, rgba(139,92,246,0.85), rgba(59,130,246,0.70))',
              boxShadow: '0 0 4px rgba(139,92,246,0.6)',
            }}
            initial={{ width: 0 }}
            animate={{ width: `${syncPct}%` }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        )}
        {running && synced && (
          <motion.div
            key="synced-flash"
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, rgba(52,211,153,0.6), rgba(59,130,246,0.4))' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.6 }}
          />
        )}
      </AnimatePresence>

      {/* ── Left section ──────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Brand + version */}
        <span style={{ color: 'rgba(138,92,246,0.75)', fontWeight: 600, letterSpacing: '0.02em' }}>
          Irium Core
        </span>
        <span style={{ color: 'rgba(138,92,246,0.40)', fontSize: 10 }}>v1.0.0</span>
        <Dot />
        <span style={{ color: 'rgba(238,240,255,0.30)' }}>Mainnet</span>

        {/* Chain node visualisation */}
        {running && (
          <>
            <Dot />
            <div className="flex items-center gap-[4px]" title={`Sync: ${syncPct.toFixed(1)}%`}>
              {Array.from({ length: CHAIN_NODES }).map((_, i) => {
                const filled   = i < filledCount;
                const isActive = i === filledCount - 1 && !synced;
                return (
                  <motion.span
                    key={i}
                    className="inline-block rounded-full"
                    style={{
                      width: 5,
                      height: 5,
                      background: synced
                        ? '#34d399'
                        : filled
                          ? (isActive ? '#a78bfa' : 'rgba(139,92,246,0.55)')
                          : 'rgba(255,255,255,0.09)',
                      boxShadow: (synced || isActive)
                        ? `0 0 5px ${synced ? '#34d399' : '#a78bfa'}`
                        : 'none',
                    }}
                    animate={
                      synced
                        ? { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }
                        : isActive
                          ? { scale: [1, 1.5, 1], opacity: [0.6, 1, 0.6] }
                          : {}
                    }
                    transition={{
                      duration: synced ? 2.8 : 1.1,
                      delay: synced ? i * 0.35 : 0,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Block height — flips on new block */}
        {running && height > 0 && (
          <>
            <Dot />
            <div
              className="flex items-center gap-0.5 overflow-hidden"
              style={{ height: 14 }}
            >
              <span style={{ color: 'rgba(238,240,255,0.20)' }}>#</span>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={height}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1, color: flash ? '#c4b5fd' : 'rgba(238,240,255,0.50)' }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {height.toLocaleString()}
                </motion.span>
              </AnimatePresence>
            </div>
          </>
        )}

        {/* Sync % while syncing, or "synced" when done */}
        {running && !synced && tipH > 0 && (
          <>
            <Dot />
            <motion.span
              style={{ color: '#fbbf24' }}
              animate={{ opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              {syncPct.toFixed(1)}%
            </motion.span>
          </>
        )}
        {running && synced && (
          <>
            <Dot />
            <motion.span
              style={{ color: '#34d399' }}
              animate={{ opacity: [0.75, 1, 0.75] }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              synced
            </motion.span>
          </>
        )}

        {/* Peer indicator */}
        {running && (
          <>
            <Dot />
            <div className="flex items-center gap-1.5">
              <motion.span
                className="inline-block rounded-full"
                style={{ width: 6, height: 6, background: peerColor }}
                animate={{
                  boxShadow: peers > 0
                    ? [`0 0 0px ${peerColor}`, `0 0 7px ${peerColor}`, `0 0 0px ${peerColor}`]
                    : 'none',
                }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <span style={{ color: 'rgba(238,240,255,0.38)' }}>{peers}p</span>
            </div>
          </>
        )}

        {/* UPnP indicator — only show when active to avoid startup flash */}
        {running && upnp && (
          <>
            <Dot />
            <span
              title="UPnP active — port 38291 mapped on router, inbound peers enabled"
              style={{ color: 'rgba(52,211,153,0.75)', fontSize: 10, letterSpacing: '0.04em' }}
            >
              UPnP
            </span>
          </>
        )}

        {/* RPC URL when node not running */}
        {!running && (
          <>
            <Dot />
            <span style={{ color: 'rgba(238,240,255,0.13)' }}>{rpcUrl}</span>
          </>
        )}
      </div>

      {/* ── Right: tip hash ───────────────────────────────────── */}
      {nodeStatus?.tip && (
        <motion.div
          className="flex items-center gap-1.5 cursor-pointer"
          style={{ color: 'rgba(238,240,255,0.20)' }}
          onClick={handleCopyTip}
          whileHover={{ color: 'rgba(167,139,250,0.65)' }}
          title="Click to copy tip hash"
        >
          <span style={{ color: 'rgba(238,240,255,0.11)' }}>tip</span>
          <span>{nodeStatus.tip.slice(0, 8)}…{nodeStatus.tip.slice(-6)}</span>
        </motion.div>
      )}
    </div>
  );
});

function Dot() {
  return <span style={{ color: 'rgba(255,255,255,0.09)' }}>·</span>;
}

export default StatusBar;
