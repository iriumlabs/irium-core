import { useTranslation } from 'react-i18next';
import { Clock, CheckCircle2, ArrowDownLeft, AlertTriangle, Check, RotateCcw, XCircle, Loader2 } from 'lucide-react';
import type { PlainStatus, PlainStatusColor, PlainStatusKind } from './PlainStatus';

interface StatusBadgeProps {
  status: PlainStatus;
  size?: 'sm' | 'md';
  withIcon?: boolean;
  className?: string;
}

// Visual mapping for each status color tier. Uses CSS custom properties
// from globals.css so badges adapt to the active theme.
const COLOR_STYLES: Record<PlainStatusColor, { bg: string; border: string; text: string }> = {
  success: {
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.35)',
    text: '#34d399',
  },
  warning: {
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.35)',
    text: '#fbbf24',
  },
  error: {
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.35)',
    text: '#f87171',
  },
  info: {
    bg: 'rgba(110,198,255,0.12)',
    border: 'rgba(110,198,255,0.30)',
    text: 'var(--brand)',
  },
  neutral: {
    bg: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.15)',
    text: 'rgba(238,240,255,0.65)',
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
      className={`inline-flex items-center gap-1.5 rounded-full font-medium border ${padding} ${textSize} ${className}`}
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
