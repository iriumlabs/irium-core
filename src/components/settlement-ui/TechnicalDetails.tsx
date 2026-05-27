import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Agreement, AgreementStatusResult } from '../../lib/types';

interface TechnicalDetailsProps {
  // At least one of these should be passed. When both are present, the
  // status fields take precedence (they're authoritative on-chain).
  agreement?: Agreement;
  status?: AgreementStatusResult;
  // Optional extra raw fields to expose. Caller-controlled key/value pairs
  // are rendered after the canonical agreement/status rows.
  extra?: Array<{ label: string; value: string | number | boolean | null | undefined }>;
  // When true, the section starts expanded. Defaults to false so users
  // who don't care stay in the friendly view.
  defaultOpen?: boolean;
}

function rowsFromAgreement(agreement?: Agreement): Array<[string, string]> {
  if (!agreement) return [];
  return [
    ['agreement_id', agreement.id],
    ['agreement_hash', agreement.hash ?? '—'],
    ['template_type', agreement.template ?? '—'],
    ['lifecycle.state', agreement.status],
    ['proof_status', agreement.proof_status ?? '—'],
    ['release_eligible', String(agreement.release_eligible ?? false)],
    ['amount_sats', String(agreement.amount)],
    ['deadline_height', String(agreement.deadline ?? '—')],
    ['created_at', String(agreement.created_at ?? '—')],
  ];
}

function rowsFromStatus(status?: AgreementStatusResult): Array<[string, string]> {
  if (!status) return [];
  const rows: Array<[string, string]> = [
    ['agreement_id', status.agreement_id],
    ['agreement_hash', status.agreement_hash ?? '—'],
    ['lifecycle.state', status.status],
    ['funded', String(status.funded ?? false)],
    ['funding_txid', status.funding_txid ?? '—'],
    ['release_eligible', String(status.release_eligible ?? false)],
    ['refund_eligible', String(status.refund_eligible ?? false)],
    ['proof_status', status.proof_status ?? '—'],
    ['current_height', String(status.current_height ?? '—')],
  ];
  if (status.proof_depth != null) rows.push(['proof_depth', String(status.proof_depth)]);
  if (status.proof_final != null) rows.push(['proof_final', String(status.proof_final)]);
  return rows;
}

// TechnicalDetails — collapsible "raw fields" disclosure. Hidden by
// default so normal users see only friendly status. Power users expand
// to inspect the on-chain field names verbatim. Field names here MAY
// use the original technical terms (agreement_hash, template_type, etc.)
// — that's the whole point of this section.
export default function TechnicalDetails({ agreement, status, extra = [], defaultOpen = false }: TechnicalDetailsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  // Status-derived rows win when both shapes are present (they're authoritative).
  const rows = status ? rowsFromStatus(status) : rowsFromAgreement(agreement);
  const extraRows: Array<[string, string]> = extra.map((e) => [e.label, String(e.value ?? '—')]);
  const allRows = [...rows, ...extraRows];

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success(t('settlement_ui.technical.copied'));
  };

  return (
    <div className="mt-4 rounded-lg border border-white/8 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors rounded-lg"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">
          {t('settlement_ui.technical.title')}
        </span>
        {open ? <ChevronUp size={14} className="text-white/40" /> : <ChevronDown size={14} className="text-white/40" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-1.5 text-[11px] font-mono">
              {allRows.length === 0 ? (
                <p className="text-white/30">{t('settlement_ui.technical.empty')}</p>
              ) : (
                allRows.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3">
                    <span className="text-white/35 flex-shrink-0">{k}</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-white/70 break-all text-right">{v}</span>
                      {v && v !== '—' && (
                        <button
                          onClick={() => handleCopy(v)}
                          className="text-white/30 hover:text-white/70 transition-colors cursor-pointer flex-shrink-0"
                          title={t('common.copy')}
                          aria-label={t('common.copy')}
                        >
                          <Copy size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
