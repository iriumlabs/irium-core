import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck, ShoppingBag, FileText, Star } from 'lucide-react';

interface Section {
  id: string;
  label: string;
  Icon: React.ElementType;
}

const SECTIONS: Section[] = [
  { id: 'settlement',  label: 'Settlement',  Icon: ShieldCheck  },
  { id: 'marketplace', label: 'Marketplace', Icon: ShoppingBag  },
  { id: 'agreements',  label: 'Agreements',  Icon: FileText     },
  { id: 'reputation',  label: 'Reputation',  Icon: Star         },
];

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

const SECTION_CONTENT: Record<string, React.ReactNode> = {
  settlement:  <SettlementSection />,
  marketplace: <MarketplaceSection />,
  agreements:  <AgreementsSection />,
  reputation:  <ReputationSection />,
};

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
          <h1 className="page-title">Help</h1>
          <p className="page-subtitle">Documentation for Settlement, Marketplace, Agreements, and Reputation.</p>
        </div>

        {SECTIONS.map(({ id }) => (
          <div key={id} className="card p-6">
            {SECTION_CONTENT[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
