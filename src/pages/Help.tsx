import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { open as shellOpen } from '@tauri-apps/api/shell';
import {
  ShieldCheck, ShoppingBag, FileText, Star, Info,
  Github, Globe, Pickaxe, ChevronDown, ExternalLink,
  Server, HelpCircle, Bug, Check, AlertTriangle, RefreshCw, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { node } from '../lib/tauri';
import { useStore } from '../lib/store';

// ── Spec table data ───────────────────────────────────────────────────────────
// Static shape kept here — labels/values resolved through i18n in AboutSection
// using the help.specs_labels / help.specs_values namespaces.
const SPEC_KEYS: { labelKey: string; valueKey: string }[] = [
  { labelKey: 'help.specs_labels.network',         valueKey: 'help.specs_values.network' },
  { labelKey: 'help.specs_labels.coin',            valueKey: 'help.specs_values.coin' },
  { labelKey: 'help.specs_labels.max_supply',      valueKey: 'help.specs_values.max_supply' },
  { labelKey: 'help.specs_labels.block_time',      valueKey: 'help.specs_values.block_time' },
  { labelKey: 'help.specs_labels.block_reward',    valueKey: 'help.specs_values.block_reward' },
  { labelKey: 'help.specs_labels.consensus',       valueKey: 'help.specs_values.consensus' },
  { labelKey: 'help.specs_labels.difficulty',      valueKey: 'help.specs_values.difficulty' },
  { labelKey: 'help.specs_labels.address_prefix',  valueKey: 'help.specs_values.address_prefix' },
  { labelKey: 'help.specs_labels.key_derivation',  valueKey: 'help.specs_values.key_derivation' },
  { labelKey: 'help.specs_labels.rpc_port',        valueKey: 'help.specs_values.rpc_port' },
  { labelKey: 'help.specs_labels.p2p_port',        valueKey: 'help.specs_values.p2p_port' },
  { labelKey: 'help.specs_labels.bootstrap',       valueKey: 'help.specs_values.bootstrap' },
  { labelKey: 'help.specs_labels.auxpow',          valueKey: 'help.specs_values.auxpow' },
];

const LINKS: { labelKey: string; url: string; icon: React.ElementType }[] = [
  { labelKey: 'help.links.github',       url: 'https://github.com/iriumlabs/irium',                                    icon: Github  },
  { labelKey: 'help.links.website',      url: 'https://iriumlabs.org',                                                  icon: Globe   },
  { labelKey: 'help.links.whitepaper',   url: 'https://github.com/iriumlabs/irium/blob/main/docs/WHITEPAPER.md',        icon: FileText },
  { labelKey: 'help.links.mining_guide', url: 'https://github.com/iriumlabs/irium/blob/main/MINING.md',                icon: Pickaxe },
];

// FAQ entries — each has a Q key and A key in help.faqs. Numbered q1..q11.
const FAQ_KEYS: { qKey: string; aKey: string }[] = Array.from({ length: 11 }, (_, i) => ({
  qKey: `help.faqs.q${i + 1}`,
  aKey: `help.faqs.a${i + 1}`,
}));

// ── Shared helpers ────────────────────────────────────────────────────────────
function openUrl(url: string) {
  shellOpen(url).catch(() => {});
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-display font-bold text-base text-white mt-6 mb-2 first:mt-0">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/60 leading-relaxed mb-3">{children}</p>;
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2 mb-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm text-white/60">
          <span
            className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-display text-white"
            style={{ background: 'linear-gradient(135deg, #6ec6ff 0%, #a78bfa 100%)' }}
          >
            {i + 1}
          </span>
          <span className="leading-relaxed pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm text-white/70 leading-relaxed mb-3"
      style={{ background: 'rgba(110,198,255,0.07)', border: '1px solid rgba(110,198,255,0.15)' }}
    >
      {children}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/[0.07] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="font-display font-medium text-sm text-white/80">{q}</span>
        <ChevronDown
          size={15}
          className="flex-shrink-0 text-white/40 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-4 text-sm text-white/55 leading-relaxed"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="pt-3">{a}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Quarantined Blocks Recovery ───────────────────────────────────────────────
// Surfaces iriumd's `orphaned_*` quarantine state to the user. Reads counts
// via scan_quarantined_blocks on mount, lets the user re-scan or clear (when
// the node is stopped). Deletion fans out to clear_quarantined_blocks which
// only touches paths under <data_dir>/blocks/orphaned_*/ — see main.rs.
function QuarantineRecovery() {
  const { t } = useTranslation();
  const nodeStatus = useStore((s) => s.nodeStatus);
  const nodeRunning = nodeStatus?.running ?? false;
  const [counts, setCounts] = useState<{ files: number; dirs: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await node.scanQuarantinedBlocks();
      setCounts(result ?? { files: 0, dirs: 0 });
    } catch (e) {
      setScanError(String(e));
      setCounts(null);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const handleClear = async () => {
    setClearing(true);
    try {
      const result = await node.clearQuarantinedBlocks();
      if (result) {
        toast.success(t('help.quarantine.toast_cleared', { files: result.deleted_files }));
        if (result.errors.length > 0) {
          // Surface non-fatal per-dir errors as a single warning toast so
          // the user knows some dirs were not removed.
          toast.error(t('help.quarantine.toast_clear_failed', { reason: result.errors[0] }));
        }
      }
      await scan();
    } catch (e) {
      toast.error(t('help.quarantine.toast_clear_failed', { reason: String(e) }));
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  const hasQuarantined = !!counts && counts.files > 0;
  const status = !counts
    ? null
    : counts.files === 0
      ? t('help.quarantine.status_none')
      : counts.files === 1
        ? t('help.quarantine.status_count_one', { files: counts.files, dirs: counts.dirs })
        : t('help.quarantine.status_count_other', { files: counts.files, dirs: counts.dirs });

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
        <h2 className="font-display font-semibold text-white/90 text-base">{t('help.quarantine.section_title')}</h2>
      </div>
      <p className="text-sm text-white/50 leading-relaxed mb-4">
        {t('help.quarantine.description')}
      </p>

      <div className="rounded-lg bg-white/[0.025] border border-white/[0.06] p-3 mb-4">
        {scanning ? (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <RefreshCw size={12} className="animate-spin" />
            {t('help.quarantine.scanning')}
          </div>
        ) : scanError ? (
          <div className="text-xs text-red-400">{scanError}</div>
        ) : (
          <div className={`text-sm ${hasQuarantined ? 'text-amber-300' : 'text-white/55'}`}>{status}</div>
        )}
      </div>

      {nodeRunning && hasQuarantined && (
        <p className="text-xs text-amber-400/80 mb-3">
          {t('help.quarantine.node_running_warning')}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={scan}
          disabled={scanning}
          className="btn-secondary gap-2 text-xs"
        >
          <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
          {t('help.quarantine.scan_button')}
        </button>

        {hasQuarantined && (
          confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/55">
                {t('help.quarantine.confirm_body', { files: counts?.files, dirs: counts?.dirs })}
              </span>
              <button
                onClick={() => setConfirming(false)}
                className="btn-secondary text-xs gap-1"
                disabled={clearing}
              >
                {t('help.quarantine.confirm_no')}
              </button>
              <button
                onClick={handleClear}
                disabled={clearing || nodeRunning}
                className="text-xs gap-1 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
              >
                {clearing ? <Loader2InlineSpinner /> : <Trash2 size={12} />}
                {clearing ? t('help.quarantine.clearing') : t('help.quarantine.confirm_yes')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={nodeRunning || clearing}
              className="gap-2 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <Trash2 size={12} />
              {t('help.quarantine.clear_button')}
            </button>
          )
        )}
      </div>
    </div>
  );
}

// Tiny inline spinner used inside the destructive confirm button so we don't
// have to widen the lucide-react import surface for one more icon.
function Loader2InlineSpinner() {
  return <RefreshCw size={12} className="animate-spin" />;
}

// ── Section content ───────────────────────────────────────────────────────────
function AboutSection() {
  const { t } = useTranslation();
  const appVersion = useStore((s) => s.appVersion);
  const nodeStatus = useStore((s) => s.nodeStatus);
  const settings   = useStore((s) => s.settings);
  const dataDir    = settings.data_dir ?? '~/.irium/';
  const rpcUrl     = settings.rpc_url  ?? 'http://127.0.0.1:38300';
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <div id="about" className="scroll-mt-6 space-y-6">
      {/* App header */}
      <div className="panel-elevated p-6 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 50% at 20% 50%, rgba(110,198,255,0.12) 0%, transparent 70%)' }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-5">
            <img
              src="/logo.png"
              alt="Irium"
              style={{ width: 56, height: 56, borderRadius: '50%', boxShadow: '0 0 24px rgba(110,198,255,0.5)' }}
            />
            <div>
              <div className="font-display font-bold text-2xl gradient-text">Irium Core</div>
              <div className="font-mono text-xs text-white/35 mt-0.5">v{appVersion}</div>
            </div>
          </div>
          <p className="text-sm text-white/55 leading-relaxed mb-6">
            {t('help.about_app.intro')}
          </p>
          <div className="rounded-xl overflow-hidden border border-white/[0.07] mb-6">
            {SPEC_KEYS.map(({ labelKey, valueKey }, i) => (
              <div
                key={labelKey}
                className="flex items-start gap-4 px-4 py-2.5 text-sm"
                style={{
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                  borderBottom: i < SPEC_KEYS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                }}
              >
                <span className="text-white/35 w-48 flex-shrink-0 font-display text-xs">{t(labelKey)}</span>
                <span className="font-mono text-xs text-white/75 break-all">{t(valueKey)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {LINKS.map(({ labelKey, url, icon: Icon }) => (
              <button
                key={labelKey}
                onClick={() => openUrl(url)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-display font-medium text-white/60 hover:text-white border border-white/10 hover:border-irium-500/40 hover:bg-irium-500/10 transition-all duration-150"
              >
                <Icon size={13} />
                {t(labelKey)}
                <ExternalLink size={10} className="text-white/25" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Node information */}
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Server size={16} className="text-irium-400 flex-shrink-0" />
          <h2 className="font-display font-semibold text-white/90 text-base">{t('help.sections.node_information')}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { label: t('help.node_info_labels.iriumd_version'),  value: nodeStatus?.version ?? appVersion },
            { label: t('help.node_info_labels.data_directory'),  value: dataDir },
            { label: t('help.node_info_labels.rpc_endpoint'),    value: rpcUrl },
            { label: t('help.node_info_labels.block_height'),    value: nodeStatus?.running ? `#${(nodeStatus.height ?? 0).toLocaleString('en-US')}` : '—' },
            { label: t('help.node_info_labels.sync_status'),     value: nodeStatus?.running ? (nodeStatus.synced ? t('help.node_info_labels.fully_synced') : t('help.node_info_labels.syncing')) : t('help.node_info_labels.offline') },
            { label: t('help.node_info_labels.connected_peers'), value: nodeStatus?.running ? String(nodeStatus.peers ?? 0) : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5 p-3 rounded-lg bg-white/[0.025] border border-white/[0.06]">
              <span className="text-[10px] text-white/35 font-display uppercase tracking-wider">{label}</span>
              <span className="font-mono text-sm text-white/75 break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Privacy */}
      <div
        className="p-5 rounded-[10px] relative overflow-hidden"
        style={{
          background: 'var(--bg-elev-1)',
          border: '1px solid rgba(52,211,153,0.30)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.40), 0 0 22px rgba(52,211,153,0.06)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 100% at 0% 0%, rgba(52,211,153,0.10) 0%, transparent 65%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5 mb-4">
            <ShieldCheck size={16} style={{ color: '#34d399' }} className="flex-shrink-0" />
            <h2 className="font-display font-semibold text-white/90 text-base">{t('help.sections.privacy_data')}</h2>
          </div>
          <p className="font-display font-bold text-base mb-1.5" style={{ color: '#34d399' }}>
            {t('help.privacy.title')}
          </p>
          <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgba(238,240,255,0.65)' }}>
            {t('help.privacy.intro')}
          </p>
          <ul className="space-y-2.5">
            {[
              t('help.privacy.bullet_1'),
              t('help.privacy.bullet_2'),
              t('help.privacy.bullet_3'),
              t('help.privacy.bullet_4'),
              t('help.privacy.bullet_5'),
              t('help.privacy.bullet_6'),
            ].map((point, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5"
                  style={{ background: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.40)' }}
                >
                  <Check size={9} strokeWidth={3} style={{ color: '#34d399' }} />
                </span>
                <span className="text-sm leading-relaxed" style={{ color: 'rgba(238,240,255,0.75)' }}>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* FAQ */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <HelpCircle size={16} className="text-irium-400 flex-shrink-0" />
          <h2 className="font-display font-semibold text-white/90 text-base">{t('help.sections.faq')}</h2>
        </div>
        <div className="space-y-2">
          {FAQ_KEYS.map(({ qKey, aKey }) => (
            <FaqItem key={qKey} q={t(qKey)} a={t(aKey)} />
          ))}
        </div>
      </div>

      {/* Quarantined blocks recovery — surfaced above the report-issue card
          so users notice it when troubleshooting. The component fetches
          counts itself; AboutSection just mounts it. */}
      <QuarantineRecovery />

      {/* Report an issue */}
      <div className="card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Bug size={16} className="text-irium-400 flex-shrink-0" />
          <h2 className="font-display font-semibold text-white/90 text-base">{t('help.sections.report_issue')}</h2>
        </div>
        <p className="text-sm text-white/50 leading-relaxed mb-4">
          {t('help.report_issue.body')}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => openUrl('https://github.com/iriumlabs/irium-core/issues/new')}
            className="btn-primary gap-2"
          >
            <Bug size={14} /> {t('help.report_issue.open_issue')}
          </button>
          <button
            onClick={() => openUrl('https://github.com/iriumlabs/irium-core/issues')}
            className="btn-secondary gap-2"
          >
            <ExternalLink size={14} /> {t('help.report_issue.view_existing')}
          </button>
        </div>
      </div>

      {/* Licenses */}
      <div className="card p-4">
        <button
          onClick={() => setLicensesOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-sm text-white/40">{t('help.licenses.title')}</span>
          <ChevronDown
            size={14}
            className="text-white/30 transition-transform duration-200"
            style={{ transform: licensesOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        <AnimatePresence initial={false}>
          {licensesOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="pt-3 space-y-2">
                <p className="text-xs text-white/35 leading-relaxed">
                  {t('help.licenses.body')}
                </p>
                <button
                  onClick={() => openUrl('https://github.com/iriumlabs/irium-core/blob/main/LICENSE')}
                  className="flex items-center gap-1.5 text-xs text-irium-400 hover:text-irium-300 transition-colors"
                >
                  <ExternalLink size={11} /> {t('help.licenses.view')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SettlementSection() {
  const { t } = useTranslation();
  return (
    <div id="settlement" className="scroll-mt-6">
      <Heading>{t('help.settlement_help.what_title')}</Heading>
      <P>{t('help.settlement_help.what_body')}</P>

      <Heading>{t('help.settlement_help.templates_title')}</Heading>
      <P>{t('help.settlement_help.templates_intro')}</P>
      <ul className="space-y-1.5 mb-3 text-sm text-white/60">
        <li><span className="text-white/90 font-medium">{t('help.settlement_help.template_otc')}</span> — {t('help.settlement_help.template_otc_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.settlement_help.template_freelance')}</span> — {t('help.settlement_help.template_freelance_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.settlement_help.template_milestones')}</span> — {t('help.settlement_help.template_milestones_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.settlement_help.template_timelock')}</span> — {t('help.settlement_help.template_timelock_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.settlement_help.template_merchant')}</span> — {t('help.settlement_help.template_merchant_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.settlement_help.template_contractor')}</span> — {t('help.settlement_help.template_contractor_desc')}</li>
      </ul>

      <Heading>{t('help.settlement_help.creating_title')}</Heading>
      <Steps items={[
        t('help.settlement_help.creating_step_1'),
        t('help.settlement_help.creating_step_2'),
        t('help.settlement_help.creating_step_3'),
        t('help.settlement_help.creating_step_4'),
        t('help.settlement_help.creating_step_5'),
        t('help.settlement_help.creating_step_6'),
      ]} />

      <Heading>{t('help.settlement_help.funding_title')}</Heading>
      <Steps items={[
        t('help.settlement_help.funding_step_1'),
        t('help.settlement_help.funding_step_2'),
        t('help.settlement_help.funding_step_3'),
        t('help.settlement_help.funding_step_4'),
        t('help.settlement_help.funding_step_5'),
      ]} />

      <Heading>{t('help.settlement_help.proofs_title')}</Heading>
      <P>{t('help.settlement_help.proofs_body')}</P>

      <Heading>{t('help.settlement_help.disputes_title')}</Heading>
      <P>{t('help.settlement_help.disputes_body')}</P>

      <Callout>
        <strong className="text-white">{t('help.common_mistake')}</strong> {t('help.settlement_help.callout')}
      </Callout>
    </div>
  );
}

function MarketplaceSection() {
  const { t } = useTranslation();
  return (
    <div id="marketplace" className="scroll-mt-6">
      <Heading>{t('help.marketplace_help.what_title')}</Heading>
      <P>{t('help.marketplace_help.what_body')}</P>

      <Heading>{t('help.marketplace_help.posting_title')}</Heading>
      <Steps items={[
        t('help.marketplace_help.posting_step_1'),
        t('help.marketplace_help.posting_step_2'),
        t('help.marketplace_help.posting_step_3'),
        t('help.marketplace_help.posting_step_4'),
      ]} />

      <Heading>{t('help.marketplace_help.responding_title')}</Heading>
      <Steps items={[
        t('help.marketplace_help.responding_step_1'),
        t('help.marketplace_help.responding_step_2'),
        t('help.marketplace_help.responding_step_3'),
        t('help.marketplace_help.responding_step_4'),
      ]} />

      <Heading>{t('help.marketplace_help.feeds_title')}</Heading>
      <P>{t('help.marketplace_help.feeds_body')}</P>

      <Callout>
        <strong className="text-white">{t('help.marketplace_help.callout_label')}</strong> {t('help.marketplace_help.callout')}
      </Callout>
    </div>
  );
}

function AgreementsSection() {
  const { t } = useTranslation();
  return (
    <div id="agreements" className="scroll-mt-6">
      <Heading>{t('help.agreements_help.what_title')}</Heading>
      <P>{t('help.agreements_help.what_body')}</P>

      <Heading>{t('help.agreements_help.lifecycle_title')}</Heading>
      <Steps items={[
        t('help.agreements_help.lifecycle_step_1'),
        t('help.agreements_help.lifecycle_step_2'),
        t('help.agreements_help.lifecycle_step_3'),
        t('help.agreements_help.lifecycle_step_4'),
        t('help.agreements_help.lifecycle_step_5'),
        t('help.agreements_help.lifecycle_step_6'),
      ]} />

      <Heading>{t('help.agreements_help.submit_title')}</Heading>
      <Steps items={[
        t('help.agreements_help.submit_step_1'),
        t('help.agreements_help.submit_step_2'),
        t('help.agreements_help.submit_step_3'),
        t('help.agreements_help.submit_step_4'),
      ]} />

      <Heading>{t('help.agreements_help.importing_title')}</Heading>
      <P>{t('help.agreements_help.importing_body')}</P>

      <Callout>
        <strong className="text-white">{t('help.agreements_help.callout_label')}</strong> {t('help.agreements_help.callout')}
      </Callout>
    </div>
  );
}

function ReputationSection() {
  const { t } = useTranslation();
  return (
    <div id="reputation" className="scroll-mt-6">
      <Heading>{t('help.reputation_help.what_title')}</Heading>
      <P>{t('help.reputation_help.what_body')}</P>

      <Heading>{t('help.reputation_help.query_title')}</Heading>
      <Steps items={[
        t('help.reputation_help.query_step_1'),
        t('help.reputation_help.query_step_2'),
        t('help.reputation_help.query_step_3'),
      ]} />

      <Heading>{t('help.reputation_help.understanding_title')}</Heading>
      <ul className="space-y-1.5 mb-3 text-sm text-white/60">
        <li><span className="text-white/90 font-medium">{t('help.reputation_help.tier_high')}</span> — {t('help.reputation_help.tier_high_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.reputation_help.tier_mid')}</span> — {t('help.reputation_help.tier_mid_desc')}</li>
        <li><span className="text-white/90 font-medium">{t('help.reputation_help.tier_low')}</span> — {t('help.reputation_help.tier_low_desc')}</li>
      </ul>

      <Heading>{t('help.reputation_help.building_title')}</Heading>
      <P>{t('help.reputation_help.building_body')}</P>

      <Callout>
        <strong className="text-white">{t('help.reputation_help.callout_label')}</strong> {t('help.reputation_help.callout')}
      </Callout>
    </div>
  );
}

// ── Nav sections ──────────────────────────────────────────────────────────────
// Section labels live in help.section_labels.<id> — resolved through t() in
// the navigation render so the visible text translates with the active locale.
interface SectionMeta { id: string; labelKey: string; Icon: React.ElementType }
const SECTIONS: SectionMeta[] = [
  { id: 'about',       labelKey: 'help.section_labels.about',       Icon: Info        },
  { id: 'settlement',  labelKey: 'help.section_labels.settlement',  Icon: ShieldCheck },
  { id: 'marketplace', labelKey: 'help.section_labels.marketplace', Icon: ShoppingBag },
  { id: 'agreements',  labelKey: 'help.section_labels.agreements',  Icon: FileText    },
  { id: 'reputation',  labelKey: 'help.section_labels.reputation',  Icon: Star        },
];

const SECTION_CONTENT: Record<string, React.ReactNode> = {
  about:       <AboutSection />,
  settlement:  <SettlementSection />,
  marketplace: <MarketplaceSection />,
  agreements:  <AgreementsSection />,
  reputation:  <ReputationSection />,
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Help() {
  const { t } = useTranslation();
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (!hash) return;
    const el = contentRef.current?.querySelector(`#${hash}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Fixed left nav */}
      <nav
        className="flex-shrink-0 w-44 flex flex-col gap-1 py-6 pl-6 pr-3 border-r overflow-y-auto"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="text-[10px] font-display font-bold text-white/30 uppercase tracking-widest mb-2 px-2">
          {t('help.topics_label')}
        </div>
        {SECTIONS.map(({ id, labelKey, Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault();
              const el = contentRef.current?.querySelector(`#${id}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              window.history.replaceState(null, '', `/help#${id}`);
            }}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-white/45 hover:text-white/90 hover:bg-white/5 transition-colors font-display font-medium"
          >
            <Icon size={14} className="flex-shrink-0" />
            {t(labelKey)}
          </a>
        ))}
      </nav>

      {/* Scrollable content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-12">
        <div>
          <h1 className="page-title">{t('help.page_title')}</h1>
          <p className="page-subtitle">{t('help.subtitle')}</p>
        </div>

        {/* About renders directly (no card wrapper — it has its own sub-cards) */}
        <div key="about">
          {SECTION_CONTENT['about']}
        </div>

        {/* Other sections get the standard card wrapper */}
        {SECTIONS.slice(1).map(({ id }) => (
          <div key={id} className="card p-6">
            {SECTION_CONTENT[id]}
          </div>
        ))}
      </div>
    </div>
  );
}
