import type { ReactNode } from 'react';

// Status chip used across the Marketplace + Settlement tables and drawers.
// Intent maps to the Binance-style semantic palette in tailwind.config.js
// (`trade.*`): neutral grayscale, semantic buy/sell for direction, warn
// yellow for "funds locked / pending action", danger red for failure.
//
// The `dot` prop renders a 6 px leading status dot — used for "● Waiting
// payment", "● Locked" etc. in the My Trades and Agreements tables.

export type PillIntent = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'buy' | 'sell';
export type PillSize = 'xs' | 'sm' | 'md';

export interface PillProps {
  intent?: PillIntent;
  size?: PillSize;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

const intentClasses: Record<PillIntent, string> = {
  neutral: 'bg-[#2b3139] text-[#b7bdc6] border-[#2b3139]',
  success: 'bg-[rgba(14,203,129,0.12)] text-[#0ecb81] border-[rgba(14,203,129,0.30)]',
  warn:    'bg-[rgba(240,185,11,0.12)] text-[#f0b90b] border-[rgba(240,185,11,0.30)]',
  danger:  'bg-[rgba(246,70,93,0.12)]  text-[#f6465d] border-[rgba(246,70,93,0.30)]',
  info:    'bg-[rgba(28,140,255,0.12)] text-[#1c8cff] border-[rgba(28,140,255,0.30)]',
  buy:     'bg-[rgba(14,203,129,0.12)] text-[#0ecb81] border-[rgba(14,203,129,0.30)]',
  sell:    'bg-[rgba(246,70,93,0.12)]  text-[#f6465d] border-[rgba(246,70,93,0.30)]',
};

const sizeClasses: Record<PillSize, string> = {
  xs: 'h-[18px] px-1.5 text-[10px] gap-1 rounded',
  sm: 'h-[22px] px-2 text-[11px] gap-1.5 rounded',
  md: 'h-[26px] px-2.5 text-[12px] gap-1.5 rounded',
};

const dotColor: Record<PillIntent, string> = {
  neutral: '#b7bdc6',
  success: '#0ecb81',
  warn:    '#f0b90b',
  danger:  '#f6465d',
  info:    '#1c8cff',
  buy:     '#0ecb81',
  sell:    '#f6465d',
};

export default function Pill({
  intent = 'neutral',
  size = 'sm',
  dot = false,
  className = '',
  children,
}: PillProps) {
  return (
    <span
      className={`inline-flex items-center font-medium border whitespace-nowrap leading-none ${sizeClasses[size]} ${intentClasses[intent]} ${className}`}
    >
      {dot && (
        <span
          className="inline-block rounded-full"
          style={{
            width: 6,
            height: 6,
            backgroundColor: dotColor[intent],
          }}
        />
      )}
      {children}
    </span>
  );
}
