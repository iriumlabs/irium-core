import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { SATS_PER_IRM } from '../../lib/types';

interface AmountInputProps {
  value: string;
  onChange: (next: string) => void;
  // Localized label rendered above the input. Pre-translate at the call site.
  label: string;
  // Optional helper text rendered below the input (in addition to the
  // sats preview). Useful for "Held in escrow until you confirm receipt".
  helper?: string;
  placeholder?: string;
  // Inclusive upper bound in IRM. Defaults to 100,000,000 (total supply).
  maxIrm?: number;
  // Inline error string (already localized). Renders red border + AlertCircle.
  error?: string;
  // Disable input (e.g. while a parent request is in flight).
  disabled?: boolean;
  // Optional id so a parent <label htmlFor> can target this input.
  id?: string;
}

// Default cap matches the chain's total supply (100M IRM). A user mistype
// like "1000000000" gets caught here rather than at the RPC layer.
const DEFAULT_MAX_IRM = 100_000_000;

export default function AmountInput({
  value,
  onChange,
  label,
  helper,
  placeholder,
  maxIrm = DEFAULT_MAX_IRM,
  error,
  disabled,
  id,
}: AmountInputProps) {
  const { t } = useTranslation();
  const parsed = parseFloat(value);
  const showSats = !isNaN(parsed) && parsed > 0;
  const sats = showSats ? Math.round(parsed * SATS_PER_IRM) : 0;
  const overMax = !isNaN(parsed) && parsed > maxIrm;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.0001"
        placeholder={placeholder ?? '0.0000'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`input ${error || overMax ? 'border-red-500/50' : ''}`}
        aria-invalid={!!(error || overMax)}
      />
      {showSats && (
        <p className="text-xs text-white/30 font-mono">
          {sats.toLocaleString('en-US')} sats
        </p>
      )}
      {helper && !error && !overMax && (
        <p className="text-xs text-white/40 leading-relaxed">{helper}</p>
      )}
      {(error || overMax) && (
        <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
          <AlertCircle size={11} />
          {error ?? t('settlement_ui.amount.over_max', { max: maxIrm.toLocaleString('en-US') })}
        </p>
      )}
    </div>
  );
}
