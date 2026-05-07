import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CheckCircle, AlertTriangle, Loader2, FolderOpen, PlusCircle, ArrowLeft } from 'lucide-react';
import { node, wallet } from '../lib/tauri';

// ─── Onboarding completion key ──────────────────────────────────────────────
export const ONBOARDING_KEY = 'irium_onboarding_complete';

// ─── Step slide animation variants ──────────────────────────────────────────
const stepVariants = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0 },
  exit:    { opacity: 0, x: -40 },
};

const stepTransition = { duration: 0.25, ease: 'easeOut' as const };

// ─── Node setup state type ───────────────────────────────────────────────────
type NodeState = 'idle' | 'starting' | 'polling' | 'success' | 'timeout';

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────
function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <motion.div
      key="step-welcome"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={stepTransition}
      className="flex flex-col items-center text-center"
    >
      {/* Logo */}
      <div className="w-20 h-20 rounded-2xl bg-irium-600 flex items-center justify-center mb-8 glow-purple">
        <span className="text-white font-display font-bold text-3xl">I</span>
      </div>

      <h1 className="text-4xl font-bold font-display gradient-text mb-4">
        Welcome to Irium Core
      </h1>
      <p className="text-slate-400 text-center max-w-md mb-10">
        A full node desktop wallet for the Irium blockchain. Let's get you set up in just a few steps.
      </p>

      <button className="btn-primary px-8 py-3 text-base" onClick={onNext}>
        Get Started
      </button>
    </motion.div>
  );
}

