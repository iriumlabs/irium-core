import { useEffect, useRef, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

// Trigger zone: only the very top edge of the screen (pixels)
const TRIGGER_PX = 4;
// Bar height when visible — hide once cursor moves below this
const BAR_HEIGHT_PX = 32;

export default function TitleBar() {
  const [visible, setVisible] = useState(false);
  // Ref mirrors state so the mousemove handler (closure) sees the current value
  const visibleRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const y = e.clientY;
      if (y <= TRIGGER_PX) {
        // Cursor touching the very top edge — show
        if (!visibleRef.current) {
          visibleRef.current = true;
          setVisible(true);
        }
      } else if (y >= BAR_HEIGHT_PX) {
        // Cursor has moved below the bar — hide immediately
        if (visibleRef.current) {
          visibleRef.current = false;
          setVisible(false);
        }
      }
      // Between TRIGGER_PX and BAR_HEIGHT_PX: cursor is on the bar, keep current state
    };

    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

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
            onClick={() => appWindow.close()}
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
