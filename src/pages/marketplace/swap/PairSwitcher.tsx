import type { SwapPairConfig } from './pairs/types';

// Horizontal pill row of every trading pair. Active pair is highlighted
// with its accent color, coming-soon pairs render dashed-border with a
// muted label and a small reason chip.

export interface PairSwitcherProps {
  pairs: SwapPairConfig[];
  activeId: string;
  onSelect: (id: string) => void;
}

export default function PairSwitcher({ pairs, activeId, onSelect }: PairSwitcherProps) {
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
        const disabled = !pair.available;
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
                ? pair.comingSoonReason ?? 'Not available yet'
                : `${pair.longLabel} — switch the panel to this pair`
            }
          >
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{pair.label}</span>
            {disabled && (
              <span
                className="text-[10px] font-display uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(252,211,77,0.10)',
                  color: '#fbbf24',
                  border: '1px solid rgba(252,211,77,0.25)',
                }}
              >
                Coming soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
