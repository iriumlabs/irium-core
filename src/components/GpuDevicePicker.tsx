import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../lib/store';

// GpuDevicePicker — extracted from Miner.tsx (lines ~1402-1473 in the
// pre-v1.0.63 layout) so both the standalone GPU miner tab AND the
// stratum pool tab can render the same OpenCL platform + device chooser
// without duplicating ~70 lines of JSX. Reads `gpuPlatforms` from the
// Zustand store, which is populated by either tab's Detect-GPUs flow,
// so both tabs see the same enumeration on first detection.
//
// Selection state stays caller-owned — each tab keeps its own
// `selectedPlatformIdx` / `selectedDeviceIdxs` so the user can in
// principle pick different cards per mode if they want (e.g. mine
// solo on platform 0 and pool on platform 1). The default is the
// same auto-discrete-platform pick on either side, so the no-op
// case is "pick once, applies everywhere".
//
// Returns null when no platforms have been detected yet — the caller
// is expected to surface a "Detect GPUs" button + a no-GPU empty
// state separately, since those affordances vary between the two
// tabs (the standalone tab is GPU-only and prominently surfaces the
// installer-help link, while the pool tab silently falls back to
// the CPU miner spawn path when no GPU exists).
interface Props {
  selectedPlatformIdx: number;
  selectedDeviceIdxs: number[];
  onPlatformChange: (idx: number) => void;
  onDevicesChange: (idxs: number[]) => void;
}

export default function GpuDevicePicker({
  selectedPlatformIdx,
  selectedDeviceIdxs,
  onPlatformChange,
  onDevicesChange,
}: Props) {
  const { t } = useTranslation();
  const gpuPlatforms = useStore((s) => s.gpuPlatforms);

  if (!gpuPlatforms || gpuPlatforms.length === 0) return null;

  const selectedPlatform = gpuPlatforms.find((p) => p.index === selectedPlatformIdx);

  const toggleDevice = (idx: number) => {
    if (selectedDeviceIdxs.includes(idx)) {
      onDevicesChange(selectedDeviceIdxs.filter((i) => i !== idx));
    } else {
      onDevicesChange([...selectedDeviceIdxs, idx]);
    }
  };

  return (
    <>
      {/* Platform dropdown */}
      <div>
        <label className="label">{t('miner.fields.opencl_platform')}</label>
        <div className="relative">
          <select
            value={selectedPlatformIdx}
            onChange={(e) => onPlatformChange(parseInt(e.target.value))}
            className="input appearance-none pr-8 cursor-pointer"
          >
            {gpuPlatforms.map((p) => (
              <option key={p.index} value={p.index}>
                {p.index}: {p.name}{p.is_discrete ? ' ★' : ''} ({p.devices.length} device{p.devices.length !== 1 ? 's' : ''})
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--t3)' }} />
        </div>
        {selectedPlatform?.is_discrete && (
          <p className="text-xs mt-1" style={{ color: '#34d399' }}>
            ★ Discrete GPU — auto-selected
          </p>
        )}
      </div>

      {/* Device selection */}
      {selectedPlatform && selectedPlatform.devices.length > 1 ? (
        // Multi-GPU: checkboxes
        <div>
          <label className="label">{t('miner.fields.devices_label')}</label>
          <div className="space-y-2">
            {selectedPlatform.devices.map((d) => {
              const checked = selectedDeviceIdxs.includes(d.index);
              return (
                <label
                  key={d.index}
                  className="flex items-center gap-2.5 cursor-pointer rounded-lg px-3 py-2 transition-colors"
                  style={{
                    background: checked ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${checked ? 'rgba(59,130,246,0.30)' : 'rgba(255,255,255,0.07)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDevice(d.index)}
                    className="w-4 h-4 flex-shrink-0"
                    style={{ accentColor: '#3B82F6' }}
                  />
                  <span className="font-mono text-xs flex-shrink-0" style={{ color: 'var(--t3)' }}>#{d.index}</span>
                  <span className="text-sm" style={{ color: 'var(--t2)' }}>{d.name}</span>
                </label>
              );
            })}
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--t3)' }}>
            {selectedDeviceIdxs.length === 0
              ? 'No devices selected — miner will auto-select'
              : `${selectedDeviceIdxs.length} of ${selectedPlatform.devices.length} device${selectedDeviceIdxs.length > 1 ? 's' : ''} selected`}
          </p>
        </div>
      ) : selectedPlatform?.devices.length === 1 ? (
        // Single device: just show the name
        <div>
          <label className="label">{t('miner.fields.device')}</label>
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span className="font-mono text-xs" style={{ color: 'var(--t3)' }}>#0</span>
            <span className="text-sm" style={{ color: 'var(--t2)' }}>{selectedPlatform.devices[0].name}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
