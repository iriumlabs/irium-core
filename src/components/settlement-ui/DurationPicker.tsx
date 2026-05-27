import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DurationPickerProps {
  // Current value in HOURS. Parent owns the state.
  value: number;
  onChange: (hours: number) => void;
  label: string;
  // Optional helper sentence rendered below the picker
  // (e.g. "If they don't pay within this time, your IRM returns automatically.")
  helper?: string;
  // Inclusive cap in hours. Defaults to 8760 (one year) — matches the cap
  // used by the old Settlement.tsx validateStep0 to prevent users from
  // locking funds for ~114,000 years by mistyping a deadline.
  maxHours?: number;
  // Preset chips (hours, label key). Override to localize differently per
  // flow. Defaults work for most settlement flows.
  presets?: Array<{ hours: number; labelKey: string }>;
  // Disable input.
  disabled?: boolean;
}

const DEFAULT_PRESETS = [
  { hours: 1, labelKey: 'settlement_ui.duration.preset_1h' },
  { hours: 4, labelKey: 'settlement_ui.duration.preset_4h' },
  { hours: 24, labelKey: 'settlement_ui.duration.preset_24h' },
  { hours: 48, labelKey: 'settlement_ui.duration.preset_48h' },
  { hours: 168, labelKey: 'settlement_ui.duration.preset_1w' },
];

const MAX_HOURS_DEFAULT = 8760;

// Render an approximate "expires around" wall-clock hint so users can
// sanity-check their hours choice without doing mental math.
function formatExpiresAround(hours: number, t: (k: string, v?: Record<string, unknown>) => string): string {
  if (!hours || hours <= 0) return '';
  const ms = Date.now() + hours * 3600 * 1000;
  const d = new Date(ms);
  // Locale-aware date formatting keeps the wording consistent with the rest
  // of the app's timeAgo helper without re-translating month/day labels.
  const datestr = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return t('settlement_ui.duration.expires_around', { datetime: datestr });
}

export default function DurationPicker({
  value,
  onChange,
  label,
  helper,
  maxHours = MAX_HOURS_DEFAULT,
  presets = DEFAULT_PRESETS,
  disabled,
}: DurationPickerProps) {
  const { t } = useTranslation();
  const presetMatch = presets.find((p) => p.hours === value);
  const [customMode, setCustomMode] = useState(!presetMatch);
  const [customInput, setCustomInput] = useState(presetMatch ? '' : String(value));

  const handlePreset = (hours: number) => {
    setCustomMode(false);
    setCustomInput('');
    onChange(hours);
  };

  const handleCustomChange = (raw: string) => {
    setCustomInput(raw);
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0 && n <= maxHours) onChange(n);
  };

  return (
    <div className="space-y-2">
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = !customMode && p.hours === value;
          return (
            <button
              key={p.hours}
              type="button"
              onClick={() => handlePreset(p.hours)}
              disabled={disabled}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border cursor-pointer
                ${active ? 'bg-irium-500/20 border-irium-500/50 text-irium-300' : 'bg-white/5 border-white/10 text-white/55 hover:text-white hover:border-white/20'}`}
            >
              {t(p.labelKey)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border cursor-pointer
            ${customMode ? 'bg-irium-500/20 border-irium-500/50 text-irium-300' : 'bg-white/5 border-white/10 text-white/55 hover:text-white hover:border-white/20'}`}
        >
          {t('settlement_ui.duration.custom')}
        </button>
      </div>

      {customMode && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={maxHours}
            placeholder={t('settlement_ui.duration.custom_placeholder')}
            value={customInput}
            onChange={(e) => handleCustomChange(e.target.value)}
            disabled={disabled}
            className="input flex-1 text-sm"
          />
          <span className="text-xs text-white/40 flex-shrink-0">{t('settlement_ui.duration.hours_suffix')}</span>
        </div>
      )}

      {value > 0 && (
        <p className="text-xs text-white/35 leading-relaxed">{formatExpiresAround(value, t)}</p>
      )}
      {helper && <p className="text-xs text-white/40 leading-relaxed">{helper}</p>}
    </div>
  );
}
