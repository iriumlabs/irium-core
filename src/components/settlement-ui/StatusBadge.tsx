import { useTranslation } from 'react-i18next';
import { Clock, CheckCircle2, ArrowDownLeft, AlertTriangle, Check, RotateCcw, XCircle, Loader2 } from 'lucide-react';
import type { PlainStatus, PlainStatusColor, PlainStatusKind } from './PlainStatus';

interface StatusBadgeProps {
  status: PlainStatus;
  size?: 'sm' | 'md';
  withIcon?: boolean;
  className?: string;
}

// Visual mapping for each status color tier — aligned with the
// `trade.*` Binance-style palette in tailwind.config.js so settlement
// status pills match Marketplace order-book + My Trades chips.
const COLOR_STYLES: Record<PlainStatusColor, { bg: string; border: string; text: string }> = {
  success: {
    bg: 'rgba(14,203,129,0.12)',
    border: 'rgba(14,203,129,0.30)',
    text: '#0ecb81',
  },
  warning: {
    bg: 'rgba(240,185,11,0.12)',
    border: 'rgba(240,185,11,0.30)',
    text: '#f0b90b',
  },
  error: {
    bg: 'rgba(246,70,93,0.12)',
    border: 'rgba(246,70,93,0.30)',
    text: '#f6465d',
  },
  info: {
    bg: 'rgba(28,140,255,0.12)',
    border: 'rgba(28,140,255,0.30)',
    text: '#1c8cff',
  },
  neutral: {
    bg: '#2b3139',
    border: '#2b3139',
    text: '#b7bdc6',
  },
};

const ICON_FOR_KIND: Record<PlainStatusKind, typeof Clock> = {
  setting_up: Loader2,
  waiting: Clock,
  ready_release: CheckCircle2,
  ready_refund: ArrowDownLeft,
  disputed: AlertTriangle,
  complete: Check,
  refunded: RotateCcw,
  expired: XCircle,
  unknown: Clock,
};

export default function StatusBadge({ status, size = 'md', withIcon = true, className = '' }: StatusBadgeProps) {
  const { t } = useTranslation();
  const styles = COLOR_STYLES[status.color];
  const Icon = ICON_FOR_KIND[status.kind];

  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const iconSize = size === 'sm' ? 10 : 12;
  // The setting_up state uses Loader2 which only makes sense spinning.
  const iconSpin = status.kind === 'setting_up' ? 'animate-spin' : '';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-medium border whitespace-nowrap ${padding} ${textSize} ${className}`}
      style={{
        background: styles.bg,
        borderColor: styles.border,
        color: styles.text,
      }}
    >
      {withIcon && <Icon size={iconSize} className={`flex-shrink-0 ${iconSpin}`} />}
      <span>{t(status.labelKey)}</span>
    </span>
  );
}
