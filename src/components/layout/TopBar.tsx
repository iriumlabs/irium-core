import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Play, Square, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import { node } from '../../lib/tauri';
import { startAggressivePoll } from '../../hooks/useNodePoller';
import { formatIRM, getAddressBadgeText } from '../../lib/types';
import type { NodeStatus } from '../../lib/types';
import clsx from 'clsx';
import toast from 'react-hot-toast';

const TopBar = memo(function TopBar() {
  const nodeStatus      = useStore((s) => s.nodeStatus);
  const balance         = useStore((s) => s.balance);
  const addresses       = useStore((s) => s.addresses);
  const activeAddrIdx   = useStore((s) => s.activeAddrIdx);
  const addressLabels   = useStore((s) => s.addressLabels);
  const notifications      = useStore((s) => s.notifications);
  const dismiss            = useStore((s) => s.dismissNotification);
  const clearAll           = useStore((s) => s.clearAllNotifications);
  const addNotification    = useStore((s) => s.addNotification);
  const nodeStarting       = useStore((s) => s.nodeStarting);
  const setNodeStarting    = useStore((s) => s.setNodeStarting);
  const setNodeOperation   = useStore((s) => s.setNodeOperation);
  const externalIp         = useStore((s) => s.settings.external_ip);

  const [showNotifs, setShowNotifs]         = useState(false);
  const [pendingRunning, setPendingRunning] = useState<boolean | null>(null);
  const [balanceGlowing, setBalanceGlowing] = useState(false);
  const prevBalance = useRef<number | null>(null);
  const notifRef    = useRef<HTMLDivElement>(null);

  // The TopBar mirrors whichever address the user has selected on the Wallet
  // page (or the primary by default). The fallback to wallet-wide
  // balance.confirmed only applies before addresses have loaded for the first
  // time — once addresses is non-empty we trust addresses[idx].balance (which
  // may be 0 for an empty address, or undefined if the per-address RPC
  // balance call timed out). Without this gating, a slow node could cause the
  // TopBar to show the wallet-wide aggregate while the Wallet page's hero
  // correctly shows 0 for the selected address.
  const displayedConfirmed = addresses.length > 0
    ? (addresses[activeAddrIdx]?.balance ?? 0)
    : (balance?.confirmed ?? 0);
  // Badge text mirrors the wallet hero / address card / manage panel via
  // the shared getAddressBadgeText helper, so custom labels (e.g.
  // "Mining") propagate everywhere automatically.
  const activeAddr = addresses[activeAddrIdx]?.address;
  const balanceLabelText = addresses.length > 0 && activeAddr
    ? getAddressBadgeText(activeAddr, activeAddrIdx, addressLabels)
    : null;

  useEffect(() => {
    if (prevBalance.current !== null && displayedConfirmed > prevBalance.current) {
      setBalanceGlowing(true);
      const t = setTimeout(() => setBalanceGlowing(false), 2000);
      return () => clearTimeout(t);
    }
    prevBalance.current = displayedConfirmed;
  }, [displayedConfirmed]);

  useEffect(() => {
    if (!showNotifs) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifs]);

  // Sync pendingRunning back to null once the poller confirms the actual state matches.
  useEffect(() => {
    if (pendingRunning === null) return;
    if (nodeStatus?.running === pendingRunning) setPendingRunning(null);
  }, [nodeStatus?.running, pendingRunning]);

  // isRunning: optimistic pending → nodeStarting keeps button as "Stop" while launching → real state
  const isRunning = pendingRunning !== null
    ? pendingRunning
    : nodeStarting
    ? true
    : (nodeStatus?.running ?? false);

  const unread = notifications.length;

  const handleToggleNode = useCallback(async () => {
    const next = !isRunning;
    setPendingRunning(next);
    const revert = () => setPendingRunning(null);

    try {
      if (!next) {
        // Stop: cancel any in-progress startup too
        setNodeStarting(false);
        setNodeOperation(null);
        await node.stop();
        toast('Node stopping…', { icon: '🔴' });
        addNotification({ type: 'info', title: 'Node stopping…' });
        startAggressivePoll(6_000);
      } else {
        setNodeOperation('starting');
        const result = await node.start(undefined, externalIp);
        if (!result.success) {
          revert();
          setNodeOperation(null);
          toast.error(result.message);
          addNotification({ type: 'error', title: 'Failed to start node', message: result.message });
          return;
        }
        setNodeStarting(true);
        addNotification({ type: 'info', title: 'Node starting…', message: result.message });
        startAggressivePoll(15_000);
      }
    } catch (e: unknown) {
      revert();
      setNodeStarting(false);
      const msg = String(e);
      toast.error(msg);
      addNotification({ type: 'error', title: 'Error', message: msg });
    }
  }, [isRunning, addNotification, setNodeStarting, setNodeOperation]);

  return (
    <header
      className="flex items-center justify-between px-8 flex-shrink-0"
      style={{
        height: 'var(--topbar-h)',
        background: 'rgba(2, 5, 14, 0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        position: 'relative',
        zIndex: 40,
      }}
    >
      {/* Left: Node status pill */}
      <div className="flex items-center gap-3">
        <NodeStatusPill status={nodeStatus} nodeStarting={nodeStarting} />
        {nodeStatus?.running && (
          <div
            className="hidden sm:flex items-center gap-2 text-xs"
            style={{ fontFamily: '"JetBrains Mono", monospace', color: 'rgba(110,198,255,0.50)' }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={nodeStatus.height}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0,  opacity: 1 }}
                exit={{    y: -10, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="block"
              >
                #{nodeStatus.height.toLocaleString()}
              </motion.span>
            </AnimatePresence>
            <span style={{ color: 'rgba(238,240,255,0.15)' }}>·</span>
            <span>{nodeStatus.peers}p</span>
          </div>
        )}
      </div>

      {/* Center: Balance of the currently selected address (mirrors the
          wallet hero). Falls back to total confirmed only if the addresses
          list hasn't loaded yet. */}
      {(addresses.length > 0 || balance) && (
        <div
          className="flex items-baseline gap-2"
          title={
            balanceLabelText
              ? `${balanceLabelText} address balance`
              : 'Wallet balance'
          }
        >
          {/* Balance — same gradient as the page titles (`.page-title`),
              applied with the bullet-proof combo: `backgroundImage` only
              (NOT the `background` shorthand — that also sets background-
              color and the clipped colour paints the bounding box, which
              is what produced the "black highlight" artifact earlier),
              explicit `color: transparent`, and `display: inline-block`
              so background-clip:text has a positioned box to clip against
              in WebView2. */}
          <motion.span
            className={clsx(
              'font-display font-bold leading-none',
              balanceGlowing ? 'glow-green' : '',
            )}
            style={{
              fontSize: 18,
              letterSpacing: '0.01em',
              display: 'inline-block',
              backgroundImage: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {formatIRM(displayedConfirmed)}
          </motion.span>
          {balanceLabelText && (
            <span
              className="ml-2 text-[9px] font-display font-bold uppercase px-1.5 py-0.5 rounded-full"
              style={{
                color: '#6ec6ff',
                background: 'rgba(110,198,255,0.10)',
                border: '1px solid rgba(110,198,255,0.28)',
                letterSpacing: '0.14em',
              }}
            >
              {balanceLabelText}
            </span>
          )}
          {balance && balance.unconfirmed > 0 && (
            <span
              className="text-xs font-display font-semibold"
              style={{ color: '#fbbf24' }}
              title="Unconfirmed (incoming) balance"
            >
              +{formatIRM(balance.unconfirmed)}
            </span>
          )}
        </div>
      )}

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Node toggle */}
        <motion.button
          onClick={handleToggleNode}
          whileTap={{ scale: 0.94 }}
          className={clsx(
            'flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-display font-semibold',
            'transition-colors duration-150',
          )}
          style={isRunning ? {
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.22)',
            color: '#f87171',
            boxShadow: '0 0 12px rgba(239,68,68,0.10)',
          } : {
            background: 'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
            border: '1px solid rgba(110,198,255,0.40)',
            color: '#fff',
            boxShadow: '0 4px 14px rgba(59,59,255,0.30), 0 0 18px rgba(110,198,255,0.18)',
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isRunning ? 'stop' : 'start'}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.12 }}
              className="flex items-center gap-1.5"
            >
              {isRunning
                ? <><Square size={12} fill="currentColor" /> Stop</>
                : <><Play   size={12} fill="currentColor" /> Start Node</>
              }
            </motion.span>
          </AnimatePresence>
        </motion.button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-150"
            style={{
              background: showNotifs ? 'rgba(110,198,255,0.12)' : 'rgba(0,0,0,0.30)',
              border: `1px solid ${showNotifs ? 'rgba(110,198,255,0.36)' : 'rgba(110,198,255,0.12)'}`,
              color: showNotifs ? '#6ec6ff' : 'rgba(238,240,255,0.50)',
            }}
          >
            <Bell size={14} />
            <AnimatePresence>
              {unread > 0 && (
                <motion.span
                  key="badge"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold"
                  style={{
                    background: 'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 60%, #a78bfa 100%)',
                    boxShadow: '0 0 10px rgba(110,198,255,0.55)',
                  }}
                >
                  {unread > 9 ? '9+' : unread}
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          {/* Dropdown */}
          <AnimatePresence>
            {showNotifs && (
              <motion.div
                key="notif-panel"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{    opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute right-0 top-full mt-2 w-80 z-50 overflow-hidden"
                style={{
                  background: 'rgba(2, 5, 14, 0.96)',
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid rgba(110,198,255,0.26)',
                  borderRadius: 16,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(110,198,255,0.06)',
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: '1px solid rgba(110,198,255,0.10)' }}
                >
                  <span className="font-display font-semibold text-sm" style={{ color: 'var(--t1)' }}>
                    Notifications
                  </span>
                  <div className="flex items-center gap-1.5">
                    {notifications.length > 0 && (
                      <button
                        onClick={clearAll}
                        className="text-xs px-2 py-0.5 rounded-md transition-all duration-150"
                        style={{ color: 'rgba(238,240,255,0.40)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        Clear all
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifs(false)}
                      className="w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-150"
                      style={{ color: 'rgba(238,240,255,0.35)', background: 'rgba(255,255,255,0.04)' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center" style={{ color: 'rgba(238,240,255,0.25)', fontSize: 13 }}>
                      No notifications
                    </div>
                  ) : (
                    notifications
                      .slice()
                      .reverse()
                      .map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-3 px-4 py-3 group transition-colors duration-100"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <NotifDot type={n.type} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{n.title}</div>
                            {n.message && (
                              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--t3)' }}>{n.message}</div>
                            )}
                          </div>
                          <button
                            onClick={() => dismiss(n.id)}
                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 transition-all w-5 h-5 rounded-md flex items-center justify-center"
                            style={{ color: 'rgba(238,240,255,0.30)', background: 'rgba(255,255,255,0.06)' }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
});

export default TopBar;

const NodeStatusPill = memo(function NodeStatusPill({
  status,
  nodeStarting,
}: {
  status: NodeStatus | null;
  nodeStarting: boolean;
}) {
  if (!status?.running) {
    if (nodeStarting) {
      return (
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
          style={{
            background: 'rgba(110,198,255,0.10)',
            border: '1px solid rgba(110,198,255,0.30)',
          }}
        >
          <Loader2 size={12} className="animate-spin" style={{ color: '#6ec6ff' }} />
          <span className="text-xs font-display font-semibold" style={{ color: '#6ec6ff' }}>
            Starting…
          </span>
        </div>
      );
    }
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.20)',
        }}
      >
        <WifiOff size={12} style={{ color: '#fbbf24' }} />
        <span className="text-xs font-display font-semibold" style={{ color: '#fbbf24' }}>
          Offline
        </span>
      </div>
    );
  }
  // Running but no peers yet — still bootstrapping
  if (status.peers === 0) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
        style={{
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.22)',
        }}
      >
        <span className="dot-syncing" />
        <span className="text-xs font-display font-semibold" style={{ color: '#818cf8' }}>
          Connecting
        </span>
      </div>
    );
  }
  if (!status.synced) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.20)',
        }}
      >
        <span className="dot-syncing" />
        <span className="text-xs font-display font-semibold" style={{ color: '#fbbf24' }}>
          Syncing
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
      style={{
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.22)',
      }}
    >
      <span className="dot-live" />
      <span className="text-xs font-display font-semibold" style={{ color: '#34d399' }}>
        Live
      </span>
    </div>
  );
});

const NotifDot = memo(function NotifDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    success: '#34d399',
    error:   '#f87171',
    warning: '#fbbf24',
    info:    '#60a5fa',
  };
  const color = colors[type] ?? 'rgba(255,255,255,0.4)';
  return (
    <span
      className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
});
