import { ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

interface WizardShellProps {
  // Total number of steps in the wizard (1-4 per design rule).
  totalSteps: number;
  // Current step, 0-indexed.
  currentStep: number;
  // Called when the user clicks Back. Receives the previous step index
  // when applicable; on the first step, called with -1 so the parent can
  // decide whether to exit the wizard or do something else.
  onBack: (previousStep: number) => void;
  // Optional title shown above the children. Pass as already-localized string.
  title?: string;
  // Optional subtitle / explainer one-line.
  subtitle?: string;
  // Wizard body — usually a card with the step's single question.
  children: ReactNode;
  // Optional extra controls in the top-right (e.g. a Help icon).
  topRight?: ReactNode;
  // When true, ESC pressed on the page triggers a Back click. Defaults to true.
  escClosesStep?: boolean;
  // Max-width of the wizard body. Defaults to '2xl'.
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

const MAX_WIDTH_CLASS: Record<NonNullable<WizardShellProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

// WizardShell — generic 1-4 step wizard frame. Renders the back button,
// progress dots, and an optional title/subtitle, then drops the step
// content underneath. Animation is owned by the children (or AnimatePresence
// in the parent) so step transitions can vary per flow.
export default function WizardShell({
  totalSteps,
  currentStep,
  onBack,
  title,
  subtitle,
  children,
  topRight,
  escClosesStep = true,
  maxWidth = '2xl',
}: WizardShellProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!escClosesStep) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack(currentStep - 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [escClosesStep, currentStep, onBack]);

  const dots = Array.from({ length: Math.min(Math.max(totalSteps, 1), 4) });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full overflow-y-auto p-6 scroll-visible"
    >
      <div className={`${MAX_WIDTH_CLASS[maxWidth]} mx-auto`}>
        {/* Top bar: Back + progress dots + optional right controls */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => onBack(currentStep - 1)}
            className="btn-ghost flex items-center gap-2 text-white/50 hover:text-white cursor-pointer"
            aria-label={t('common.back')}
          >
            <ArrowLeft size={16} />
            <span className="text-sm">{t('common.back')}</span>
          </button>

          <div className="ml-auto flex items-center gap-2">
            {dots.map((_, i) => {
              const isDone = i < currentStep;
              const isActive = i === currentStep;
              return (
                <span key={i} className="flex items-center gap-1.5">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
                      ${
                        isDone
                          ? 'bg-irium-500 text-white'
                          : isActive
                          ? 'bg-irium-500/80 text-white ring-2 ring-irium-400/40'
                          : 'bg-white/10 text-white/25'
                      }`}
                  >
                    {isDone ? <CheckCircle2 size={12} /> : i + 1}
                  </span>
                  {i < dots.length - 1 && (
                    <span className={`w-6 h-0.5 ${i < currentStep ? 'bg-irium-500' : 'bg-white/10'}`} />
                  )}
                </span>
              );
            })}
          </div>

          {topRight && <div className="flex-shrink-0">{topRight}</div>}
        </div>

        {/* Title block */}
        {(title || subtitle) && (
          <div className="mb-5">
            {title && <h2 className="font-display font-bold text-xl text-white">{title}</h2>}
            {subtitle && <p className="text-white/45 text-sm mt-1 leading-relaxed">{subtitle}</p>}
          </div>
        )}

        {children}
      </div>
    </motion.div>
  );
}
