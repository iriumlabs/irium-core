import { ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

interface WizardShellProps {
  // Total number of steps in the wizard (1-4 per design rule).
  totalSteps: number;
  // Current step, 0-indexed.
  currentStep: number;
  // Called when the user clicks Back. On the first step, called with -1
  // so the parent can decide whether to exit the wizard.
  onBack: (previousStep: number) => void;
  // Optional title shown above the children. Pass as already-localized string.
  title?: string;
  // Optional subtitle / explainer one-line.
  subtitle?: string;
  // Wizard body — usually a card with the step's single question.
  children: ReactNode;
  // Optional extra controls in the top-right (e.g. a Help icon).
  topRight?: ReactNode;
  // When true, ESC pressed on the page triggers a Back click.
  escClosesStep?: boolean;
  // Max-width of the wizard body.
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

// WizardShell — Binance-style thin progress stepper. Header strip carries
// the Back button, step indicator ("Step N of M"), and title. The
// stepper itself is a thin segmented bar: completed segments use the
// CTA-yellow accent, the current segment is the same yellow at full
// opacity, future segments are border-only.
//
// Removes the previous numbered-dot stepper + brand-blue accents in
// favour of the neutral palette used across the Marketplace + Settlement
// redesign.
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

  const segments = Math.min(Math.max(totalSteps, 1), 4);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="h-full overflow-y-auto bg-[#0b0e11] text-[#eaecef]"
    >
      <div className={`${MAX_WIDTH_CLASS[maxWidth]} mx-auto px-6 py-5`}>
        {/* Top bar: Back link + step indicator + optional right controls */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => onBack(currentStep - 1)}
            className="inline-flex items-center gap-1.5 h-8 px-2 -ml-2 rounded text-[12px] text-[#b7bdc6] hover:text-[#eaecef] hover:bg-[#181a20] transition-colors"
            aria-label={t('common.back')}
          >
            <ArrowLeft size={14} />
            <span>{t('common.back')}</span>
          </button>

          <div className="ml-auto text-[11px] uppercase tracking-wider text-[#5e6673] font-medium">
            Step {currentStep + 1} of {segments}
          </div>

          {topRight && <div className="flex-shrink-0">{topRight}</div>}
        </div>

        {/* Thin stepper bar — replaces numbered circle dots with a
            Binance-style segmented progress strip. */}
        <div className="flex items-center gap-1 mb-6">
          {Array.from({ length: segments }).map((_, i) => {
            const isDone = i < currentStep;
            const isActive = i === currentStep;
            return (
              <span
                key={i}
                className="flex-1 h-[3px] rounded-sm transition-colors"
                style={{
                  background: isDone || isActive
                    ? '#fcd535'
                    : '#2b3139',
                  opacity: isActive ? 1 : isDone ? 0.55 : 1,
                }}
              />
            );
          })}
        </div>

        {/* Title block */}
        {(title || subtitle) && (
          <div className="mb-5">
            {title && (
              <h2 className="text-[20px] font-semibold tracking-tight text-[#eaecef]">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-[12px] text-[#b7bdc6] mt-1 leading-relaxed">{subtitle}</p>
            )}
          </div>
        )}

        {children}
      </div>
    </motion.div>
  );
}
