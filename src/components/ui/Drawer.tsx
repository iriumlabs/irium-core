import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// Right-edge slide-in drawer used for trade details, agreement details,
// and live-trade screens (the SafeTradeFlow step 3 contents are hosted
// here so the Marketplace "My Trades" row click and the Settlement
// agreement table row click produce the same surface).
//
// Three width tiers map to the most common layouts in the redesign:
//   sm = 380  → quick info / single action
//   md = 480  → standard agreement detail
//   lg = 640  → live-trade screen with embedded progress + verify

export type DrawerWidth = 'sm' | 'md' | 'lg';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  width?: DrawerWidth;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const widthPx: Record<DrawerWidth, number> = {
  sm: 380,
  md: 480,
  lg: 640,
};

export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  children,
  footer,
  className = '',
}: DrawerProps) {
  // ESC to close. Body scroll lock while open so a drawer over a
  // scrollable list doesn't double-scroll the page underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/55"
            onClick={onClose}
          />
          <motion.aside
            key="drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0.36, 1] }}
            className={`fixed top-0 bottom-0 right-0 z-50 flex flex-col bg-[#181a20] border-l border-[#2b3139] shadow-2xl ${className}`}
            style={{ width: widthPx[width], maxWidth: '100vw' }}
            aria-modal="true"
            role="dialog"
          >
            {(title || subtitle) && (
              <header className="px-5 py-4 border-b border-[#2b3139] flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {title && (
                    <h2 className="text-[16px] font-semibold leading-tight text-[#eaecef] truncate">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="mt-1 text-[12px] text-[#b7bdc6]">{subtitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="text-[#b7bdc6] hover:text-[#eaecef] -mr-1 -mt-1 p-1 rounded hover:bg-[#2b3139] transition-colors"
                >
                  <X size={18} />
                </button>
              </header>
            )}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {children}
            </div>
            {footer && (
              <footer className="px-5 py-3 border-t border-[#2b3139] bg-[#181a20]">
                {footer}
              </footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
