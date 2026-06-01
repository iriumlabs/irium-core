import { useEffect, useRef, useState, type CSSProperties } from 'react';

// Displays a number with optional directional indicator (▲ / ▼) and
// colorisation based on delta sign. Also flashes the background once
// when `value` changes — used in the ticker strip and order-book mid
// row so live-updating numbers are visible without distracting motion.

export interface NumberDeltaProps {
  value: number | string;
  delta?: number | null;          // null/undefined → neutral, no arrow
  decimals?: number;
  showArrow?: boolean;
  className?: string;
  style?: CSSProperties;
  flashOnChange?: boolean;
  /** When delta is unavailable but value changed, use this hint for color */
  hint?: 'buy' | 'sell' | 'neutral';
}

function formatNumber(v: number | string, decimals?: number): string {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  if (decimals != null) return v.toFixed(decimals);
  return String(v);
}

export default function NumberDelta({
  value,
  delta,
  decimals,
  showArrow = true,
  className = '',
  style,
  flashOnChange = true,
  hint,
}: NumberDeltaProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevRef = useRef<number | string | null>(null);

  useEffect(() => {
    if (!flashOnChange) return;
    const prev = prevRef.current;
    if (prev != null && prev !== value) {
      const prevNum = typeof prev === 'number' ? prev : parseFloat(String(prev));
      const currNum = typeof value === 'number' ? value : parseFloat(String(value));
      if (Number.isFinite(prevNum) && Number.isFinite(currNum)) {
        setFlash(currNum > prevNum ? 'up' : currNum < prevNum ? 'down' : null);
        const t = setTimeout(() => setFlash(null), 380);
        return () => clearTimeout(t);
      }
    }
    prevRef.current = value;
  }, [value, flashOnChange]);

  useEffect(() => {
    prevRef.current = value;
  }, [value]);

  // Color resolution: delta wins over hint wins over neutral.
  let color = 'inherit';
  let arrow: '▲' | '▼' | null = null;
  if (delta != null && Number.isFinite(delta)) {
    if (delta > 0) { color = '#0ecb81'; arrow = '▲'; }
    else if (delta < 0) { color = '#f6465d'; arrow = '▼'; }
  } else if (hint === 'buy') {
    color = '#0ecb81';
  } else if (hint === 'sell') {
    color = '#f6465d';
  }

  const flashBg =
    flash === 'up'   ? 'rgba(14,203,129,0.16)' :
    flash === 'down' ? 'rgba(246,70,93,0.16)'  :
    'transparent';

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono leading-none transition-colors ${className}`}
      style={{
        color,
        backgroundColor: flashBg,
        padding: flash ? '1px 4px' : undefined,
        borderRadius: 3,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {showArrow && arrow && <span aria-hidden style={{ fontSize: '0.75em' }}>{arrow}</span>}
      <span>{formatNumber(value, decimals)}</span>
    </span>
  );
}
