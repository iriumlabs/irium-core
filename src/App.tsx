import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import Sidebar    from './components/layout/Sidebar';
import TopBar     from './components/layout/TopBar';
import StatusBar  from './components/layout/StatusBar';
import Dashboard  from './pages/Dashboard';
import Wallet     from './pages/Wallet';
import Settlement from './pages/Settlement';
import Marketplace from './pages/Marketplace';
import Agreements from './pages/Agreements';
import Reputation from './pages/Reputation';
import Miner      from './pages/Miner';
import Settings   from './pages/Settings';
import Onboarding, { ONBOARDING_KEY } from './pages/Onboarding';
import { useNodePoller } from './hooks/useNodePoller';
import { node, wallet } from './lib/tauri';

function AppLayout() {
  useNodePoller();
  const location = useLocation();

  return (
    <div className="flex h-screen bg-surface-900 mesh-bg overflow-hidden">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />

        <main className="flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{    opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ height: '100%' }}
            >
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
  const [gateState, setGateState] = useState<'checking' | 'onboarding' | 'app'>('checking');

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (done) {
      setGateState('app');
      return;
    }

    // Check whether this looks like a first-run (no running node + no wallet balance)
    Promise.all([
      node.status().catch(() => null),
      wallet.balance().catch(() => null),
    ]).then(([nodeStatus, bal]) => {
      const offline  = !nodeStatus || !nodeStatus.running;
      const noWallet = !bal; // only treat as no-wallet if the call returned null (threw)
      if (offline && noWallet) {
        setGateState('onboarding');
      } else {
        setGateState('app');
      }
    });
  }, []);

  // Brief invisible hold while we decide — avoids flash of wrong content
  if (gateState === 'checking') return null;

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
