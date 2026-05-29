import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appWindow } from '@tauri-apps/api/window';
import { Minus, Pin, PinOff, Square, X } from 'lucide-react';
import { useStore } from '../../lib/store';

// Trigger zone: only the very top edge of the screen (pixels)
const TRIGGER_PX = 4;
// Bar height when visible — hide once cursor moves below this
const BAR_HEIGHT_PX = 32;
// localStorage key for the pin preference. Survives app restarts so a
// user who pinned the bar once doesn't have to re-pin on every launch.
const PINNED_STORAGE_KEY = 'irium-titlebar-pinned';

export default function TitleBar() {
  const { t } = useTranslation();
  // Pinned state: when true, the title bar stays visible always. When
  // false (default — matches the original auto-hide behaviour), the bar
  // hides until the cursor enters the top TRIGGER_PX of the window.
  // Lazy initialiser reads localStorage once on mount. Wrapped in
  // try/catch because Tauri's webview sometimes throws on storage access
  // before the bridge is fully wired; falling back to unpinned is the
  // least surprising default.
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PINNED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [hoverVisible, setHoverVisible] = useState(false);
  // Ref mirrors hoverVisible so the mousemove handler (closure) sees the
  // current value without re-binding the listener on every state change.
  const hoverVisibleRef = useRef(false);
  // Subscribe to local miner state so the close button can warn the user
  // before the window minimizes-to-tray while the miner is still active.
  const minerRunning = useStore((s) => s.minerStatus?.running ?? false);

  // The bar is visible whenever it's pinned OR the user is hovering at
  // the top of the window. Derived rather than stored so toggling pin
  // never lands in an inconsistent state.
  const visible = pinned || hoverVisible;

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable — pin still works in-session, just won't
      // persist across restarts. Silent because there's nothing the
      // user can act on.
    }
  };

  const handleClose = () => {
    if (minerRunning) {
      const ok = window.confirm(t('titlebar.miner_active_confirm'));
      if (!ok) return;
    }
    appWindow.close();
  };

  useEffect(() => {
    // When pinned, skip the mousemove listener entirely. The bar stays
    // visible via the derived `visible` value, so there's no work for
    // the cursor tracker to do and no reason to consume cycles on every
    // mouse event.
    if (pinned) return;

    const onMove = (e: MouseEvent) => {
      const y = e.clientY;
      if (y <= TRIGGER_PX) {
        // Cursor touching the very top edge — show
        if (!hoverVisibleRef.current) {
          hoverVisibleRef.current = true;
          setHoverVisible(true);
        }
      } else if (y >= BAR_HEIGHT_PX) {
        // Cursor has moved below the bar — hide immediately
        if (hoverVisibleRef.current) {
          hoverVisibleRef.current = false;
          setHoverVisible(false);
        }
      }
      // Between TRIGGER_PX and BAR_HEIGHT_PX: cursor is on the bar, keep current state
    };

    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [pinned]);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[200] flex items-center overflow-hidden"
      style={{
        height: visible ? BAR_HEIGHT_PX : 0,
        background: 'rgba(2, 5, 14, 0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(110,198,255,0.18)',
        transition: 'height 0.12s ease',
      }}
      data-tauri-drag-region
    >
      <div className="flex items-center h-full px-3 w-full" data-tauri-drag-region>
        {/* Irium branding */}
        <div className="flex items-center gap-2 flex-1 select-none" data-tauri-drag-region>
          <img
            src="/Irium-Logo.png"
            alt="Irium"
            height={16}
            style={{ width: 'auto', height: 16, opacity: 0.85 }}
            draggable={false}
          />
          <span
            className="text-xs font-display font-bold"
            style={{
              background: 'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '0.10em',
            }}
          >
            IRIUM CORE
          </span>
        </div>

        {/* Window controls */}
        <div className="flex items-center">
          {/* Pin / unpin toggle. When pinned the bar stays visible always;
              when unpinned it auto-hides and is revealed by hovering the
              top edge of the window. Sits to the left of the standard
              minimize/maximize/close window controls so it's discoverable
              without crowding them. Icon swaps Pin (filled, accent) ↔
              PinOff (muted) to reflect state at a glance. */}
          <button
            onClick={togglePin}
            className="w-8 h-8 flex items-center justify-center rounded transition-colors duration-100"
            title={pinned ? t('titlebar.unpin_tooltip') : t('titlebar.pin_tooltip')}
            aria-label={pinned ? t('titlebar.unpin_tooltip') : t('titlebar.pin_tooltip')}
            aria-pressed={pinned}
            style={{ color: pinned ? '#6ec6ff' : 'rgba(238,240,255,0.40)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {pinned ? <Pin size={11} fill="currentColor" /> : <PinOff size={11} />}
          </button>
          <button
            onClick={() => appWindow.minimize()}
            className="w-8 h-8 flex items-center justify-center rounded transition-colors duration-100"
            style={{ color: 'rgba(238,240,255,0.40)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Minus size={11} />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="w-8 h-8 flex items-center justify-center rounded transition-colors duration-100"
            style={{ color: 'rgba(238,240,255,0.40)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Square size={10} />
          </button>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded transition-colors duration-100"
            style={{ color: 'rgba(238,240,255,0.40)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.70)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(238,240,255,0.40)'; }}
          >
            <X size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
