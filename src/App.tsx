import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { X, Download } from 'lucide-react';
import { lazy, Suspense } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar    from './components/layout/Sidebar';
import TopBar     from './components/layout/TopBar';
import StatusBar  from './components/layout/StatusBar';
import TitleBar   from './components/layout/TitleBar';
const Dashboard   = lazy(() => import('./pages/Dashboard'));
const Wallet      = lazy(() => import('./pages/Wallet'));
const Settlement  = lazy(() => import('./pages/Settlement'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const Agreements  = lazy(() => import('./pages/Agreements'));
const Reputation  = lazy(() => import('./pages/Reputation'));
const Miner       = lazy(() => import('./pages/Miner'));
const Settings    = lazy(() => import('./pages/Settings'));
import Onboarding, { ONBOARDING_KEY, Splash } from './pages/Onboarding';
import { useNodePoller } from './hooks/useNodePoller';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { node, wallet, config, update } from './lib/tauri';
import { useStore } from './lib/store';
import type { UpdateCheckResult } from './lib/types';

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

  useEffect(() => {
    config.setWalletConfig(
      settings.wallet_path ?? null,
      settings.data_dir ?? null,
    ).catch(() => {});
  }, [settings.wallet_path, settings.data_dir]);

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
    <div className="flex h-screen overflow-hidden app-bg">
      <TitleBar />
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <AnimatePresence>
          <UpdateBanner />
        </AnimatePresence>

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
                    <Route path="/wallet"      element={<Wallet />}      />
                    <Route path="/settlement"  element={<Settlement />}  />
                    <Route path="/marketplace" element={<Marketplace />} />
                    <Route path="/agreements"  element={<Agreements />}  />
                    <Route path="/agreements/:id" element={<Agreements />} />
                    <Route path="/reputation"  element={<Reputation />}  />
                    <Route path="/miner"       element={<Miner />}       />
                    <Route path="/settings"    element={<Settings />}    />
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
            background:  '#0d0d1a',
            border:      '1px solid rgba(123,47,226,0.4)',
            color:       '#e2d9f3',
            fontFamily:  '"DM Sans", sans-serif',
            fontSize:    '13px',
            borderRadius: '10px',
            backdropFilter: 'blur(12px)',
          },
          success: {
            iconTheme: { primary: '#22c55e', secondary: '#0d0d1a' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#0d0d1a' },
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
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
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
