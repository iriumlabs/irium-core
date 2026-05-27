import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ClipboardPaste } from 'lucide-react';

interface AddressInputProps {
  value: string;
  onChange: (next: string) => void;
  // Localized label rendered above the input.
  label: string;
  placeholder?: string;
  // Inline error string (already localized). Overrides the built-in
  // format-check error.
  error?: string;
  disabled?: boolean;
  id?: string;
  // When false, suppresses the built-in Q/P-prefix format check. Useful
  // if a caller wants to validate at submit time only.
  validateOnBlur?: boolean;
}

// Heuristic check matching irium-wallet single-sig address shape:
//   - 26-35 base58 characters
//   - First character is Q or P (P2PKH version byte 0x39)
// Multisig P-prefix addresses also pass; we accept them since both shapes
// are valid in agreement creation.
function looksLikeAddress(s: string): boolean {
  const t = s.trim();
  if (t.length < 26 || t.length > 35) return false;
  if (!/^[QP]/.test(t)) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(t); // base58 alphabet
}

export default function AddressInput({
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  id,
  validateOnBlur = true,
}: AddressInputProps) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const formatBad = validateOnBlur && touched && trimmed.length > 0 && !looksLikeAddress(trimmed);
  const finalError = error ?? (formatBad ? t('settlement_ui.address.format_error') : undefined);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text.trim());
        setTouched(true);
      }
    } catch {
      // Clipboard read can fail in sandboxed contexts — silently ignore.
    }
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder ?? t('settlement_ui.address.placeholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          className={`input flex-1 font-mono text-sm ${finalError ? 'border-red-500/50' : ''}`}
          aria-invalid={!!finalError}
        />
        <button
          type="button"
          onClick={handlePaste}
          disabled={disabled}
          className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
          aria-label={t('settlement_ui.address.paste')}
          title={t('settlement_ui.address.paste')}
        >
          <ClipboardPaste size={13} />
        </button>
      </div>
      {finalError && (
        <p className="text-xs text-red-400 flex items-center gap-1 mt-0.5">
          <AlertCircle size={11} />{finalError}
        </p>
      )}
    </div>
  );
}
