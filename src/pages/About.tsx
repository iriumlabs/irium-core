import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open as shellOpen } from "@tauri-apps/api/shell";
import {
  Github,
  Globe,
  FileText,
  Pickaxe,
  ChevronDown,
  ExternalLink,
  Info,
  Server,
  HelpCircle,
  Bug,
  ShieldCheck,
  Check,
} from "lucide-react";
import { useStore } from "../lib/store";

// ── Spec table data ────────────────────────────────────────────
const SPECS = [
  { label: "Network",              value: "Mainnet" },
  { label: "Coin",                 value: "IRM" },
  { label: "Max Supply",           value: "100,000,000 IRM" },
  { label: "Block Time",           value: "~2 minutes target" },
  { label: "Block Reward",         value: "50 IRM (Early Miner Era)" },
  { label: "Consensus",            value: "SHA-256d Proof of Work" },
  { label: "Difficulty Algorithm", value: "LWMA-144" },
  { label: "Address Prefix",       value: "P / Q" },
  { label: "Key Derivation",       value: "BIP32 (no BIP39 mnemonic — WIF key backup only)" },
  { label: "RPC Port",             value: "38300" },
  { label: "P2P Port",             value: "38291" },
  { label: "Bootstrap",            value: "DNS-free (signed seedlist + blockchain-embedded peers)" },
  { label: "AuxPoW Merged Mining", value: "Activating at block 26,347" },
];

// ── Links ──────────────────────────────────────────────────────
const LINKS = [
  {
    label: "GitHub",
    url: "https://github.com/iriumlabs/irium",
    icon: Github,
  },
  {
    label: "Website",
    url: "https://iriumlabs.org",
    icon: Globe,
  },
  {
    label: "Whitepaper",
    url: "https://github.com/iriumlabs/irium/blob/main/docs/WHITEPAPER.md",
    icon: FileText,
  },
  {
    label: "Mining Guide",
    url: "https://github.com/iriumlabs/irium/blob/main/MINING.md",
    icon: Pickaxe,
  },
];

// ── FAQ data ───────────────────────────────────────────────────
// NOTE: seed IPs in the "My node is not connecting" answer below must match
// the seed nodes configured in src-tauri/src/main.rs.
const FAQS = [
  {
    q: "Does Irium Core collect any data?",
    a: "No. Irium Core runs entirely on your computer. No analytics, no telemetry, no usage tracking. The app never contacts any external server except the Irium P2P network for blockchain synchronization. Your wallet keys, transaction history, and all settings stay on your local machine. There are no user accounts and no registration.",
  },
  {
    q: "Where are my wallet files stored?",
    a: "All wallet data is stored in your local ~/.irium/ directory (on Windows: C:\\Users\\YourName\\.irium\\). This includes your wallet.json file, blockchain data, peer cache, and configuration. Nothing is stored in the cloud. If you uninstall the app, your wallet files remain on disk — you can reinstall and pick up where you left off. Always back up your recovery phrase and WIF keys separately in case of hardware failure.",
  },
  {
    q: "My node is not connecting to peers",
    a: "Irium uses a DNS-free bootstrap system. On first run it connects to signed seed nodes at 207.244.247.86:38291 and 157.173.116.134:38291. If you are behind a strict firewall, ensure outbound TCP port 38291 is allowed. You can also add a peer manually in Settings using the Add Seed option.",
  },
  {
    q: "How do I start mining?",
    a: "Go to the Mining page, enter your IRM address in the configuration field, set the number of threads, and click Start Mining. Your address must start with P or Q. Blocks take approximately 2 minutes on average to find.",
  },
  {
    q: "What is a settlement agreement?",
    a: "A settlement agreement locks IRM in escrow between a buyer and seller. Funds are only released when proof requirements are met or the timeout expires. Go to the Settlement page to create or manage agreements.",
  },
  {
    q: "My wallet shows 0 IRM but I received funds",
    a: "Click Refresh on the Wallet page or wait for the next polling cycle (15 seconds). If the balance still shows 0, ensure your node is fully synced — check the block height matches the network on the Block Explorer page.",
  },
  {
    q: "How do I back up my wallet?",
    a: "Irium wallets use BIP32 key derivation and do not have a 12 or 24 word recovery phrase. To back up your wallet, go to Wallet → Security → Export WIF Key or Export Backup File. Store the file or WIF key offline in a safe place.",
  },
  {
    q: "What is the difference between P and Q addresses?",
    a: "Both P and Q addresses are valid Irium addresses. They are derived from different parts of your HD wallet key tree. All addresses in your wallet belong to you and can receive IRM.",
  },
  {
    q: "How do I connect to the mining pool?",
    a: "Go to the Mining page and select the Stratum Pool tab. Enter the pool URL stratum+tcp://pool.iriumlabs.org:3333 for ASIC/modern miners or stratum+tcp://pool.iriumlabs.org:3335 for CPU/GPU miners. Your username should be your IRM address followed by a worker name, for example PwjVf7nY19UWW2i9HCEPyZt81975M6iKdW.worker1.",
  },
];

