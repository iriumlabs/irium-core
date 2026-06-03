import type { SwapPairConfig } from './pairs/types';
import { pairAvailability, formatBlocksRemaining } from './hooks/usePairAvailability';

// Horizontal pill row of every trading pair. Active pair is highlighted
// with its accent color, coming-soon and chain-gated pairs render
// dashed-border with a muted label and a small status chip. Chain-gated
// pairs (activationHeight set and not yet reached) show a blocks-remaining
// countdown so users see exactly when they'll go live.

export interface PairSwitcherProps {
  pairs: SwapPairConfig[];
  activeId: string;
  onSelect: (id: string) => void;
  // Local chain tip. Passed from SwapPanel so the switcher can compute
  // per-pair activation countdowns without each row owning its own hook.
  tipHeight: number;
}

export default function PairSwitcher({ pairs, activeId, onSelect, tipHeight }: PairSwitcherProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2 rounded"
      style={{
        background: 'rgba(0,0,0,0.20)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        className="text-[10px] font-display font-semibold uppercase tracking-wider px-1"
        style={{ color: 'rgba(238,240,255,0.45)' }}
      >
        Trading pair
      </div>
      {pairs.map((pair) => {
        const active = pair.id === activeId;
        const avail = pairAvailability(pair, tipHeight);
        const disabled = !avail.available;
        const gated = disabled && typeof avail.blocksUntilActive === 'number';
        const border = active
          ? `1px solid ${pair.accent.primary}`
          : disabled
          ? '1px dashed rgba(238,240,255,0.20)'
          : '1px solid rgba(238,240,255,0.10)';
        const background = active ? pair.accent.glow : 'transparent';
        const textColor = active
          ? pair.accent.text
          : disabled
          ? 'rgba(238,240,255,0.45)'
          : 'rgba(238,240,255,0.78)';
        const chipBg = gated ? 'rgba(110,198,255,0.10)' : 'rgba(252,211,77,0.10)';
        const chipFg = gated ? '#6EC6FF' : '#fbbf24';
        const chipBorder = gated
          ? '1px solid rgba(110,198,255,0.30)'
          : '1px solid rgba(252,211,77,0.25)';
        const chipText = gated
          ? `${avail.blocksUntilActive!.toLocaleString()} blocks · ${formatBlocksRemaining(avail.blocksUntilActive!)}`
          : 'Coming soon';
        return (
          <button
            key={pair.id}
            type="button"
            onClick={() => onSelect(pair.id)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-display font-semibold transition-colors"
            style={{
              border,
              background,
              color: textColor,
              cursor: disabled ? 'default' : 'pointer',
            }}
            title={
              disabled
                ? avail.reason ?? pair.comingSoonReason ?? 'Not available yet'
                : `${pair.longLabel} — switch the panel to this pair`
            }
          >
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{pair.label}</span>
            {disabled && (
              <span
                className="text-[10px] font-display uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{
                  background: chipBg,
                  color: chipFg,
                  border: chipBorder,
                }}
              >
                {chipText}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
