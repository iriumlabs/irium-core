import { useState, useEffect, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Loader2, ArrowRight,
  Eye, EyeOff, Copy, Shield, AlertTriangle,
  Key, Lock, FileText, Wallet as WalletIcon, RefreshCw,
} from 'lucide-react';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { node, wallet } from '../lib/tauri';
import { useStore } from '../lib/store';
import type { NodeStatus, WalletCreateResult, BinaryCheckResult } from '../lib/types';
import { truncateHash } from '../lib/types';
import clsx from 'clsx';

// ─── Direct RPC poll (bypasses Tauri/mock so real node data is always shown) ──
// Routes through Tauri's HTTP API (allowlist.http scope) instead of native
// fetch — the renderer CSP has no connect-src for 127.0.0.1:38300 and iriumd
// does not send CORS headers by default. tauriFetch issues the request from
// Rust so neither restriction applies.
type StatusJson = {
  height?: number;
  best_header_tip?: { height?: number; hash?: string };
  peer_count?: number;
  anchor_loaded?: boolean;
  network_era?: string;
  version?: string;
};
type PeersJson = { peers?: unknown[]; peer_count?: number };

async function fetchRpcStatus(rpcUrl: string): Promise<NodeStatus | null> {
  try {
    const [statusSettled, peersSettled] = await Promise.allSettled([
      tauriFetch<StatusJson>(`${rpcUrl}/status`, {
        method: 'GET', timeout: 3, responseType: ResponseType.JSON,
      }),
      tauriFetch<PeersJson>(`${rpcUrl}/peers`, {
        method: 'GET', timeout: 3, responseType: ResponseType.JSON,
      }),
    ]);

    if (statusSettled.status !== 'fulfilled' || !statusSettled.value.ok) return null;

    const d = statusSettled.value.data ?? {};
    const height = Number(d.height ?? 0);
    const tipH   = Number(d.best_header_tip?.height ?? 0);
    const tipHash: string = d.best_header_tip?.hash ?? '';

    let peers = Number(d.peer_count ?? 0);
    if (peersSettled.status === 'fulfilled' && peersSettled.value.ok) {
      const pd = peersSettled.value.data ?? {};
      peers = Array.isArray(pd.peers) ? pd.peers.length : (Number(pd.peer_count) || peers);
    }

    // Mirror Rust logic: synced only when anchor loaded, have peers, know the tip,
    // and local height is within 10 blocks of the network tip.
    const synced = Boolean(d.anchor_loaded) && peers > 0 && tipH > 0 && height >= tipH - 10;

    return {
      running:      true,
      synced,
      height,
      network_tip:  tipH,
      tip:          tipHash,
      peers,
      network:      String(d.network_era ?? 'Mainnet'),
      version:      String(d.version     ?? '1.0.0'),
      rpc_url:      rpcUrl,
      upnp_active:  false,
    };
  } catch {
    return null;
  }
}

export const ONBOARDING_KEY = 'irium_onboarding_complete';

// One-shot sentinel set by the "Reset onboarding" button in Settings. When
// handleSplashDone sees this flag, it forces the wizard and clears the flag,
// overriding the wallet-existence heal-fallback that would otherwise re-set
// ONBOARDING_KEY for returning users who reset on purpose.
export const FORCE_ONBOARDING_KEY = 'irium_force_onboarding';

// ─── Shared animation variants ────────────────────────────────────────────────
const fadeIn = {
  initial:    { opacity: 0, y: 16 },
  animate:    { opacity: 1, y: 0  },
  exit:       { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
};

const STEPS = [
  { id: 1, label: 'System Check'   },
  { id: 2, label: 'Bootstrap'      },
  { id: 3, label: 'Network Sync'   },
  { id: 4, label: 'Wallet Setup'   },
  { id: 5, label: 'Backup & Secure'},
];

// ─── Particle field (memoised — never re-renders) ────────────────────────────
const PARTICLE_DATA = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 2.2 + 0.5,
  delay: Math.random() * 3.5,
  duration: Math.random() * 6 + 6,
  opacity: Math.random() * 0.35 + 0.08,
  blue: Math.random() > 0.7,
}));

const ParticleField = memo(function ParticleField() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {PARTICLE_DATA.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top:  `${p.y}%`,
            width:  p.size,
            height: p.size,
            background: p.blue
              ? `rgba(110,198,255,${p.opacity})`
              : `rgba(167,139,250,${p.opacity})`,
          }}
          animate={{ y: [-8, 8, -8], opacity: [p.opacity * 0.4, p.opacity, p.opacity * 0.4] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
});

// ─── Cinematic Splash ─────────────────────────────────────────────────────────
const SPLASH_STATUSES = [
  'Initializing runtime…',
  'Loading cryptographic modules…',
  'Verifying binary integrity…',
  'Establishing secure context…',
  'Ready',
];