// ── Helpers ────────────────────────────────────────────────────
function openUrl(url: string) {
  shellOpen(url).catch(() => {
    // fallback: nothing — we can't use window.open reliably in Tauri
  });
}

// ── Section header ─────────────────────────────────────────────
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <Icon size={16} className="text-irium-400 flex-shrink-0" />
      <h2 className="font-display font-semibold text-white/90 text-base">{title}</h2>
    </div>
  );
}

// ── Accordion item ─────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/[0.07] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="font-display font-medium text-sm text-white/80">{q}</span>
        <ChevronDown
          size={15}
          className="flex-shrink-0 text-white/40 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-4 text-sm text-white/55 leading-relaxed"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="pt-3">{a}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Licenses section ───────────────────────────────────────────
function LicensesSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-sm text-white/40">Licenses</span>
        <ChevronDown
          size={14}
          className="text-white/30 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="pt-3 space-y-2">
              <p className="text-xs text-white/35 leading-relaxed">
                Irium Core is open source software released under the MIT License.
              </p>
              <button
                onClick={() =>
                  openUrl(
                    "https://github.com/iriumlabs/irium-core/blob/main/LICENSE"
                  )
                }
                className="flex items-center gap-1.5 text-xs text-irium-400 hover:text-irium-300 transition-colors"
              >
                <ExternalLink size={11} /> View License
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function AboutPage() {
  const appVersion = useStore((s) => s.appVersion);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const settings = useStore((s) => s.settings);

  const dataDir = settings.data_dir ?? "~/.irium/";
  const rpcUrl = settings.rpc_url ?? "http://127.0.0.1:38300";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto"
    >
      <div className="px-8 py-6 w-full">
        <div className="reading-col space-y-6" style={{ maxWidth: 1100 }}>

        {/* ── Section 1: About Irium Core ──────────────────────── */}
        <div className="panel-elevated p-6 relative overflow-hidden">
          {/* bg glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 20% 50%, rgba(110,198,255,0.12) 0%, transparent 70%)",
            }}
          />
          <div className="relative z-10">
            {/* Logo + name */}
            <div className="flex items-center gap-4 mb-5">
              <img
                src="/logo.png"
                alt="Irium"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  boxShadow: "0 0 24px rgba(110,198,255,0.5)",
                }}
              />
              <div>
                <div className="font-display font-bold text-2xl gradient-text">
                  Irium Core
                </div>
                <div className="font-mono text-xs text-white/35 mt-0.5">
                  v{appVersion}
                </div>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-white/55 leading-relaxed mb-6">
              Irium Core is a full-node GUI desktop wallet for the Irium
              blockchain. It runs a complete iriumd node locally, giving you
              full sovereignty over your funds and settlement agreements. No
              third-party servers. No custodians. Your keys, your chain.
            </p>

            {/* Specs grid */}
            <div className="rounded-xl overflow-hidden border border-white/[0.07] mb-6">
              {SPECS.map(({ label, value }, i) => (
                <div
                  key={label}
                  className="flex items-start gap-4 px-4 py-2.5 text-sm"
                  style={{
                    background:
                      i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
                    borderBottom:
                      i < SPECS.length - 1
                        ? "1px solid rgba(255,255,255,0.05)"
                        : undefined,
                  }}
                >
                  <span className="text-white/35 w-48 flex-shrink-0 font-display text-xs">
                    {label}
                  </span>
                  <span className="font-mono text-xs text-white/75 break-all">
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* Links row */}
            <div className="flex flex-wrap gap-2">
              {LINKS.map(({ label, url, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => openUrl(url)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-display font-medium text-white/60 hover:text-white border border-white/10 hover:border-irium-500/40 hover:bg-irium-500/10 transition-all duration-150"
                >
                  <Icon size={13} />
                  {label}
                  <ExternalLink size={10} className="text-white/25" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Section 2: Node Information ───────────────────────── */}
        <div className="card p-5">
          <SectionHeader icon={Server} title="Node Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: "iriumd version",  value: nodeStatus?.version ?? appVersion },
              { label: "Data directory",  value: dataDir },
              { label: "RPC endpoint",    value: rpcUrl },
              { label: "Block height",    value: nodeStatus?.running ? `#${(nodeStatus.height ?? 0).toLocaleString('en-US')}` : "—" },
              {
                label: "Sync status",
                value: nodeStatus?.running
                  ? nodeStatus.synced
                    ? "Fully synced"
                    : "Syncing…"
                  : "Offline",
              },
              { label: "Connected peers", value: nodeStatus?.running ? String(nodeStatus.peers ?? 0) : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-white/[0.025] border border-white/[0.06]">
                <span className="text-[10px] text-white/35 font-display uppercase tracking-wider">{label}</span>
                <span className="font-mono text-sm text-white/75 break-all">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 3: Privacy & Data ─────────────────────────────
            Subtle green-tinted border + emerald shield to mark this as
            a positive trust signal distinct from the other info cards. */}
        <div
          className="p-5 rounded-[10px] relative overflow-hidden"
          style={{
            background: 'var(--bg-elev-1)',
            border: '1px solid rgba(52,211,153,0.30)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.40), 0 0 22px rgba(52,211,153,0.06)',
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 70% 100% at 0% 0%, rgba(52,211,153,0.10) 0%, transparent 65%)' }}
          />
          <div className="relative">
            <div className="flex items-center gap-2.5 mb-4">
              <ShieldCheck size={16} style={{ color: '#34d399' }} className="flex-shrink-0" />
              <h2 className="font-display font-semibold text-white/90 text-base">Privacy &amp; Data</h2>
            </div>

            <div className="mb-4">
              <p
                className="font-display font-bold text-base mb-1.5"
                style={{ color: '#34d399' }}
              >
                Your Data Stays on Your Machine
              </p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(238,240,255,0.65)' }}>
                Irium Core is a full-node desktop wallet that runs entirely on your computer. No data is collected, transmitted, or stored on any external server.
              </p>
            </div>

            <ul className="space-y-2.5">
              {[
                'No analytics or telemetry — the app does not phone home',
                'No account registration required — there are no user accounts',
                'Wallet keys and seed phrases are stored locally in your ~/.irium/ directory only',
                'Transaction history is read directly from your local blockchain copy',
                'Peer connections use direct IP-to-IP communication with no intermediary servers',
                'No DNS lookups — peer discovery is fully DNS-free using signed seedlists and blockchain-embedded addresses',
                <>
                  The app is open source — verify everything at{' '}
                  <button
                    onClick={() => openUrl('https://github.com/iriumlabs/irium')}
                    className="underline underline-offset-2 hover:text-white transition-colors font-mono"
                    style={{ color: '#34d399' }}
                  >
                    github.com/iriumlabs/irium
                  </button>
                </>,
              ].map((point, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5"
                    style={{
                      background: 'rgba(52,211,153,0.16)',
                      border: '1px solid rgba(52,211,153,0.40)',
                    }}
                  >
                    <Check size={9} strokeWidth={3} style={{ color: '#34d399' }} />
                  </span>
                  <span className="text-sm leading-relaxed" style={{ color: 'rgba(238,240,255,0.75)' }}>
                    {point}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Section 4: Help / FAQ ─────────────────────────────── */}
        <div>
          <SectionHeader icon={HelpCircle} title="Help" />
          <div className="space-y-2">
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>

        {/* ── Section 4: Report an Issue ────────────────────────── */}
        <div className="card p-5">
          <SectionHeader icon={Bug} title="Report an Issue" />
          <p className="text-sm text-white/50 leading-relaxed mb-4">
            Found a bug or need help? Open an issue on the Irium Core GitHub
            repository. Include your app version, operating system, and a
            description of the problem.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() =>
                openUrl("https://github.com/iriumlabs/irium-core/issues/new")
              }
              className="btn-primary gap-2"
            >
              <Bug size={14} /> Open Issue on GitHub
            </button>
            <button
              onClick={() =>
                openUrl("https://github.com/iriumlabs/irium-core/issues")
              }
              className="btn-secondary gap-2"
            >
              <ExternalLink size={14} /> View Existing Issues
            </button>
          </div>
        </div>

        {/* ── Section 5: Licenses ───────────────────────────────── */}
        <LicensesSection />

        </div>
      </div>
    </motion.div>
  );
}
