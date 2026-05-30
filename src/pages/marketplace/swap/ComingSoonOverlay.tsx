import { Bell, Hourglass } from 'lucide-react';
import type { SwapPairConfig } from './pairs/types';

// Full-panel replacement card shown when the active pair is not yet
// available. Replaces the order book, chart, modal triggers, etc.
// Plain English copy only — no protocol jargon.

export interface ComingSoonOverlayProps {
  pair: SwapPairConfig;
  reason: string;
  onNotifyMe?: () => void;
}

export default function ComingSoonOverlay({ pair, reason, onNotifyMe }: ComingSoonOverlayProps) {
  return (
    <div
      className="card p-8 flex flex-col items-center justify-center text-center space-y-4"
      style={{
        border: '1px dashed rgba(252,211,77,0.30)',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.10) 100%)',
        minHeight: 360,
      }}
    >
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{
          background: pair.accent.glow,
          border: `1px solid ${pair.accent.primary}`,
          color: pair.accent.text,
        }}
      >
        <Hourglass size={24} />
      </div>

      <div className="space-y-1 max-w-md">
        <h3
          className="font-display font-semibold"
          style={{ color: 'var(--t1)', fontSize: 18 }}
        >
          {pair.longLabel} is coming soon
        </h3>
        <p
          className="text-xs"
          style={{ color: 'rgba(238,240,255,0.65)', lineHeight: 1.6 }}
        >
          {reason}. Once the upgrade is live, this pair will open here with
          the same order book and one-click swap flow you already use for
          live pairs.
        </p>
      </div>

      <div
        className="text-[11px] px-3 py-2 rounded inline-flex items-center gap-2"
        style={{
          background: 'rgba(252,211,77,0.08)',
          color: '#fbbf24',
          border: '1px solid rgba(252,211,77,0.25)',
        }}
      >
        Pick a live pair from the switcher above to start trading right now.
      </div>

      {onNotifyMe && (
        <button
          type="button"
          onClick={onNotifyMe}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Bell size={13} />
          Notify me when {pair.label} is ready
        </button>
      )}
    </div>
  );
}
