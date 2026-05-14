import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { open as shellOpen } from '@tauri-apps/api/shell';
import {
  ShieldCheck, ShoppingBag, FileText, Star, Info,
  Github, Globe, Pickaxe, ChevronDown, ExternalLink,
  Server, HelpCircle, Bug, Check,
} from 'lucide-react';
import { useStore } from '../lib/store';

// ── Spec table data ───────────────────────────────────────────────────────────
const SPECS = [
  { label: 'Network',              value: 'Mainnet' },
  { label: 'Coin',                 value: 'IRM' },
  { label: 'Max Supply',           value: '100,000,000 IRM' },
  { label: 'Block Time',           value: '~2 minutes target' },
  { label: 'Block Reward',         value: '50 IRM (Early Miner Era)' },
  { label: 'Consensus',            value: 'SHA-256d Proof of Work' },
  { label: 'Difficulty Algorithm', value: 'LWMA-144' },
  { label: 'Address Prefix',       value: 'P / Q' },
  { label: 'Key Derivation',       value: 'BIP32 (no BIP39 mnemonic — WIF key backup only)' },
  { label: 'RPC Port',             value: '38300' },
  { label: 'P2P Port',             value: '38291' },
  { label: 'Bootstrap',            value: 'DNS-free (signed seedlist + blockchain-embedded peers)' },
  { label: 'AuxPoW Merged Mining', value: 'Activating at block 26,347' },
];

const LINKS = [
  { label: 'GitHub',        url: 'https://github.com/iriumlabs/irium',                                    icon: Github  },
  { label: 'Website',       url: 'https://iriumlabs.org',                                                  icon: Globe   },
  { label: 'Whitepaper',    url: 'https://github.com/iriumlabs/irium/blob/main/docs/WHITEPAPER.md',        icon: FileText },
  { label: 'Mining Guide',  url: 'https://github.com/iriumlabs/irium/blob/main/MINING.md',                icon: Pickaxe },
];

const FAQS = [
  {
    q: 'Does Irium Core collect any data?',
    a: 'No. Irium Core runs entirely on your computer. No analytics, no telemetry, no usage tracking. The app never contacts any external server except the Irium P2P network for blockchain synchronization. Your wallet keys, transaction history, and all settings stay on your local machine. There are no user accounts and no registration.',
  },
  {
    q: 'Where are my wallet files stored?',
    a: 'All wallet data is stored in your local ~/.irium/ directory (on Windows: C:\\Users\\YourName\\.irium\\). This includes your wallet.json file, blockchain data, peer cache, and configuration. Nothing is stored in the cloud. If you uninstall the app, your wallet files remain on disk — you can reinstall and pick up where you left off. Always back up your recovery phrase and WIF keys separately in case of hardware failure.',
  },
  {
    q: 'My node is not connecting to peers',
    a: 'Irium uses a DNS-free bootstrap system. On first run it connects to signed seed nodes at 207.244.247.86:38291 and 157.173.116.134:38291. If you are behind a strict firewall, ensure outbound TCP port 38291 is allowed. You can also add a peer manually in Settings using the Add Seed option.',
  },
  {
    q: 'How do I start mining?',
    a: 'Go to the Mining page, enter your IRM address in the configuration field, set the number of threads, and click Start Mining. Your address must start with P or Q. Blocks take approximately 2 minutes on average to find.',
  },
  {
    q: 'What is a settlement agreement?',
    a: 'A settlement agreement locks IRM in escrow between a buyer and seller. Funds are only released when proof requirements are met or the timeout expires. Go to the Settlement page to create or manage agreements.',
  },
  {
    q: 'My wallet shows 0 IRM but I received funds',
    a: 'Click Refresh on the Wallet page or wait for the next polling cycle (15 seconds). If the balance still shows 0, ensure your node is fully synced — check the block height matches the network on the Block Explorer page.',
  },
  {
    q: 'How do I back up my wallet?',
    a: 'Irium wallets use BIP32 key derivation and do not have a 12 or 24 word recovery phrase. To back up your wallet, go to Wallet → Security → Export WIF Key or Export Backup File. Store the file or WIF key offline in a safe place.',
  },
  {
    q: 'What is the difference between P and Q addresses?',
    a: 'Both P and Q addresses are valid Irium addresses. They are derived from different parts of your HD wallet key tree. All addresses in your wallet belong to you and can receive IRM.',
  },
  {
    q: 'How do I connect to the mining pool?',
    a: 'Go to the Mining page and select the Stratum Pool tab. Enter the pool URL stratum+tcp://pool.iriumlabs.org:3333 for ASIC/modern miners or stratum+tcp://pool.iriumlabs.org:3335 for CPU/GPU miners. Your username should be your IRM address followed by a worker name, for example PwjVf7nY19UWW2i9HCEPyZt81975M6iKdW.worker1.',
  },
];

