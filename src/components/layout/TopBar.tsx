import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Play, Square, Wifi, WifiOff } from 'lucide-react';
import { useStore } from '../../lib/store';
import { node } from '../../lib/tauri';
import { startAggressivePoll } from '../../hooks/useNodePoller';
import { formatIRM } from '../../lib/types';
import type { NodeStatus } from '../../lib/types';
import clsx from 'clsx';
import toast from 'react-hot-toast';

const TopBar = memo(function TopBar() {
  const nodeStatus      = useStore((s) => s.nodeStatus);
  const balance         = useStore((s) => s.balance);
  const notifications      = useStore((s) => s.notifications);
  const dismiss            = useStore((s) => s.dismissNotification);
  const clearAll           = useStore((s) => s.clearAllNotifications);
  const addNotification    = useStore((s) => s.addNotification);
  const nodeStarting       = useStore((s) => s.nodeStarting);
  const setNodeStarting    = useStore((s) => s.setNodeStarting);

  const [showNotifs, setShowNotifs]         = useState(false);
  const [pendingRunning, setPendingRunning] = useState<boolean | null>(null);
  const [balanceGlowing, setBalanceGlowing] = useState(false);
  const prevBalance = useRef<number | null>(null);
  const notifRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const confirmed = balance?.confirmed ?? null;
    if (confirmed !== null && prevBalance.current !== null && confirmed > prevBalance.current) {
      setBalanceGlowing(true);
      const t = setTimeout(() => setBalanceGlowing(false), 2000);
      return () => clearTimeout(t);
    }
    prevBalance.current = confirmed;
  }, [balance?.confirmed]);

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
        await node.stop();
        toast('Node stopping…', { icon: '🔴' });
        addNotification({ type: 'info', title: 'Node stopping…' });
        startAggressivePoll(6_000);
      } else {
        const result = await node.start();
        if (!result.success) {
          revert();
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
  }, [isRunning, addNotification, setNodeStarting]);

  return (
    <header
      className="flex items-center justify-between px-5 flex-shrink-0"
      style={{
        height: 'var(--topbar-h)',
        background: 'rgba(8, 11, 20, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Left: Node status pill */}
      <div className="flex items-center gap-3">
        <NodeStatusPill status={nodeStatus} />
        {nodeStatus?.running && (
          <div
            className="hidden sm:flex items-center gap-2 text-xs"
            style={{ fontFamily: '"JetBrains Mono", monospace', color: 'rgba(238,240,255,0.30)' }}
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

      {/* Center: Balance */}
      {balance && (
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end">
            <div className="flex items-baseline gap-1.5">
              <motion.span
                className={clsx(
                  'font-display font-bold text-base leading-none',
                  balanceGlowing ? 'glow-green' : '',
                )}
                style={{
                  background: 'linear-gradient(90deg, #A78BFA 0%, #60A5FA 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {formatIRM(balance.confirmed)}
              </motion.span>
              {balance.unconfirmed > 0 && (
                <span
                  className="text-xs font-display"
                  style={{ color: '#fbbf24' }}
                >
                  +{formatIRM(balance.unconfirmed)}
                </span>
              )}
            </div>
            <span
              className="text-[10px] uppercase tracking-widest mt-0.5"
              style={{ fontFamily: '"JetBrains Mono", monospace', color: 'rgba(238,240,255,0.25)' }}
            >
              Balance
            </span>
          </div>
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
            background: 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(59,130,246,0.12) 100%)',
            border: '1px solid rgba(139,92,246,0.30)',
            color: '#A78BFA',
            boxShadow: '0 0 12px rgba(139,92,246,0.12)',
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
              background: showNotifs ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showNotifs ? 'rgba(139,92,246,0.30)' : 'rgba(255,255,255,0.07)'}`,
              color: showNotifs ? '#A78BFA' : 'rgba(238,240,255,0.40)',
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
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)',
                    boxShadow: '0 0 8px rgba(139,92,246,0.6)',
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
                  background: 'rgba(10, 13, 28, 0.92)',
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid rgba(139,92,246,0.20)',
                  borderRadius: 16,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)',
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
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

const NodeStatusPill = memo(function NodeStatusPill({ status }: { status: NodeStatus | null }) {
  if (!status || !status.running) {
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
