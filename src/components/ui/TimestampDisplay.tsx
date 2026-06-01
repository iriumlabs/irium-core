import type { CSSProperties } from 'react';
import { formatLocalDateTime, formatLocalTime } from '../../lib/types';

// Renders a timestamp in the user's local timezone with a browser-native
// `title` tooltip showing the UTC equivalent. Single source of truth so
// every clock-time display in the app — explorer block modal, tx detail,
// agreement deadlines, "updated at" stamps — formats the same way.
//
// Accepts seconds-since-epoch OR milliseconds (auto-detected via
// formatLocalDateTime / formatLocalTime in lib/types.ts).

export type TimestampFormat = 'datetime' | 'time';

export interface TimestampDisplayProps {
  epoch: number | null | undefined;
  format?: TimestampFormat;
  className?: string;
  style?: CSSProperties;
  fallback?: string;
}

export default function TimestampDisplay({
  epoch,
  format = 'datetime',
  className,
  style,
  fallback = '—',
}: TimestampDisplayProps) {
  if (epoch == null || !Number.isFinite(epoch) || epoch <= 0) {
    return <span className={className} style={style}>{fallback}</span>;
  }
  const formatted = format === 'time'
    ? formatLocalTime(epoch)
    : formatLocalDateTime(epoch);
  return (
    <span
      className={className}
      style={style}
      title={formatted.utc}
    >
      {formatted.local}
    </span>
  );
}