// ── Shared helpers ────────────────────────────────────────────────────────────
function openUrl(url: string) {
  shellOpen(url).catch(() => {});
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display font-bold text-base text-white mt-6 mb-2 first:mt-0">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/60 leading-relaxed mb-3">{children}</p>;
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2 mb-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm text-white/60">
          <span
            className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-display text-white"
            style={{ background: 'linear-gradient(135deg, #6ec6ff 0%, #a78bfa 100%)' }}
          >
            {i + 1}
          </span>
          <span className="leading-relaxed pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm text-white/70 leading-relaxed mb-3"
      style={{ background: 'rgba(110,198,255,0.07)', border: '1px solid rgba(110,198,255,0.15)' }}
    >
      {children}
    </div>
  );
}

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
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-4 text-sm text-white/55 leading-relaxed"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="pt-3">{a}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Section content ───────────────────────────────────────────────────────────
function AboutSection() {
  const appVersion = useStore((s) => s.appVersion);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const settings   = useStore((s) => s.settings);
  const dataDir    = settings.data_dir ?? '~/.irium/';
  const rpcUrl     = settings.rpc_url  ?? 'http://127.0.0.1:38300';
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <div id="about" className="scroll-mt-6 space-y-6">
      {/* App header */}
      <div className="panel-elevated p-6 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 20% 50%, rgba(110,198,255,0.12) 0%, transparent 70%)' }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-5">
            <img
              src="/logo.png"
              alt="Irium"
              style={{ width: 56, height: 56, borderRadius: '50%', boxShadow: '0 0 24px rgba(110,198,255,0.5)' }}
            />
            <div>
              <div className="font-display font-bold text-2xl gradient-text">Irium Core</div>
              <div className="font-mono text-xs text-white/35 mt-0.5">v{appVersion}</div>
            </div>
          </div>
          <p className="text-sm text-white/55 leading-relaxed mb-6">
            Irium Core is a full-node GUI desktop wallet for the Irium blockchain. It runs a complete iriumd node
            locally, giving you full sovereignty over your funds and settlement agreements. No third-party servers.
            No custodians. Your keys, your chain.
          </p>
          <div className="rounded-xl overflow-hidden border border-white/[0.07] mb-6">
            {SPECS.map(({ label, value }, i) => (
              <div
                key={label}
                className="flex items-start gap-4 px-4 py-2.5 text-sm"
                style={{
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                  borderBottom: i < SPECS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                }}
              >
                <span className="text-white/35 w-48 flex-shrink-0 font-display text-xs">{label}</span>
                <span className="font-mono text-xs text-white/75 break-all">{value}</span>
              </div>
            ))}
          </div>
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

      {/* Node information */}
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Server size={16} className="text-irium-400 flex-shrink-0" />
          <h2 className="font-display font-semibold text-white/90 text-base">Node Information</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { label: 'iriumd version',  value: nodeStatus?.version ?? appVersion },
            { label: 'Data directory',  value: dataDir },
            { label: 'RPC endpoint',    value: rpcUrl },
            { label: 'Block height',    value: nodeStatus?.running ? `#${(nodeStatus.height ?? 0).toLocaleString('en-US')}` : '—' },
            { label: 'Sync status',     value: nodeStatus?.running ? (nodeStatus.synced ? 'Fully synced' : 'Syncing…') : 'Offline' },
            { label: 'Connected peers', value: nodeStatus?.running ? String(nodeStatus.peers ?? 0) : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-white/[0.025] border border-white/[0.06]">
              <span className="text-[10px] text-white/35 font-display uppercase tracking-wider">{label}</span>
              <span className="font-mono text-sm text-white/75 break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Privacy */}
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
          <p className="font-display font-bold text-base mb-1.5" style={{ color: '#34d399' }}>
            Your Data Stays on Your Machine
          </p>
          <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgba(238,240,255,0.65)' }}>
            Irium Core is a full-node desktop wallet that runs entirely on your computer. No data is collected,
            transmitted, or stored on any external server.
          </p>
          <ul className="space-y-2.5">
            {[
              'No analytics or telemetry — the app does not phone home',
              'No account registration required — there are no user accounts',
              'Wallet keys and seed phrases are stored locally in your ~/.irium/ directory only',
              'Transaction history is read directly from your local blockchain copy',
              'Peer connections use direct IP-to-IP communication with no intermediary servers',
              'No DNS lookups — peer discovery is fully DNS-free using signed seedlists and blockchain-embedded addresses',
            ].map((point, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5"
                  style={{ background: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.40)' }}
                >
                  <Check size={9} strokeWidth={3} style={{ color: '#34d399' }} />
                </span>
                <span className="text-sm leading-relaxed" style={{ color: 'rgba(238,240,255,0.75)' }}>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* FAQ */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <HelpCircle size={16} className="text-irium-400 flex-shrink-0" />
          <h2 className="font-display font-semibold text-white/90 text-base">FAQ</h2>
        </div>
        <div className="space-y-2">
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </div>

      {/* Report an issue */}
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Bug size={16} className="text-irium-400 flex-shrink-0" />
          <h2 className="font-display font-semibold text-white/90 text-base">Report an Issue</h2>
        </div>
        <p className="text-sm text-white/50 leading-relaxed mb-4">
          Found a bug or need help? Open an issue on the Irium Core GitHub repository. Include your app version,
          operating system, and a description of the problem.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => openUrl('https://github.com/iriumlabs/irium-core/issues/new')}
            className="btn-primary gap-2"
          >
            <Bug size={14} /> Open Issue on GitHub
          </button>
          <button
            onClick={() => openUrl('https://github.com/iriumlabs/irium-core/issues')}
            className="btn-secondary gap-2"
          >
            <ExternalLink size={14} /> View Existing Issues
          </button>
        </div>
      </div>

      {/* Licenses */}
      <div className="card p-4">
        <button
          onClick={() => setLicensesOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-sm text-white/40">Licenses</span>
          <ChevronDown
            size={14}
            className="text-white/30 transition-transform duration-200"
            style={{ transform: licensesOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        <AnimatePresence initial={false}>
          {licensesOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="pt-3 space-y-2">
                <p className="text-xs text-white/35 leading-relaxed">
                  Irium Core is open source software released under the MIT License.
                </p>
                <button
                  onClick={() => openUrl('https://github.com/iriumlabs/irium-core/blob/main/LICENSE')}
                  className="flex items-center gap-1.5 text-xs text-irium-400 hover:text-irium-300 transition-colors"
                >
                  <ExternalLink size={11} /> View License
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SettlementSection() {
  return (
    <div id="settlement" className="scroll-mt-6">
      <Heading>What is Settlement?</Heading>
      <P>
        Settlement lets two parties lock funds in a provably-fair on-chain escrow. Money is only released
        when the recipient submits a cryptographic proof — or returned to the sender if the deadline passes.
        No intermediary, no disputes with a central authority.
      </P>

      <Heading>Templates</Heading>
      <P>Pick the template that matches your use-case:</P>
      <ul className="space-y-1.5 mb-3 text-sm text-white/60">
        <li><span className="text-white/90 font-medium">OTC Trade</span> — direct asset swap between two parties.</li>
        <li><span className="text-white/90 font-medium">Freelance</span> — single-payment job escrow with optional scope description.</li>
        <li><span className="text-white/90 font-medium">Milestones</span> — split payment across 2–20 equal milestones, each requiring a proof.</li>
        <li><span className="text-white/90 font-medium">Time-lock Deposit</span> — funds held until a deadline then released or refunded.</li>
        <li><span className="text-white/90 font-medium">Merchant Delayed</span> — buyer pays, merchant claims after a cool-down window that gives the buyer time to dispute.</li>
        <li><span className="text-white/90 font-medium">Contractor Milestones</span> — milestone escrow framed around client / contractor roles with optional scope.</li>
      </ul>

      <Heading>Creating an agreement (Seller flow)</Heading>
      <Steps items={[
        'Open Settlement → click "I\'m Selling".',
        'Fill in the buyer\'s address, amount, deadline, and any template-specific fields.',
        'Review the summary — verify addresses and amounts before confirming.',
        'Share the agreement ID with the buyer so they can fund it.',
        'Submit a delivery proof once you\'ve fulfilled the obligation.',
        'Claim your funds after the proof is accepted.',
      ]} />

      <Heading>Funding as a buyer</Heading>
      <Steps items={[
        'Open Settlement → click "I\'m Buying".',
        'Paste the agreement ID the seller shared.',
        'Confirm the amount matches what you agreed off-chain.',
        'Click Fund — this locks your coins in escrow.',
        'Once the seller submits a proof, verify it and release payment.',
      ]} />

      <Heading>Proofs</Heading>
      <P>
        A proof is a signed message proving delivery. The seller generates it from the Agreements page
        after fulfilling the obligation. The buyer reviews the proof and clicks Release to complete payment.
        If the proof is missing or wrong, the buyer can dispute before the deadline.
      </P>

      <Heading>Disputes</Heading>
      <P>
        If something goes wrong, open the agreement in Agreements and click Dispute before the deadline expires.
        A dispute freezes the escrow. Resolution is handled on-chain by the Irium arbitration contract —
        both parties must submit evidence via their wallet CLI.
      </P>

      <Callout>
        <strong className="text-white">Common mistake:</strong> Setting a deadline too short. Always give
        yourself enough time to complete delivery and for the buyer to review the proof.
        Merchant Delayed has two separate windows — the cool-down (buyer dispute period) and the total escrow window.
      </Callout>
    </div>
  );
}

function MarketplaceSection() {
  return (
    <div id="marketplace" className="scroll-mt-6">
      <Heading>What is the Marketplace?</Heading>
      <P>
        The Marketplace is a peer-to-peer offer board. Sellers post offers describing what they're selling,
        at what price, and the settlement terms. Buyers browse and respond directly — no central server,
        orders propagate through the Irium gossip network.
      </P>

      <Heading>Posting an offer</Heading>
      <Steps items={[
        'Go to Marketplace → My Offers → click Post Offer.',
        'Set the asset, price (in IRM), and settlement template.',
        'Add a description so buyers know what they\'re getting.',
        'Submit — the offer broadcasts to connected peers.',
      ]} />

      <Heading>Responding to an offer (buyer)</Heading>
      <Steps items={[
        'Browse Offers — filter by asset or price range.',
        'Click an offer to view terms.',
        'Click Buy — this opens a new settlement agreement pre-filled with the offer details.',
        'Fund the escrow and wait for the seller to deliver and submit proof.',
      ]} />

      <Heading>Feed Registry</Heading>
      <P>
        Feeds are curated offer streams published by trusted sellers. Subscribe to a feed to automatically
        see new offers from that seller in your Browse view. Unsubscribe any time.
      </P>

      <Callout>
        <strong className="text-white">Tip:</strong> Offers are propagated via gossip — peers that go offline
        may not see your offer. Re-post if you haven't had a response after a few hours.
      </Callout>
    </div>
  );
}

function AgreementsSection() {
  return (
    <div id="agreements" className="scroll-mt-6">
      <Heading>What is the Agreements page?</Heading>
      <P>
        Agreements is your ledger of all settlement agreements you've created or participated in.
        You can track status, submit proofs, fund, release, or dispute from here.
      </P>

      <Heading>Agreement lifecycle</Heading>
      <Steps items={[
        'Created — agreement exists on-chain, waiting for the buyer to fund.',
        'Funded — buyer has locked coins in escrow. Seller can now fulfill and submit proof.',
        'Proof submitted — seller has provided delivery proof. Buyer reviews.',
        'Released — buyer approved proof, funds sent to seller. Done.',
        'Refunded — deadline passed or dispute resolved in buyer\'s favour. Funds returned.',
        'Disputed — buyer raised a dispute. Awaiting on-chain arbitration.',
      ]} />

      <Heading>Submitting a proof</Heading>
      <Steps items={[
        'Open the agreement from the list.',
        'Click Submit Proof.',
        'Paste or upload your signed proof file.',
        'Confirm — proof is broadcast on-chain.',
      ]} />

      <Heading>Importing agreements</Heading>
      <P>
        Use Import Pack to restore a batch of agreements from a JSON export.
        Use Import Invoice to create a new agreement directly from a payment invoice JSON generated by another Irium wallet.
      </P>

      <Callout>
        <strong className="text-white">Note:</strong> You can only submit a proof or release/refund if you are
        a party to the agreement and your wallet is unlocked. Make sure the correct address is selected.
      </Callout>
    </div>
  );
}

function ReputationSection() {
  return (
    <div id="reputation" className="scroll-mt-6">
      <Heading>What is Reputation?</Heading>
      <P>
        Irium's on-chain reputation system scores addresses based on their settlement history —
        successful completions, disputes raised, refunds received, and how long they've been active.
        Scores are deterministic and verifiable by any node.
      </P>

      <Heading>Querying a score</Heading>
      <Steps items={[
        'Enter a Q-prefix address or 64-hex public key in the search bar.',
        'Press Enter or click Lookup.',
        'Review the score breakdown — overall score, completed agreements, disputes, volume.',
      ]} />

      <Heading>Understanding the score</Heading>
      <ul className="space-y-1.5 mb-3 text-sm text-white/60">
        <li><span className="text-white/90 font-medium">Score 80–100</span> — excellent track record, minimal disputes.</li>
        <li><span className="text-white/90 font-medium">Score 50–79</span> — moderate history, verify before large trades.</li>
        <li><span className="text-white/90 font-medium">Score below 50</span> — use caution. Multiple disputes or refunds on record.</li>
      </ul>

      <Heading>Building your reputation</Heading>
      <P>
        Complete agreements on time, submit proofs promptly, and avoid raising frivolous disputes.
        Each successfully released agreement adds to your score. Disputes lower it, even if resolved in your favour.
      </P>

      <Callout>
        <strong className="text-white">Tip:</strong> Check a counterparty's reputation before funding a large
        escrow. A score below 60 is a red flag for first-time trades.
      </Callout>
    </div>
  );
}

// ── Nav sections ──────────────────────────────────────────────────────────────
interface Section {
  id: string;
  label: string;
  Icon: React.ElementType;
}

const SECTIONS: Section[] = [
  { id: 'about',       label: 'About',       Icon: Info        },
  { id: 'settlement',  label: 'Settlement',  Icon: ShieldCheck },
  { id: 'marketplace', label: 'Marketplace', Icon: ShoppingBag },
  { id: 'agreements',  label: 'Agreements',  Icon: FileText    },
  { id: 'reputation',  label: 'Reputation',  Icon: Star        },
];

const SECTION_CONTENT: Record<string, React.ReactNode> = {
  about:       <AboutSection />,
  settlement:  <SettlementSection />,
  marketplace: <MarketplaceSection />,
  agreements:  <AgreementsSection />,
  reputation:  <ReputationSection />,
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Help() {
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (!hash) return;
    const el = contentRef.current?.querySelector(`#${hash}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Fixed left nav */}
      <nav
        className="flex-shrink-0 w-44 flex flex-col gap-1 py-6 pl-6 pr-3 border-r overflow-y-auto"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="text-[10px] font-display font-bold text-white/30 uppercase tracking-widest mb-2 px-2">
          Help Topics
        </div>
        {SECTIONS.map(({ id, label, Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault();
              const el = contentRef.current?.querySelector(`#${id}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              window.history.replaceState(null, '', `/help#${id}`);
            }}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-white/45 hover:text-white/90 hover:bg-white/5 transition-colors font-display font-medium"
          >
            <Icon size={14} className="flex-shrink-0" />
            {label}
          </a>
        ))}
      </nav>

      {/* Scrollable content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-12">
        <div>
          <h1 className="page-title">Help &amp; About</h1>
          <p className="page-subtitle">App information, documentation, and FAQ.</p>
        </div>

        {/* About renders directly (no card wrapper — it has its own sub-cards) */}
        <div key="about">
          {SECTION_CONTENT['about']}
        </div>

        {/* Other sections get the standard card wrapper */}
        {SECTIONS.slice(1).map(({ id }) => (
          <div key={id} className="card p-6">
            {SECTION_CONTENT[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