export function Splash({ onDone }: { onDone: () => void }) {
  const appVersion  = useStore((s) => s.appVersion);
  const [pct, setPct]           = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    const total = 3200;
    const tick  = 50;
    const inc   = (100 / total) * tick;
    let cur = 0;
    const id = setInterval(() => {
      cur += inc;
      if (cur >= 100) {
        setPct(100);
        clearInterval(id);
        setTimeout(onDone, 480);
      } else {
        setPct(Math.min(cur, 100));
      }
    }, tick);
    return () => clearInterval(id);
  }, [onDone]);

  useEffect(() => {
    const id = setInterval(() => {
      setStatusIdx((i) => Math.min(i + 1, SPLASH_STATUSES.length - 1));
    }, 650);
    return () => clearInterval(id);
  }, []);

  // Title rendered as two flex-grouped words so the inter-word gap is
  // controlled by the outer flex `gap`, not by a space character that would
  // pick up letter-spacing 2× and look like an oversized chasm.
  const titleWords: ReadonlyArray<string> = ['IRIUM', 'CORE'];

  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: '#02050E' }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.5 }}
    >
      {/* Ambient glow layers — brand cyan + purple, matches app aurora */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 70% 60% at 18% 18%, rgba(59,59,255,0.18) 0%, transparent 55%),
            radial-gradient(ellipse 60% 55% at 82% 82%, rgba(167,139,250,0.13) 0%, transparent 55%),
            radial-gradient(ellipse 45% 45% at 50% 50%, rgba(110,198,255,0.10) 0%, transparent 55%)
          `,
        }}
      />

      <ParticleField />

      {/* Center: orbital rings + logo. Container has explicit height so the
          absolute-positioned rings (190px diameter) don't overflow into the
          title that follows. */}
      <div
        className="relative flex items-center justify-center mb-12"
        style={{ width: 220, height: 220 }}
      >
        {/* Outer ring — slow CW */}
        <div
          style={{
            position: 'absolute',
            width: 190, height: 190,
            borderRadius: '50%',
            border: '1px solid rgba(110,198,255,0.22)',
            animation: 'orbit-cw 9s linear infinite',
          }}
        >
          <div style={{
            position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
            width: 7, height: 7, borderRadius: '50%',
            background: '#6ec6ff',
            boxShadow: '0 0 14px #6ec6ff, 0 0 28px rgba(110,198,255,0.45)',
          }} />
        </div>

        {/* Middle ring — faster CCW */}
        <div
          style={{
            position: 'absolute',
            width: 146, height: 146,
            borderRadius: '50%',
            border: '1px solid rgba(59,130,246,0.20)',
            animation: 'orbit-ccw 5.5s linear infinite',
          }}
        >
          <div style={{
            position: 'absolute', top: -3, left: '50%', transform: 'translateX(-50%)',
            width: 5, height: 5, borderRadius: '50%',
            background: '#a78bfa',
            boxShadow: '0 0 10px #a78bfa, 0 0 22px rgba(59,130,246,0.35)',
          }} />
        </div>

        {/* Inner ring — slow CW */}
        <div
          style={{
            position: 'absolute',
            width: 110, height: 110,
            borderRadius: '50%',
            border: '1px solid rgba(167,139,250,0.14)',
            animation: 'orbit-cw 14s linear infinite',
          }}
        >
          <div style={{
            position: 'absolute', bottom: -2.5, right: -2.5,
            width: 4, height: 4, borderRadius: '50%',
            background: '#A78BFA',
            boxShadow: '0 0 7px #A78BFA',
          }} />
        </div>

        {/* Logo */}
        <motion.img
          src="/logo.png"
          alt="Irium Core"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.75, ease: [0.34, 1.56, 0.64, 1], delay: 0.08 }}
          style={{
            width: 74, height: 74,
            borderRadius: '50%',
            position: 'relative', zIndex: 2,
            animation: 'logo-pulse 2.8s ease-in-out infinite',
          }}
        />
      </div>

      {/* Title — letter stagger */}
      <div className="flex items-center" style={{ gap: '0.4em' }}>
        {titleWords.map((word, wordIdx) => {
          const before = wordIdx === 0 ? 0 : titleWords[0].length;
          return (
            <div key={word} className="flex items-center" style={{ gap: 1 }}>
              {word.split('').map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28 + (before + i) * 0.045, duration: 0.38, ease: 'easeOut' }}
                  className="font-display font-bold"
                  style={{
                    fontSize: 34,
                    letterSpacing: '0.18em',
                    background: 'linear-gradient(135deg, #d4eeff 0%, #6ec6ff 50%, #a78bfa 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {char}
                </motion.span>
              ))}
            </div>
          );
        })}
      </div>

      {/* Subtitle */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.5 }}
        className="mt-2 mb-1"
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          letterSpacing: '0.24em',
          color: 'rgba(238,240,255,0.27)',
        }}
      >
        FULL NODE DESKTOP WALLET
      </motion.p>

      {/* Version badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.05, duration: 0.4 }}
        className="mt-2 mb-11"
        style={{
          background: 'rgba(110,198,255,0.10)',
          border: '1px solid rgba(110,198,255,0.22)',
          borderRadius: 20,
          padding: '2px 12px',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          color: '#A78BFA',
          letterSpacing: '0.1em',
        }}
      >
        v{appVersion}
      </motion.div>

      {/* Status message */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.3 }}
        className="mb-3"
        style={{ height: 16, display: 'flex', alignItems: 'center' }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={statusIdx}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.22 }}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              color: 'rgba(238,240,255,0.24)',
            }}
          >
            {SPLASH_STATUSES[statusIdx]}
          </motion.span>
        </AnimatePresence>
      </motion.div>

      {/* Progress bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        style={{ width: 230 }}
      >
        <div
          style={{
            height: 2,
            borderRadius: 1,
            background: 'rgba(255,255,255,0.07)',
            overflow: 'hidden',
          }}
        >
          <motion.div
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.1, ease: 'linear' }}
            style={{
              height: '100%',
              borderRadius: 1,
              background: 'linear-gradient(90deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
              boxShadow: '0 0 10px rgba(110,198,255,0.6)',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 5 }}>
          <span style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 9,
            color: 'rgba(238,240,255,0.18)',
          }}>
            {Math.round(pct)}%
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Left step rail ───────────────────────────────────────────────────────────
function StepRail({ current, showStep5 }: { current: number; showStep5: boolean }) {
  const steps = showStep5 ? STEPS : STEPS.slice(0, 4);
  return (
    <div className="flex flex-col gap-0 w-48 flex-shrink-0">
      <div className="flex items-center gap-3 mb-12">
        <img
          src="/logo.png"
          alt="Irium"
          className="w-8 h-8 flex-shrink-0"
          style={{
            borderRadius: '50%',
            boxShadow: '0 0 18px rgba(110,198,255,0.45), 0 0 36px rgba(167,139,250,0.18)',
          }}
        />
        <div>
          <div
            className="font-display font-bold leading-none"
            style={{
              fontSize: 14,
              letterSpacing: '0.10em',
              background: 'linear-gradient(135deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            IRIUM
          </div>
          <div className="font-mono text-[9px] tracking-widest leading-none mt-1" style={{ color: 'rgba(110,198,255,0.55)' }}>CORE</div>
        </div>
      </div>

      {steps.map((step, i) => {
        const done    = current > step.id;
        const active  = current === step.id;
        const pending = current < step.id;
        return (
          <div key={step.id} className="flex items-start gap-3.5 relative">
            {i < steps.length - 1 && (
              <motion.div
                className="absolute w-[1px]"
                style={{ left: 12, top: 26, bottom: 0 }}
                animate={{ background: done ? '#6ec6ff' : 'rgba(110,198,255,0.10)' }}
                transition={{ duration: 0.4 }}
              />
            )}
            <motion.div
              className="w-[24px] h-[24px] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10"
              animate={{
                background:   done ? '#6ec6ff' : 'transparent',
                borderColor:  done ? '#6ec6ff' : active ? '#6ec6ff' : 'rgba(110,198,255,0.25)',
                borderWidth:  done ? 0 : 2,
                boxShadow:    active ? '0 0 14px rgba(110,198,255,0.55)' : (done ? '0 0 10px rgba(110,198,255,0.45)' : 'none'),
              }}
              style={{ borderStyle: 'solid' }}
              transition={{ duration: 0.3 }}
            >
              {done ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }}>
                  <CheckCircle2 size={14} style={{ color: '#02050E' }} />
                </motion.div>
              ) : active ? (
                <motion.div
                  className="w-2 h-2 rounded-full"
                  style={{ background: '#6ec6ff' }}
                  animate={{ scale: [1, 1.4, 1], opacity: [0.85, 1, 0.85] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(110,198,255,0.30)' }} />
              )}
            </motion.div>
            <div
              className={clsx('text-sm pb-9 leading-tight font-display', {
                'text-white font-bold': active,
                'text-[#6ec6ff] font-semibold': done,
                'text-[rgba(238,240,255,0.30)]': pending,
              })}
              style={{ letterSpacing: '0.02em' }}
            >
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Binary Check ─────────────────────────────────────────────────────
function StepBinaryCheck({ onNext }: { onNext: () => void }) {
  const [checking, setChecking] = useState(true);
  const [result, setResult]     = useState<BinaryCheckResult | null>(null);

  const doCheck = () => {
    setChecking(true);
    setResult(null);
    node.checkBinaries()
      .then((r) => {
        setResult(r);
        setChecking(false);
        if (r.iriumd && r.irium_wallet && r.irium_miner) {
          setTimeout(onNext, 1100);
        }
      })
      .catch(() => {
        setResult({ iriumd: false, irium_wallet: false, irium_miner: false });
        setChecking(false);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { doCheck(); }, []);

  const bins: Array<{ key: keyof BinaryCheckResult; label: string; desc: string }> = [
    { key: 'iriumd',       label: 'iriumd',        desc: 'Full node daemon'         },
    { key: 'irium_wallet', label: 'irium-wallet',  desc: 'Wallet & marketplace CLI' },
    { key: 'irium_miner',  label: 'irium-miner',   desc: 'CPU miner'                },
  ];

  const allOk = result?.iriumd && result?.irium_wallet && result?.irium_miner;

  return (
    <motion.div key="bin-check" {...fadeIn}>
      <h2 className="font-display font-bold text-2xl mb-1.5 gradient-text">System Check</h2>
      <p className="text-sm mb-6" style={{ color: 'rgba(238,240,255,0.45)' }}>
        Verifying required node binaries are present on this machine.
      </p>

      <div className="terminal-box p-4 mb-5 space-y-3">
        {bins.map((b, i) => {
          const status = checking ? null : result?.[b.key];
          return (
            <motion.div
              key={b.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.12 }}
              className="flex items-center gap-3"
            >
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                {checking || status === null ? (
                  <Loader2 size={13} className="animate-spin" style={{ color: 'rgba(238,240,255,0.30)' }} />
                ) : status ? (
                  <CheckCircle2 size={14} className="terminal-line-ok" />
                ) : (
                  <XCircle size={14} className="terminal-line-err" />
                )}
              </div>
              <span className="font-mono text-sm text-white w-32 flex-shrink-0">{b.label}</span>
              <span className="terminal-line-muted text-xs">{b.desc}</span>
            </motion.div>
          );
        })}

        {!checking && allOk && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="pt-1 terminal-line-ok font-mono text-xs">
            ✓ All binaries verified. Continuing…
          </motion.div>
        )}
        {!checking && !allOk && (
          <div className="pt-1 terminal-line-err font-mono text-xs">
            ✗ Missing binaries. Place executables in src-tauri/binaries/
          </div>
        )}
      </div>

      {!checking && !allOk && (
        <div className="flex items-center gap-3">
          <button className="btn-secondary text-sm" onClick={doCheck}>
            <Loader2 size={13} /> Retry
          </button>
          <button className="btn-ghost text-sm" style={{ color: 'rgba(238,240,255,0.40)' }} onClick={onNext}>
            Skip (advanced)
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Step 2: Bootstrap ────────────────────────────────────────────────────────
function StepBootstrap({ onNext }: { onNext: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef         = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = (line: string) => setLines((prev) => [...prev, line]);
    const run = async () => {
      log('$ mkdir -p ~/.irium/bootstrap/trust');
      await new Promise((r) => setTimeout(r, 380));
      log('→ Creating data directory…');
      await new Promise((r) => setTimeout(r, 280));
      try {
        await node.setupDataDir();
        log('→ Writing seedlist.txt (207.244.247.86:38291, 157.173.116.134:38291)');
        await new Promise((r) => setTimeout(r, 340));
        log('→ Writing static_peers.txt…');
        await new Promise((r) => setTimeout(r, 260));
        log('→ Installing genesis anchors.json…');
        await new Promise((r) => setTimeout(r, 420));
        log('→ Installing trust signatures…');
        await new Promise((r) => setTimeout(r, 310));
        log('✓ Bootstrap configuration complete.');
        setDone(true);
        setTimeout(onNext, 900);
      } catch (e) {
        setError(String(e));
        log(`✗ Error: ${String(e)}`);
      }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <motion.div key="bootstrap" {...fadeIn}>
      <h2 className="font-display font-bold text-2xl mb-1.5 gradient-text">Network Bootstrap</h2>
      <p className="text-sm mb-6" style={{ color: 'rgba(238,240,255,0.45)' }}>
        Configuring seed nodes, trust anchors, and genesis block.
      </p>

      <div className="terminal-box p-4 mb-5 space-y-1.5 overflow-auto max-h-52">
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className={clsx('font-mono text-xs', {
              'terminal-line-ok':   line.startsWith('✓'),
              'terminal-line-err':  line.startsWith('✗'),
              'terminal-line-info': line.startsWith('→'),
              'terminal-line-muted': line.startsWith('$'),
            })}
          >
            {line}
          </motion.div>
        ))}
        {!done && !error && (
          <span className="terminal-cursor" style={{ display: 'inline-block', width: 8, height: 14, background: 'rgba(110,198,255,0.7)', animation: 'terminal-blink 1s step-end infinite', verticalAlign: 'text-bottom' }} />
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <button className="btn-secondary text-sm" onClick={onNext}>
          Skip (continue anyway)
        </button>
      )}
    </motion.div>
  );
}

// Mirrors irium-source/bootstrap/seedlist.txt — the official signed seeds the
// embedded iriumd dials on startup. Kept inline (rather than fetched from disk)
// so this screen can render diagnostic context even when iriumd hasn't reached
// its own seedlist yet.
const KNOWN_SEEDS = ['207.244.247.86', '157.173.116.134'];

// ─── Step 3: Network Sync ─────────────────────────────────────────────────────
function StepNetworkSync({ onNext }: { onNext: () => void }) {
  const rpcUrl = useStore((s) => s.settings.rpc_url) || 'http://127.0.0.1:38300';
  const [nodeStarted, setNodeStarted] = useState(false);
  const [startError, setStartError]   = useState<string | null>(null);
  const [status, setStatus]           = useState<NodeStatus | null>(null);
  const [retrying, setRetrying]       = useState(false);
  // Re-render every second while we're still waiting on peers so the 30-second
  // "no peers" warning surfaces without needing another RPC poll to fire.
  const [nowTick, setNowTick] = useState(0);
  // Records when iriumd was first observed as started (after node.start
  // resolves) — drives the 30-second timeout for the no-peers warning.
  const startedAtRef = useRef<number | null>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const onNextRef = useRef(onNext);
  useEffect(() => { onNextRef.current = onNext; });

  useEffect(() => {
    let mounted = true;

    node.start()
      .then(() => { if (mounted) setNodeStarted(true); })
      .catch((e) => {
        if (!mounted) return;
        setNodeStarted(true);
        if (!String(e).toLowerCase().includes('already')) setStartError(String(e));
      });

    const poll = async () => {
      const direct = await fetchRpcStatus(rpcUrl);
      if (direct) {
        if (mounted) setStatus(direct);
        if (direct.running && mounted) setNodeStarted(true);
        return;
      }
      try {
        const s = await node.status();
        if (mounted) setStatus(s);
      } catch { /* keep polling */ }
    };

    poll();
    pollRef.current = setInterval(poll, 2_500);
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcUrl]);

  // Stamp the moment we observed nodeStarted go true; reset on retry.
  useEffect(() => {
    if (nodeStarted && startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
  }, [nodeStarted]);

  const h       = status?.height      ?? 0;
  const tip     = status?.network_tip ?? 0;
  const pct     = tip > 0 ? Math.min(Math.round((h / tip) * 100), 100) : 0;
  const peers   = status?.peers   ?? 0;
  const synced  = status?.synced  ?? false;
  const running = status?.running ?? false;

  // 1 Hz re-render while we're still at zero peers — needed so the 30-second
  // "no peers" warning surfaces without waiting on the 2.5 s RPC poll. Stops
  // ticking the moment peers > 0 so we don't burn cycles forever.
  useEffect(() => {
    if (peers > 0) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [peers]);
  void nowTick;

  const secondsSinceStart = startedAtRef.current
    ? Math.floor((Date.now() - startedAtRef.current) / 1000)
    : 0;
  const showNoPeersWarning = nodeStarted && peers === 0 && secondsSinceStart >= 30;

  const handleRetry = async () => {
    setRetrying(true);
    setStartError(null);
    try {
      await node.stop().catch(() => {});            // tolerate "not running"
      await new Promise((r) => setTimeout(r, 600)); // let the OS release ports
      startedAtRef.current = null;                  // reset the 30-s timer
      setNodeStarted(false);
      await node.start();
    } catch (e) {
      setStartError(String(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <motion.div key="sync" {...fadeIn}>
      <h2 className="font-display font-bold text-2xl mb-1.5 gradient-text">Network Sync</h2>
      <p className="text-sm mb-6" style={{ color: 'rgba(238,240,255,0.45)' }}>
        Connecting to the Irium P2P network and downloading the blockchain.
      </p>

      <div className="panel p-5 mb-5 space-y-4">
        {/* Node daemon row */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'rgba(238,240,255,0.45)' }}>Node daemon</span>
          {!nodeStarted ? (
            <span className="flex items-center gap-2 font-mono text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
              <Loader2 size={12} className="animate-spin" /> Starting iriumd…
            </span>
          ) : running ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="dot-live" />
              <span className="font-semibold" style={{ color: '#34d399' }}>Running</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs">
              <Loader2 size={12} className="animate-spin" style={{ color: '#fbbf24' }} />
              <span style={{ color: '#fbbf24' }}>Connecting…</span>
            </span>
          )}
        </div>

        {/* Peers */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'rgba(238,240,255,0.45)' }}>Connected peers</span>
          <span className="flex items-center gap-2">
            <AnimatePresence>
              {peers > 0 && (
                <motion.span
                  className="dot-live"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                />
              )}
            </AnimatePresence>
            <motion.span
              key={peers}
              initial={{ scale: 1.3, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-mono font-semibold text-white"
            >
              {peers}
            </motion.span>
            {peers === 0 && (
              <span className="text-xs" style={{ color: 'rgba(238,240,255,0.30)' }}>discovering…</span>
            )}
          </span>
        </div>

        {/* Block height */}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'rgba(238,240,255,0.45)' }}>Block height</span>
          <motion.span
            key={h}
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="font-mono font-semibold text-white"
          >
            {h.toLocaleString()}
            {tip > 0 && (
              <span style={{ color: 'rgba(238,240,255,0.35)' }}> / {tip.toLocaleString()}</span>
            )}
          </motion.span>
        </div>

        {/* Sync progress bar */}
        <div>
          <div className="flex justify-between text-xs mb-1.5" style={{ color: 'rgba(238,240,255,0.35)' }}>
            <span>Sync progress</span>
            <motion.span key={pct} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-mono">
              {pct}%
            </motion.span>
          </div>
          <div className="progress-track" style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.40)', overflow: 'hidden' }}>
            <motion.div
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{
                height: '100%', borderRadius: 3,
                background: 'linear-gradient(90deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
                boxShadow: '0 0 10px rgba(110,198,255,0.55)',
              }}
            />
          </div>
        </div>

        {/* Tip hash */}
        {status?.tip && (
          <div className="flex items-center justify-between text-xs" style={{ color: 'rgba(238,240,255,0.30)' }}>
            <span>Tip</span>
            <span className="font-mono">{truncateHash(status.tip, 8)}</span>
          </div>
        )}

        {/* Synced */}
        <AnimatePresence>
          {synced && (
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 pt-1"
            >
              <CheckCircle2 size={16} style={{ color: '#34d399' }} />
              <span className="font-semibold text-sm" style={{ color: '#34d399' }}>Blockchain fully synced</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {startError && (
        <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: '#fbbf24' }}>
          <AlertTriangle size={12} /> {startError}
        </div>
      )}

      <AnimatePresence>
        {showNoPeersWarning && (
          <motion.div
            key="no-peers-warning"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg p-3 mb-4"
            style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)' }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
              <div className="text-xs leading-relaxed flex-1">
                <p className="font-semibold mb-1" style={{ color: '#fbbf24' }}>No peers found</p>
                <p style={{ color: 'rgba(238,240,255,0.60)' }}>
                  Check your internet connection or firewall. Port <span className="font-mono">38291</span> must be reachable outbound.
                </p>
                <p className="mt-2.5" style={{ color: 'rgba(238,240,255,0.40)' }}>
                  The node tries to reach these official bootstrap seeds:
                </p>
                <div className="mt-1 font-mono text-[11px] space-y-0.5" style={{ color: 'rgba(238,240,255,0.55)' }}>
                  {KNOWN_SEEDS.map((s) => <div key={s}>{s}</div>)}
                </div>
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="btn-secondary mt-3 px-3 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {retrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {retrying ? 'Restarting node…' : 'Retry connection'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-3">
        {synced ? (
          <motion.button
            className="btn-primary"
            onClick={onNext}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            Continue to Wallet <ArrowRight size={15} />
          </motion.button>
        ) : (
          <>
            {(running || nodeStarted) && (
              <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(238,240,255,0.35)' }}>
                <Loader2 size={12} className="animate-spin" /> Syncing in background…
              </div>
            )}
            <button
              className="btn-ghost text-xs"
              style={{ color: 'rgba(238,240,255,0.35)' }}
              onClick={onNext}
            >
              Skip (continue without full sync)
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ─── Step 4: Wallet Setup ─────────────────────────────────────────────────────
type WalletFlow = 'choose' | 'creating' | 'import_form' | 'importing' | 'restored';
type ImportTab  = 'mnemonic' | 'wif' | 'privkey';

function StepWalletSetup({
  onCreated,
  onImported,
}: {
  onCreated:  (r: WalletCreateResult) => void;
  onImported: () => void;
}) {
  const updateSettings = useStore((s) => s.updateSettings);
  const [flow, setFlow]           = useState<WalletFlow>('choose');
  const [importTab, setImportTab] = useState<ImportTab>('mnemonic');
  const [importValue, setImportValue] = useState('');
  const [restoredAddresses, setRestoredAddresses] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setFlow('creating');
    try {
      const r = await wallet.create();
      // Persist the wallet path so the app uses it on next launch
      updateSettings({ wallet_path: r.wallet_path });
      onCreated(r);
    } catch (e) {
      toast.error(`Failed to create wallet: ${e}`);
      setFlow('choose');
    }
  };

  const handleImport = async () => {
    const val = importValue.trim();
    if (!val) return;

    if (importTab === 'mnemonic' && val.split(/\s+/).length < 12) {
      toast.error('Enter at least 12 seed words.');
      return;
    }
    if (importTab === 'wif' && val.length < 51) {
      toast.error('WIF key should be at least 51 characters.');
      return;
    }
    if (importTab === 'privkey' && !/^[0-9a-fA-F]{64}$/.test(val)) {
      toast.error('Private key must be 64 hex characters.');
      return;
    }

    setFlow('importing');
    try {
      let resolvedPath: string | null = null;
      if (importTab === 'mnemonic') {
        resolvedPath = await wallet.importMnemonic(val);
      } else if (importTab === 'wif') {
        resolvedPath = await wallet.importWif(val);
      } else {
        await wallet.importPrivateKey(val);
      }
      // Persist the wallet path so subsequent launches use the right file
      if (resolvedPath) {
        updateSettings({ wallet_path: resolvedPath });
      }
      // Fetch addresses to show confirmation screen
      let addrs: string[] = [];
      try {
        const list = await wallet.listAddresses();
        addrs = list.map((a) => a.address).filter(Boolean);
      } catch {
        // If listAddresses fails, try generating one
        try {
          const addr = await wallet.newAddress();
          if (addr) addrs = [addr];
        } catch { /* continue without address */ }
      }
      setRestoredAddresses(addrs);
      setFlow('restored');
    } catch (e) {
      toast.error(`Import failed: ${String(e)}`);
      setFlow('import_form');
    }
  };

  const goImport = () => { setImportValue(''); setFlow('import_form'); };
  const busy = flow === 'importing';

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  if (flow === 'creating') {
    return (
      <motion.div key="creating" {...fadeIn}>
        <div className="panel p-10 flex flex-col items-center gap-4">
          <div className="relative w-16 h-16 flex items-center justify-center">
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ border: '1px solid rgba(110,198,255,0.25)' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            />
            <Loader2 size={24} className="animate-spin" style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <p className="font-display font-semibold text-white text-center mb-1">Generating wallet</p>
            <p className="text-xs text-center" style={{ color: 'rgba(238,240,255,0.40)' }}>
              Creating BIP32 HD wallet with 24-word seed phrase…
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (flow === 'restored') {
    const primaryAddr = restoredAddresses[0] ?? '';
    return (
      <motion.div key="restored" {...fadeIn}>
        {/* Success header */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(34,197,94,0.14)',
              border: '1px solid rgba(34,197,94,0.40)',
              boxShadow: '0 0 18px rgba(52,211,153,0.30)',
            }}
          >
            <CheckCircle2 size={18} style={{ color: '#34d399' }} />
          </div>
          <div>
            <h2 className="font-display font-bold text-2xl gradient-text leading-none">Wallet Restored</h2>
            <p className="text-xs mt-1.5" style={{ color: 'rgba(238,240,255,0.50)' }}>
              Your wallet has been imported successfully.
            </p>
          </div>
        </div>

        {/* Address card */}
        {primaryAddr ? (
          <div className="panel p-4 mb-3">
            <p className="text-xs font-display font-bold mb-2 uppercase" style={{ color: 'rgba(110,198,255,0.55)', letterSpacing: '0.12em' }}>
              Primary Address
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-sm break-all"
                style={{ color: '#6ec6ff', fontFamily: '"JetBrains Mono", monospace' }}
              >
                {primaryAddr}
              </code>
              <button
                onClick={() => copyAddr(primaryAddr)}
                className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                style={{ background: 'rgba(110,198,255,0.12)', border: '1px solid rgba(110,198,255,0.30)' }}
                title="Copy address"
              >
                <Copy size={13} style={{ color: copied ? '#34d399' : '#6ec6ff' }} />
              </button>
            </div>
          </div>
        ) : (
          <div className="panel p-4 mb-3">
            <p className="text-xs" style={{ color: 'rgba(238,240,255,0.45)' }}>
              Address will appear on the Dashboard once the node finishes syncing.
            </p>
          </div>
        )}

        {/* Extra addresses */}
        {restoredAddresses.length > 1 && (
          <div className="panel p-4 mb-3">
            <p className="text-xs mb-2" style={{ color: 'rgba(238,240,255,0.40)' }}>
              {restoredAddresses.length - 1} additional address{restoredAddresses.length > 2 ? 'es' : ''} found
            </p>
            {restoredAddresses.slice(1).map((addr) => (
              <p
                key={addr}
                className="text-xs truncate"
                style={{ color: 'rgba(238,240,255,0.35)', fontFamily: '"JetBrains Mono", monospace' }}
              >
                {addr}
              </p>
            ))}
          </div>
        )}

        {/* Info note */}
        <div
          className="flex items-start gap-2 p-3 rounded-xl mb-6"
          style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)' }}
        >
          <Shield size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(148,187,233,0.80)' }}>
            Your balance and transaction history will load automatically on the Dashboard as the node syncs.
          </p>
        </div>

        <motion.button
          className="btn-primary flex items-center gap-2"
          onClick={onImported}
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.98 }}
          animate={{
            boxShadow: [
              '0 4px 16px rgba(110,198,255,0.35)',
              '0 6px 28px rgba(110,198,255,0.55)',
              '0 4px 16px rgba(110,198,255,0.35)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          Continue to Dashboard <ArrowRight size={15} />
        </motion.button>
      </motion.div>
    );
  }

  if (flow === 'import_form' || flow === 'importing') {
    const TABS: { id: ImportTab; label: string; icon: React.ElementType; placeholder: string; hint: string }[] = [
      {
        id:          'mnemonic',
        label:       'Seed Phrase',
        icon:        FileText,
        placeholder: 'word1 word2 word3 … word24',
        hint:        'BIP32 mnemonic — 12 or 24 space-separated words',
      },
      {
        id:          'wif',
        label:       'WIF Key',
        icon:        Key,
        placeholder: '5Jxx… or Kxx… or Lxx…',
        hint:        'Wallet Import Format (Base58Check-encoded private key)',
      },
      {
        id:          'privkey',
        label:       'Private Key',
        icon:        Lock,
        placeholder: '0x1a2b3c4d… (64 hex chars)',
        hint:        'Raw 256-bit private key in hexadecimal',
      },
    ];

    const active = TABS.find((t) => t.id === importTab)!;

    return (
      <motion.div key="import" {...fadeIn}>
        <h2 className="font-display font-bold text-2xl mb-1.5 gradient-text">Import Wallet</h2>
        <p className="text-sm mb-5" style={{ color: 'rgba(238,240,255,0.50)' }}>
          Choose your restore method below.
        </p>

        {/* Tab row */}
        <div
          className="flex gap-1 p-1 rounded-xl mb-5"
          style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(110,198,255,0.14)' }}
        >
          {TABS.map((t) => {
            const TabIcon = t.icon;
            const isActive = importTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setImportTab(t.id); setImportValue(''); }}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-display font-semibold transition-all"
                style={{
                  background:  isActive ? 'rgba(110,198,255,0.14)' : 'transparent',
                  color:       isActive ? '#6ec6ff' : 'rgba(238,240,255,0.45)',
                  border:      isActive ? '1px solid rgba(110,198,255,0.40)' : '1px solid transparent',
                  letterSpacing: '0.04em',
                }}
              >
                <TabIcon size={13} />
                {t.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs mb-2" style={{ color: 'rgba(238,240,255,0.35)' }}>{active.hint}</p>

        <textarea
          key={importTab}
          value={importValue}
          onChange={(e) => setImportValue(e.target.value)}
          placeholder={active.placeholder}
          rows={importTab === 'mnemonic' ? 4 : 2}
          className="input w-full resize-none mb-4"
          disabled={busy}
          style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13 }}
        />

        <div className="flex items-center gap-3">
          <button
            className="btn-ghost text-sm"
            style={{ color: 'rgba(238,240,255,0.45)' }}
            onClick={() => setFlow('choose')}
            disabled={busy}
          >
            ← Back
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleImport}
            disabled={busy || !importValue.trim()}
          >
            {busy ? (
              <><Loader2 size={14} className="animate-spin" /> Importing…</>
            ) : (
              <>Import Wallet <ArrowRight size={15} /></>
            )}
          </button>
        </div>
      </motion.div>
    );
  }

  // choose
  return (
    <motion.div key="choose" {...fadeIn}>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(59,59,255,0.20) 0%, rgba(110,198,255,0.14) 50%, rgba(167,139,250,0.18) 100%)',
            border: '1px solid rgba(110,198,255,0.30)',
            boxShadow: '0 0 18px rgba(110,198,255,0.18)',
          }}
        >
          <Shield size={17} style={{ color: '#6ec6ff' }} />
        </div>
        <h2 className="font-display font-bold text-2xl gradient-text">Wallet Setup</h2>
      </div>
      <p className="text-sm mb-7" style={{ color: 'rgba(238,240,255,0.50)' }}>
        Create a fresh HD wallet or restore from an existing wallet.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Create */}
        <motion.button
          onClick={handleCreate}
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          className="panel-elevated p-5 flex flex-col items-start gap-4 text-left"
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
              boxShadow: '0 4px 18px rgba(59,59,255,0.32), 0 0 22px rgba(110,198,255,0.22)',
            }}
          >
            <WalletIcon size={20} style={{ color: '#fff' }} />
          </div>
          <div>
            <div className="font-display font-bold text-white mb-1.5" style={{ fontSize: 15 }}>Create New Wallet</div>
            <div className="text-xs leading-relaxed" style={{ color: 'rgba(238,240,255,0.50)' }}>
              Generate a fresh BIP32 HD wallet with a 24-word seed phrase.
            </div>
          </div>
        </motion.button>

        {/* Import */}
        <motion.button
          onClick={goImport}
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          className="panel-elevated p-5 flex flex-col items-start gap-4 text-left"
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: 'rgba(0,0,0,0.40)',
              border: '1px solid rgba(110,198,255,0.30)',
            }}
          >
            <FileText size={20} style={{ color: '#6ec6ff' }} />
          </div>
          <div>
            <div className="font-display font-bold text-white mb-1.5" style={{ fontSize: 15 }}>Import Existing</div>
            <div className="text-xs leading-relaxed" style={{ color: 'rgba(238,240,255,0.50)' }}>
              Restore via seed phrase, WIF key, or raw private key.
            </div>
          </div>
        </motion.button>
      </div>
    </motion.div>
  );
}

// ─── Step 5: Backup & Secure ──────────────────────────────────────────────────
// Three cards — matches what the wallet binary actually exposes:
//   - address     : the wallet's bare address (always available)
//   - wif         : WIF key for that address — fetched via wallet.readWif()
//                   on mount. The WIF IS the private key in portable format;
//                   there is no separate "private key" surface to show.
//   - mnemonic    : BIP39 24-word recovery phrase from `export-mnemonic`,
//                   already populated in walletData by wallet_create.
// Public key is intentionally NOT shown — the wallet binary doesn't expose it,
// and it isn't needed for backup or recovery anyway.
type BackupField = {
  key: 'address' | 'wif' | 'mnemonic';
  label: string;
  icon: React.ElementType;
  sensitive: boolean;
  color: string;
  warning?: string;
};

const BACKUP_FIELDS: BackupField[] = [
  {
    key: 'address',
    label: 'Wallet Address',
    icon: WalletIcon,
    sensitive: false,
    color: '#a78bfa',
  },
  {
    key: 'wif',
    label: 'WIF Key',
    icon: Key,
    sensitive: true,
    color: '#ef4444',
    warning: 'The WIF is your private key in portable format. Anyone with it controls funds at this address.',
  },
  {
    key: 'mnemonic',
    label: 'Recovery Phrase (24 words)',
    icon: FileText,
    sensitive: true,
    color: '#ef4444',
    warning: 'Write these 24 words in order. Cannot be recovered if lost.',
  },
];

function BackupCard({
  field,
  value,
  revealed,
  onReveal,
  confirmed,
  onConfirm,
}: {
  field: BackupField;
  value: string;
  revealed: boolean;
  onReveal: () => void;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = field.icon;
  const isMnemonic = field.key === 'mnemonic';
  const words = isMnemonic ? value.split(' ') : [];

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel p-4"
      style={{ borderColor: confirmed ? `${field.color}40` : undefined }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${field.color}18`, border: `1px solid ${field.color}30` }}
          >
            <Icon size={13} style={{ color: field.color }} />
          </div>
          <span className="font-display font-semibold text-sm text-white">{field.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {(revealed || !field.sensitive) && (
            <button
              onClick={copy}
              className="btn-ghost text-xs py-1 px-2"
              style={{ color: 'rgba(238,240,255,0.40)' }}
            >
              <Copy size={11} />
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          )}
          {field.sensitive && (
            <button
              onClick={onReveal}
              className="btn-ghost text-xs py-1 px-2"
              style={{ color: revealed ? 'rgba(238,240,255,0.40)' : field.color }}
            >
              {revealed ? <><EyeOff size={11} /> Hide</> : <><Eye size={11} /> Reveal</>}
            </button>
          )}
        </div>
      </div>

      {/* Warning */}
      {field.warning && (
        <div
          className="flex items-start gap-2 mb-3 p-2.5 rounded-lg text-xs"
          style={{
            background: `${field.color}0a`,
            border: `1px solid ${field.color}20`,
            color: field.color,
          }}
        >
          <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
          <span>{field.warning}</span>
        </div>
      )}

      {/* Value */}
      <div className="relative">
        {isMnemonic ? (
          <div
            className={clsx(
              'grid grid-cols-4 gap-1.5 rounded-lg p-3 transition-all duration-200',
              !revealed && field.sensitive && 'blur-sm select-none',
            )}
            style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(110,198,255,0.12)' }}
          >
            {words.slice(0, 24).map((w, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 rounded" style={{ background: 'rgba(110,198,255,0.05)', border: '1px solid rgba(110,198,255,0.10)' }}>
                <span className="font-mono text-[9px] w-4 text-right flex-shrink-0" style={{ color: 'rgba(110,198,255,0.55)' }}>
                  {i + 1}
                </span>
                <span className="font-mono text-[11px] text-white truncate">{w}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className={clsx(
              'font-mono text-xs rounded-lg p-3 break-all transition-all duration-200',
              !revealed && field.sensitive && 'blur-sm select-none',
            )}
            style={{
              background: 'rgba(0,0,0,0.40)',
              border: '1px solid rgba(110,198,255,0.12)',
              color: 'rgba(238,240,255,0.85)',
              lineHeight: 1.6,
            }}
          >
            {value || '—'}
          </div>
        )}

        {/* Reveal overlay */}
        {field.sensitive && !revealed && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg">
            <button
              onClick={onReveal}
              className="btn-secondary text-xs flex items-center gap-1.5"
              style={{ borderColor: `${field.color}30`, color: field.color }}
            >
              <Eye size={12} /> Click to reveal
            </button>
          </div>
        )}
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-center gap-2.5 mt-3 cursor-pointer">
        <motion.input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
          className="w-4 h-4 flex-shrink-0"
          style={{ accentColor: field.color }}
          whileTap={{ scale: 0.9 }}
        />
        <span className="text-xs leading-snug" style={{ color: 'rgba(238,240,255,0.50)' }}>
          {field.key === 'mnemonic'
            ? 'I have written down my recovery phrase offline'
            : field.key === 'wif'
            ? 'I have securely stored my WIF key'
            : 'I have saved my wallet address'}
        </span>
      </label>
    </motion.div>
  );
}

function StepBackupSecure({
  walletData,
  onComplete,
}: {
  walletData: WalletCreateResult;
  onComplete: () => void;
}) {
  const [revealed, setRevealed]   = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  // WIF is fetched separately from wallet creation — wallet_create returns
  // address + mnemonic but not the per-address WIF. We call wallet.readWif
  // once on mount for the just-created wallet's primary address.
  // cancelled flag protects against an unlikely early-unmount before the
  // request resolves (would otherwise warn about setState on unmounted).
  const [wif, setWif]               = useState<string>('');
  const [wifLoading, setWifLoading] = useState<boolean>(true);
  useEffect(() => {
    let cancelled = false;
    setWifLoading(true);
    wallet.readWif(walletData.address)
      .then((value) => { if (!cancelled) setWif(value ?? ''); })
      .catch(() => { if (!cancelled) setWif(''); })
      .finally(() => { if (!cancelled) setWifLoading(false); });
    return () => { cancelled = true; };
  }, [walletData.address]);

  const getValue = (key: BackupField['key']): string => {
    switch (key) {
      case 'address':  return walletData.address;
      case 'wif':      return wifLoading
                         ? 'Loading…'
                         : (wif || '(failed to read WIF — open Security panel after launch)');
      case 'mnemonic': return walletData.mnemonic;
    }
  };

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const allConfirmed = BACKUP_FIELDS.every((f) => confirmed.has(f.key));

  return (
    <motion.div key="backup" {...fadeIn} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
            boxShadow: '0 4px 18px rgba(59,59,255,0.30), 0 0 22px rgba(110,198,255,0.20)',
          }}
        >
          <Shield size={18} style={{ color: '#fff' }} />
        </div>
        <h2 className="font-display font-bold text-2xl gradient-text">Backup &amp; Secure</h2>
      </div>
      <p className="text-sm mb-4" style={{ color: 'rgba(238,240,255,0.45)' }}>
        This information is shown <strong className="text-white">one time only</strong>. Store every item offline before continuing.
      </p>

      {/* Critical warning banner */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 p-3 rounded-xl mb-5"
        style={{
          background: 'rgba(239,68,68,0.07)',
          border: '1px solid rgba(239,68,68,0.20)',
        }}
      >
        <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#f87171' }} />
        <p className="text-xs leading-relaxed" style={{ color: '#f87171' }}>
          <strong>You will not be able to recover your wallet</strong> if you lose your recovery phrase or WIF key. Irium Core has no cloud backup. Write everything down now.
        </p>
      </motion.div>

      {/* Backup cards */}
      <div className="space-y-3 mb-6">
        {BACKUP_FIELDS.map((field, i) => (
          <motion.div
            key={field.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <BackupCard
              field={field}
              value={getValue(field.key)}
              revealed={!field.sensitive || revealed.has(field.key)}
              onReveal={() => setRevealed((prev) => toggle(prev, field.key))}
              confirmed={confirmed.has(field.key)}
              onConfirm={(v) =>
                setConfirmed((prev) => {
                  const next = new Set(prev);
                  v ? next.add(field.key) : next.delete(field.key);
                  return next;
                })
              }
            />
          </motion.div>
        ))}
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-4">
        {BACKUP_FIELDS.map((f) => (
          <motion.div
            key={f.key}
            className="h-1.5 flex-1 rounded-full"
            animate={{
              background: confirmed.has(f.key)
                ? 'linear-gradient(90deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)'
                : 'rgba(0,0,0,0.45)',
              boxShadow: confirmed.has(f.key) ? '0 0 8px rgba(110,198,255,0.45)' : 'none',
            }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>
      <p className="text-xs mb-5" style={{ color: 'rgba(238,240,255,0.35)' }}>
        {confirmed.size} of {BACKUP_FIELDS.length} items confirmed
      </p>

      {/* Launch button */}
      <motion.button
        className="btn-primary"
        onClick={onComplete}
        disabled={!allConfirmed}
        whileHover={allConfirmed ? { scale: 1.02, y: -1 } : {}}
        whileTap={allConfirmed ? { scale: 0.98 } : {}}
        animate={allConfirmed ? {
          boxShadow: [
            '0 4px 16px rgba(110,198,255,0.35)',
            '0 6px 28px rgba(110,198,255,0.55)',
            '0 4px 16px rgba(110,198,255,0.35)',
          ],
        } : {}}
        transition={{ duration: 2, repeat: Infinity }}
      >
        Launch Dashboard <ArrowRight size={15} />
      </motion.button>

      {!allConfirmed && (
        <p className="text-xs mt-2" style={{ color: 'rgba(238,240,255,0.30)' }}>
          Confirm all 4 items to continue
        </p>
      )}
    </motion.div>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────
function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden app-bg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45 }}
    >
      {/* Ambient glow — brand cyan + purple */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 70% 55% at 50% 40%, rgba(59,59,255,0.16) 0%, transparent 65%),
            radial-gradient(ellipse 50% 45% at 18% 80%, rgba(110,198,255,0.10) 0%, transparent 55%),
            radial-gradient(ellipse 50% 45% at 82% 20%, rgba(167,139,250,0.10) 0%, transparent 55%)
          `,
        }}
      />
      <ParticleField />

      <div className="relative z-10 flex flex-col items-center text-center px-8" style={{ maxWidth: 620 }}>
        {/* Logo */}
        <motion.img
          src="/logo.png"
          alt="Irium Core"
          className="mb-10"
          style={{ width: 96, height: 96, objectFit: 'contain', filter: 'drop-shadow(0 0 32px rgba(110,198,255,0.55)) drop-shadow(0 0 64px rgba(167,139,250,0.20))' }}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />

        {/* Title */}
        <motion.h1
          className="font-display font-bold mb-4"
          style={{ fontSize: 44, lineHeight: 1.1, letterSpacing: '0.01em' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <span style={{ color: '#eef0ff' }}>Welcome to</span>{' '}
          <span style={{ background: 'linear-gradient(135deg, #d4eeff 0%, #6ec6ff 50%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Irium Core
          </span>
        </motion.h1>

        <motion.p
          className="text-sm leading-relaxed mb-3"
          style={{ color: 'rgba(238,240,255,0.55)' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          Your full-node desktop wallet for the Irium blockchain. Send, receive, trade, and settle — all peer-to-peer, all on-chain.
        </motion.p>

        <motion.p
          className="text-xs mb-10"
          style={{ color: 'rgba(238,240,255,0.30)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          This setup wizard will configure your node, sync the chain, and create or restore your wallet.
        </motion.p>

        {/* Feature chips */}
        <motion.div
          className="flex flex-wrap justify-center gap-2 mb-10"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          {['Full Node', 'HD Wallet', 'P2P Trade', 'On-Chain Settlement', 'Privacy First'].map((f) => (
            <span
              key={f}
              className="text-xs px-3 py-1.5 rounded-full font-display font-semibold"
              style={{
                background: 'rgba(110,198,255,0.10)',
                border: '1px solid rgba(110,198,255,0.30)',
                color: '#6ec6ff',
                letterSpacing: '0.04em',
              }}
            >
              {f}
            </span>
          ))}
        </motion.div>

        <motion.button
          className="btn-primary flex items-center gap-2 px-8 py-3 text-base"
          onClick={onContinue}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.97 }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          Get Started <ArrowRight size={17} />
        </motion.button>
      </div>
    </motion.div>
  );
}

// ─── Main Onboarding ──────────────────────────────────────────────────────────
export default function Onboarding({ onComplete: onGateComplete }: { onComplete?: () => void } = {}) {
  const navigate   = useNavigate();
  const [showWelcome,  setShowWelcome]  = useState(true);
  const [step, setStep]               = useState(1);
  const [showStep5, setShowStep5]     = useState(false);
  const [createdWallet, setCreatedWallet] = useState<WalletCreateResult | null>(null);

  const complete = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    // Flip the OnboardingGate first — otherwise the wildcard <Navigate>
    // in OnboardingGate catches the /dashboard redirect and bounces it
    // back to /onboarding.
    onGateComplete?.();
    navigate('/dashboard', { replace: true });
  };

  const handleWalletCreated = (result: WalletCreateResult) => {
    setCreatedWallet(result);
    setShowStep5(true);
    setStep(5);
  };

  const handleWalletImported = () => {
    complete();
  };

  if (showWelcome) {
    return (
      <AnimatePresence>
        <WelcomeScreen onContinue={() => setShowWelcome(false)} />
      </AnimatePresence>
    );
  }

  return (
    <motion.div
      className="fixed inset-0 overflow-y-auto app-bg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Ambient background — brand cyan + purple */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 65% 55% at 15% 28%, rgba(59,59,255,0.10) 0%, transparent 60%),
            radial-gradient(ellipse 55% 60% at 85% 78%, rgba(167,139,250,0.08) 0%, transparent 55%),
            radial-gradient(ellipse 40% 40% at 50% 50%, rgba(110,198,255,0.05) 0%, transparent 55%)
          `,
        }}
      />

      {/* Vertically + horizontally centred shell. Uses min-h-full so the
          content centres when it fits the viewport, and scrolls naturally
          when it doesn't. */}
      <div className="relative z-10 min-h-full flex items-center justify-center px-10 py-16">
        <div
          className="flex items-start gap-16 w-full"
          style={{ maxWidth: 980 }}
        >
        {/* Left: Step rail */}
        <StepRail current={step} showStep5={showStep5} />

        {/* Right: Content */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <StepBinaryCheck key="s1" onNext={() => setStep(2)} />
            )}
            {step === 2 && (
              <StepBootstrap key="s2" onNext={() => setStep(3)} />
            )}
            {step === 3 && (
              <StepNetworkSync key="s3" onNext={() => setStep(4)} />
            )}
            {step === 4 && (
              <StepWalletSetup
                key="s4"
                onCreated={handleWalletCreated}
                onImported={handleWalletImported}
              />
            )}
            {step === 5 && createdWallet && (
              <StepBackupSecure
                key="s5"
                walletData={createdWallet}
                onComplete={complete}
              />
            )}
          </AnimatePresence>
        </div>
        </div>
      </div>
    </motion.div>
  );
}