// ─── Step 2: Node Setup ───────────────────────────────────────────────────────
function StepNodeSetup({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [nodeState, setNodeState] = useState<NodeState>('idle');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (advanceRef.current) clearTimeout(advanceRef.current);
    };
  }, []);

  const startPolling = () => {
    setNodeState('polling');

    // 30-second hard timeout
    timeoutRef.current = setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current);
      setNodeState('timeout');
    }, 30_000);

    // Poll every 2 seconds
    pollRef.current = setInterval(async () => {
      try {
        const status = await node.status();
        if (status && status.running) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setNodeState('success');
          advanceRef.current = setTimeout(() => onNext(), 1500);
        }
      } catch {
        // still waiting — keep polling
      }
    }, 2_000);
  };

  const handleStart = async () => {
    setNodeState('starting');
    try {
      await node.start();
      startPolling();
    } catch {
      startPolling(); // still poll even if start threw (node may already be running)
    }
  };

  const handleRetry = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setNodeState('idle');
  };

  return (
    <motion.div
      key="step-node"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={stepTransition}
      className="flex flex-col items-center text-center max-w-md w-full"
    >
      <h1 className="text-3xl font-bold font-display gradient-text mb-3">
        Start Your Node
      </h1>
      <p className="text-slate-400 mb-8">
        Irium Core runs <span className="font-mono text-irium-300">iriumd</span> locally on your
        machine. Your funds stay under your control — no third parties, no custodians.
      </p>

      {/* Status area */}
      <div className="w-full glass rounded-2xl p-6 mb-8 min-h-[120px] flex flex-col items-center justify-center gap-4">
        <AnimatePresence mode="wait">
          {nodeState === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-slate-500 text-sm"
            >
              Click "Start Node" to launch the local daemon.
            </motion.div>
          )}

          {(nodeState === 'starting' || nodeState === 'polling') && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <Loader2 size={28} className="text-irium-400 animate-spin" />
              <p className="text-sm text-slate-400">
                {nodeState === 'starting' ? 'Starting iriumd…' : 'Waiting for node to come online…'}
              </p>
            </motion.div>
          )}

          {nodeState === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className="flex flex-col items-center gap-3"
            >
              <CheckCircle size={36} className="text-emerald-400 glow-green" />
              <p className="text-emerald-400 font-semibold">Node is running!</p>
            </motion.div>
          )}

          {nodeState === 'timeout' && (
            <motion.div
              key="timeout"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <AlertTriangle size={28} className="text-amber-400" />
              <p className="text-sm text-amber-400">
                Node did not respond within 30 seconds.
              </p>
              <button className="btn-secondary px-4 py-2 text-sm" onClick={handleRetry}>
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 w-full justify-center">
        <button
          className="btn-ghost flex items-center gap-2 text-sm text-slate-400"
          onClick={onBack}
        >
          <ArrowLeft size={15} /> Back
        </button>

        {nodeState === 'idle' && (
          <button className="btn-primary px-6 py-2.5" onClick={handleStart}>
            Start Node
          </button>
        )}

        {/* Allow skipping if already running or want to skip */}
        {nodeState === 'idle' && (
          <button
            className="btn-ghost text-sm text-slate-500 underline underline-offset-2"
            onClick={onNext}
          >
            Skip (node already running)
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Step 3: Wallet Setup ─────────────────────────────────────────────────────
function StepWalletSetup({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [walletPath, setWalletPath] = useState('');

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    navigate('/dashboard', { replace: true });
  };

  const handleCreateNew = async () => {
    setCreatingWallet(true);
    try {
      await wallet.newAddress();
      toast.success('Wallet created!');
      completeOnboarding();
    } catch (e) {
      toast.error('Failed to create wallet. Please try again.');
      setCreatingWallet(false);
    }
  };

  const handleLoadExisting = async () => {
    if (!walletPath.trim()) {
      toast.error('Please enter a wallet file path.');
      return;
    }
    setLoadingWallet(true);
    try {
      await wallet.setPath(walletPath.trim());
      toast.success('Wallet loaded!');
      completeOnboarding();
    } catch (e) {
      toast.error('Failed to load wallet. Check the path and try again.');
      setLoadingWallet(false);
    }
  };

  return (
    <motion.div
      key="step-wallet"
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={stepTransition}
      className="flex flex-col items-center text-center max-w-xl w-full"
    >
      <h1 className="text-3xl font-bold font-display gradient-text mb-3">
        Wallet Setup
      </h1>
      <p className="text-slate-400 mb-8">
        Create a fresh wallet or load an existing one to get started.
      </p>

      {/* Two cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full mb-8">
        {/* Create new wallet */}
        <div className="card p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-irium-600/20 border border-irium-500/30 flex items-center justify-center">
            <PlusCircle size={22} className="text-irium-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white mb-1">Create New Wallet</h3>
            <p className="text-xs text-slate-500">
              Generate a fresh wallet with a new address. Back up your seed phrase.
            </p>
          </div>
          <button
            className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            onClick={handleCreateNew}
            disabled={creatingWallet || loadingWallet}
          >
            {creatingWallet ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Creating…
              </>
            ) : (
              'Create Wallet'
            )}
          </button>
        </div>

        {/* Load existing wallet */}
        <div className="card p-6 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-700/50 border border-white/10 flex items-center justify-center">
            <FolderOpen size={22} className="text-slate-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white mb-1">Existing Wallet</h3>
            <p className="text-xs text-slate-500">
              Point to an existing wallet file on your machine.
            </p>
          </div>
          <input
            type="text"
            value={walletPath}
            onChange={(e) => setWalletPath(e.target.value)}
            placeholder="~/.irium/wallet.json"
            className="input w-full font-mono text-xs"
            disabled={creatingWallet || loadingWallet}
          />
          <button
            className="btn-secondary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            onClick={handleLoadExisting}
            disabled={creatingWallet || loadingWallet || !walletPath.trim()}
          >
            {loadingWallet ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Loading…
              </>
            ) : (
              'Load Wallet'
            )}
          </button>
        </div>
      </div>

      {/* Back */}
      <button
        className="btn-ghost flex items-center gap-2 text-sm text-slate-400"
        onClick={onBack}
        disabled={creatingWallet || loadingWallet}
      >
        <ArrowLeft size={15} /> Back
      </button>
    </motion.div>
  );
}

// ─── Progress dots ────────────────────────────────────────────────────────────
function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-12">
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            width: i + 1 === step ? 24 : 8,
            backgroundColor: i + 1 === step ? '#7b2fe2' : i + 1 < step ? '#6d28d9' : '#1e1b4b',
          }}
          transition={{ duration: 0.3 }}
          className="h-2 rounded-full"
        />
      ))}
    </div>
  );
}

// ─── Main Onboarding component ────────────────────────────────────────────────
export default function Onboarding() {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 3;

  return (
    <div className="fixed inset-0 bg-surface-900 mesh-bg flex flex-col items-center justify-center z-50 px-6">
      <ProgressDots step={step} total={TOTAL_STEPS} />

      <AnimatePresence mode="wait">
        {step === 1 && (
          <StepWelcome key="s1" onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <StepNodeSetup key="s2" onNext={() => setStep(3)} onBack={() => setStep(1)} />
        )}
        {step === 3 && (
          <StepWalletSetup key="s3" onBack={() => setStep(2)} />
        )}
      </AnimatePresence>
    </div>
  );
}
