import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { X, Download, Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar    from './components/layout/Sidebar';
import TopBar     from './components/layout/TopBar';
import StatusBar  from './components/layout/StatusBar';
import TitleBar   from './components/layout/TitleBar';
import NetworkBackground from './components/layout/NetworkBackground';
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Wallet       = lazy(() => import('./pages/Wallet'));
const Settlement   = lazy(() => import('./pages/Settlement'));
const Marketplace  = lazy(() => import('./pages/Marketplace'));
const Agreements   = lazy(() => import('./pages/Agreements'));
const Reputation   = lazy(() => import('./pages/Reputation'));
const Miner        = lazy(() => import('./pages/Miner'));
const Settings     = lazy(() => import('./pages/Settings'));
const Explorer     = lazy(() => import('./pages/Explorer'));
const SellerWizard = lazy(() => import('./pages/SellerWizard'));
const BuyerWizard  = lazy(() => import('./pages/BuyerWizard'));
const Logs         = lazy(() => import('./pages/Logs'));
const About        = lazy(() => import('./pages/About'));
import Onboarding, { ONBOARDING_KEY, Splash } from './pages/Onboarding';
import { useNodePoller } from './hooks/useNodePoller';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { node, config, update } from './lib/tauri';
import { useStore } from './lib/store';
import type { UpdateCheckResult } from './lib/types';

function SyncProgressBanner() {
  const nodeStatus    = useStore((s) => s.nodeStatus);
  const nodeOperation = useStore((s) => s.nodeOperation);

  const running = nodeStatus?.running ?? false;
  const synced  = nodeStatus?.synced  ?? false;
  const height  = nodeStatus?.height  ?? 0;
  const tip     = nodeStatus?.network_tip ?? 0;
  const peers   = nodeStatus?.peers   ?? 0;

  // Show only while syncing — hide if no operation banner is already shown elsewhere
  const show = running && !synced && !nodeOperation;
  const pct  = tip > 0 ? Math.min(100, (height / tip) * 100) : 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="sync-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden flex-shrink-0"
          style={{
            background: 'rgba(245,158,11,0.06)',
            borderBottom: '1px solid rgba(245,158,11,0.14)',
          }}
        >
          <div className="flex items-center gap-3 px-4 py-2">
            <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: '#fbbf24' }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs mb-1">
                <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                  {tip > 0 ? 'Syncing blockchain…' : 'Connecting to peers…'}
                </span>
                {tip > 0 && (
                  <span style={{ color: 'rgba(238,240,255,0.35)', fontFamily: '"JetBrains Mono", monospace' }}>
                    #{height.toLocaleString()} / #{tip.toLocaleString()} · {peers}p
                  </span>
                )}
                {tip === 0 && peers > 0 && (
                  <span style={{ color: 'rgba(238,240,255,0.35)', fontFamily: '"JetBrains Mono", monospace' }}>
                    {peers} peer{peers !== 1 ? 's' : ''} · waiting for chain tip…
                  </span>
                )}
              </div>
              {tip > 0 && (
                <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <motion.div
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
                      borderRadius: 9999,
                    }}
                  />
                </div>
              )}
            </div>
            {tip > 0 && (
              <span
                className="text-xs font-mono font-semibold flex-shrink-0"
                style={{ color: '#fbbf24' }}
              >
                {pct.toFixed(1)}%
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UpdateBanner() {
  const { updateInfo, updateBannerDismissed, dismissUpdateBanner } = useStore();
  if (!updateInfo?.available || updateBannerDismissed) return null;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center justify-between px-4 py-2 bg-irium-500/15 border-b border-irium-500/25 text-sm overflow-hidden"
    >
      <div className="flex items-center gap-2">
        <Download size={13} className="text-irium-300 flex-shrink-0" />
        <span className="text-irium-200">
          Irium Core <span className="font-semibold">{updateInfo.latest_version}</span> is available
          <span className="text-white/50"> (current: {updateInfo.current_version})</span>
        </span>
        {updateInfo.release_url && (
          <a
            href={updateInfo.release_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost py-0.5 px-2 text-xs text-irium-300 hover:text-irium-100"
          >
            Download →
          </a>
        )}
      </div>
      <button onClick={dismissUpdateBanner} className="btn-ghost p-1 text-white/40 hover:text-white/80">
        <X size={13} />
      </button>
    </motion.div>
  );
}

function AppLayout() {
  useNodePoller();
  useKeyboardShortcuts();
  const location = useLocation();
  const settings = useStore((s) => s.settings);
  const setUpdateInfo = useStore((s) => s.setUpdateInfo);
  const setAppVersion = useStore((s) => s.setAppVersion);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const setNodeStarting = useStore((s) => s.setNodeStarting);
  const setNodeOperation = useStore((s) => s.setNodeOperation);
  const autoStartFired = useRef(false);

  useEffect(() => {
    node.getAppVersion().then((v) => { if (v) setAppVersion(v); }).catch(() => {});
  }, [setAppVersion]);

  useEffect(() => {
    config.setWalletConfig(
      settings.wallet_path ?? null,
      settings.data_dir ?? null,
    ).catch(() => {});
  }, [settings.wallet_path, settings.data_dir]);

  // Auto-start node once after first poll if the setting is enabled.
  useEffect(() => {
    if (autoStartFired.current) return;
    if (nodeStatus === null) return; // wait for first poll result
    if (!settings.auto_start_node) return;
    if (nodeStatus.running) { autoStartFired.current = true; return; }
    autoStartFired.current = true;
    setNodeStarting(true);
    setNodeOperation('starting');
    node.start(undefined, settings.external_ip).catch(() => {
      setNodeStarting(false);
      setNodeOperation(null);
    });
  }, [nodeStatus, settings.auto_start_node, settings.external_ip, setNodeStarting, setNodeOperation]);

  useEffect(() => {
    // Silent startup check
    update.check().then((info) => {
      if (info?.available) setUpdateInfo(info);
    }).catch(() => {});

    // Listen for the Rust-emitted event (startup check runs before the window)
    const unlisten = listen<UpdateCheckResult>(
      'update-available',
      (event) => setUpdateInfo(event.payload),
    ).catch(() => ({ }));

    return () => { unlisten.then((fn) => typeof fn === 'function' && fn()); };
  }, [setUpdateInfo]);

  return (
    <div className="relative flex h-screen overflow-hidden app-bg">
      {/* Animated crypto-network background — sits behind all UI chrome */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <NetworkBackground />
      </div>

      <TitleBar />
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0 relative" style={{ zIndex: 1 }}>
        <TopBar />
        <AnimatePresence>
          <UpdateBanner />
        </AnimatePresence>
        <SyncProgressBanner />

        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{    opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ height: '100%' }}
            >
              <ErrorBoundary>
                <Suspense fallback={<div className="flex-1" />}>
                  <Routes location={location}>
                    <Route path="/"            element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard"   element={<Dashboard />}   />
                    <Route path="/explorer"    element={<Explorer />}    />
                    <Route path="/wallet"      element={<Wallet />}      />
                    {/* Settlement / Marketplace / Agreements / Reputation
                        are temporarily hidden — the route placeholders stay
                        wired but any direct URL is bounced to Dashboard.
                        The page lazy imports above are intentionally kept
                        so re-enabling is a one-line swap of <Navigate>
                        back to the original element. */}
                    <Route path="/settlement"  element={<Navigate to="/dashboard" replace />} />
                    <Route path="/marketplace" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/agreements"  element={<Navigate to="/dashboard" replace />} />
                    <Route path="/agreements/:id" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/reputation"  element={<Navigate to="/dashboard" replace />} />
                    <Route path="/miner"       element={<Miner />}       />
                    <Route path="/settings"    element={<Settings />}    />
                    <Route path="/logs"        element={<Logs />}        />
                    <Route path="/settlement/seller-wizard" element={<SellerWizard />} />
                    <Route path="/settlement/buyer-wizard"  element={<BuyerWizard />}  />
                    <Route path="/about"       element={<About />}        />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>

        <StatusBar />
      </div>

      {/* Global toast notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background:  'rgba(2, 5, 14, 0.95)',
            border:      '1px solid rgba(110,198,255,0.30)',
            color:       '#eef0ff',
            fontFamily:  '"Inter", sans-serif',
            fontSize:    '13px',
            borderRadius: '10px',
            backdropFilter: 'blur(16px)',
            boxShadow:   '0 12px 36px rgba(0,0,0,0.6), 0 0 24px rgba(110,198,255,0.10)',
          },
          success: {
            iconTheme: { primary: '#34d399', secondary: '#02050E' },
          },
          error: {
            iconTheme: { primary: '#f87171', secondary: '#02050E' },
          },
        }}
      />
    </div>
  );
}

// ─── Onboarding gate ─────────────────────────────────────────────────────────
// Must be rendered inside BrowserRouter.
function OnboardingGate() {
  // Splash always shows on every app open, then we decide onboarding vs app.
  const [splashDone, setSplashDone] = useState(false);
  const [gateState, setGateState] = useState<'checking' | 'onboarding' | 'app'>('checking');

  useEffect(() => {
    config.loadSettings().then((json) => {
      if (json) {
        try {
          const saved = JSON.parse(json);
          if (saved && typeof saved === 'object') {
            useStore.getState().updateSettings(saved);
          }
        } catch {}
      }
    }).catch(() => {});
  }, []);

  const handleSplashDone = () => {
    setSplashDone(true);
    const done = localStorage.getItem(ONBOARDING_KEY);
    setGateState(done ? 'app' : 'onboarding');
  };

  if (!splashDone) {
    return (
      <AnimatePresence>
        <Splash onDone={handleSplashDone} />
      </AnimatePresence>
    );
  }

  if (gateState === 'onboarding') {
    // Onboarding flips the gate to 'app' when it completes — without this the
    // <Navigate to="/onboarding"> wildcard catches the post-onboarding redirect
    // back to /dashboard and the user gets stuck on the wizard forever.
    const handleOnboardingComplete = () => setGateState('app');
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding onComplete={handleOnboardingComplete} />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return <AppLayout />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<OnboardingGate />} />
      </Routes>
    </BrowserRouter>
  );
}
