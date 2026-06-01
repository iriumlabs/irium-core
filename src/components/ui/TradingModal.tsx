import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// Centered modal used by Create Order, Take Offer, Resolver Picker and
// every other "do one thing then dismiss" surface in the Marketplace and
// Settlement redesign. Replaces the bespoke per-modal styling currently
// scattered across CreateOrderModal / TakeOfferModal / ResolverPicker.
//
// Footer is sticky-bottom by design — primary actions (yellow CTA) and
// cancel (ghost) sit there, matching Binance's modal pattern.

export type ModalSize = 'sm' | 'md' | 'lg';

export interface TradingModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  className?: string;
}

const sizePx: Record<ModalSize, number> = {
  sm: 400,
  md: 480,
  lg: 640,
};

export default function TradingModal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
  className = '',
}: TradingModalProps) {
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
        <motion.div
          key="modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => closeOnBackdrop && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0.36, 1] }}
            className={`relative flex flex-col bg-[#181a20] border border-[#2b3139] rounded-xl shadow-2xl max-h-[90vh] ${className}`}
            style={{ width: '100%', maxWidth: sizePx[size] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <header className="px-6 py-4 border-b border-[#2b3139] flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-[16px] font-semibold leading-tight text-[#eaecef]">
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-1 text-[12px] text-[#b7bdc6]">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-[#b7bdc6] hover:text-[#eaecef] -mr-2 -mt-1 p-1 rounded hover:bg-[#2b3139] transition-colors"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {children}
            </div>
            {footer && (
              <footer className="px-6 py-4 border-t border-[#2b3139] bg-[#181a20] flex items-center justify-end gap-2">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
