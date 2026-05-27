import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, AlertCircle, CheckCircle2, ClipboardPaste } from 'lucide-react';
import { writeTextFile, readTextFile, createDir } from '@tauri-apps/api/fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import toast from 'react-hot-toast';
import { agreements } from '../../lib/tauri';
import { mapErrorToKey, rawErrorMessage } from './ErrorMapper';

// DealCode — the seller-to-buyer agreement handoff component.
//
// Two modes share one file because they're inverses of each other:
//   display: seller mounts with an agreement_id. We pack the agreement
//            via the backend, base64-encode the result, and show it as a
//            copyable code the seller pastes into Signal/email/etc.
//   input:   buyer pastes the code. We base64-decode, write to disk, and
//            call agreement.unpack() to import + verify.
//
// All fs operations land under $APPDATA/dealcodes/ because that's the
// only writable scope per src-tauri/tauri.conf.json's fs allowlist.

interface BaseProps {
  onSuccess?: (agreementId: string) => void;
  onError?: (err: unknown) => void;
}

interface DisplayProps extends BaseProps {
  mode: 'display';
  agreementId: string;
}

interface InputProps extends BaseProps {
  mode: 'input';
}

type DealCodeProps = DisplayProps | InputProps;

async function packAgreementToCode(agreementId: string): Promise<string> {
  const baseDir = await appDataDir();
  const dirPath = await join(baseDir, 'dealcodes');
  await createDir(dirPath, { recursive: true }).catch(() => {});
  const filePath = await join(dirPath, `${agreementId}.pack.json`);
  await agreements.pack(agreementId, filePath);
  const json = await readTextFile(filePath);
  // btoa is fine for pack JSON which is ASCII-only. If we ever start
  // packing UTF-8 strings in user-supplied fields, switch to a
  // TextEncoder + Uint8Array → base64 pipeline.
  return btoa(json);
}

async function importCodeToAgreement(code: string): Promise<string> {
  const trimmed = code.trim();
  let json: string;
  try {
    json = atob(trimmed);
    if (!json.trimStart().startsWith('{')) throw new Error('decoded payload is not JSON');
  } catch {
    // Fallback: maybe the user pasted raw pack JSON instead of base64.
    if (trimmed.startsWith('{')) {
      json = trimmed;
    } else {
      throw new Error('Invalid deal code format');
    }
  }
  const baseDir = await appDataDir();
  const dirPath = await join(baseDir, 'dealcodes', 'inbox');
  await createDir(dirPath, { recursive: true }).catch(() => {});
  const filePath = await join(dirPath, `imported-${Date.now()}.pack.json`);
  await writeTextFile(filePath, json);
  const result = await agreements.unpack(filePath);
  return result.id;
}

export default function DealCode(props: DealCodeProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [fallbackId, setFallbackId] = useState<string | null>(null);
  const [importedId, setImportedId] = useState<string | null>(null);

  useEffect(() => {
    if (props.mode !== 'display') return;
    let cancelled = false;
    setBusy(true);
    setErrMsg(null);
    setFallbackId(null);
    packAgreementToCode(props.agreementId)
      .then((encoded) => {
        if (cancelled) return;
        setCode(encoded);
        props.onSuccess?.(props.agreementId);
      })
      .catch((e) => {
        if (cancelled) return;
        setErrMsg(t(mapErrorToKey(e, 'pack')));
        setFallbackId(props.agreementId);
        props.onError?.(e);
        // Log raw for power-user debugging via TechnicalDetails.
        console.error('[DealCode] pack failed:', rawErrorMessage(e));
      })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode === 'display' ? props.agreementId : null]);

  const handleCopy = () => {
    const payload = code || fallbackId || '';
    if (!payload) return;
    navigator.clipboard.writeText(payload);
    toast.success(t('settlement_ui.deal_code.copied'));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setCode(text.trim());
    } catch {
      // Clipboard read can fail in sandboxed contexts — silently ignore.
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    setErrMsg(null);
    try {
      const id = await importCodeToAgreement(code);
      setImportedId(id);
      toast.success(t('settlement_ui.deal_code.import_success'));
      (props as InputProps).onSuccess?.(id);
    } catch (e) {
      setErrMsg(t(mapErrorToKey(e, 'unpack')));
      (props as InputProps).onError?.(e);
      console.error('[DealCode] unpack failed:', rawErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (props.mode === 'display') {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
          {busy && (
            <div className="flex items-center gap-2 py-4 justify-center text-white/40 text-xs">
              <Loader2 size={13} className="animate-spin" />
              {t('settlement_ui.deal_code.building')}
            </div>
          )}
          {!busy && code && (
            <textarea
              readOnly
              value={code}
              rows={6}
              className="w-full bg-transparent text-[11px] font-mono text-white/75 resize-none outline-none break-all"
              aria-label={t('settlement_ui.deal_code.code_label')}
            />
          )}
          {!busy && !code && fallbackId && (
            <div className="space-y-1">
              <p className="text-xs text-white/55 leading-relaxed">{t('settlement_ui.deal_code.fallback_explainer')}</p>
              <p className="font-mono text-xs text-white/80 break-all">{fallbackId}</p>
            </div>
          )}
        </div>
        {!busy && (code || fallbackId) && (
          <button
            onClick={handleCopy}
            className="btn-primary w-full flex items-center justify-center gap-2 cursor-pointer"
          >
            <Copy size={14} />
            {fallbackId ? t('settlement_ui.deal_code.copy_id') : t('settlement_ui.deal_code.copy_code')}
          </button>
        )}
        {errMsg && (
          <p className="text-xs text-amber-300 flex items-start gap-1.5">
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{errMsg}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
        <textarea
          value={code}
          onChange={(e) => { setCode(e.target.value); setErrMsg(null); setImportedId(null); }}
          rows={6}
          placeholder={t('settlement_ui.deal_code.paste_placeholder')}
          className="w-full bg-transparent text-[11px] font-mono text-white/85 resize-none outline-none placeholder-white/25"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handlePaste}
          disabled={busy}
          className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
        >
          <ClipboardPaste size={13} />
          {t('settlement_ui.deal_code.paste')}
        </button>
        <button
          onClick={handleVerify}
          disabled={busy || !code.trim() || !!importedId}
          className="btn-primary flex-1 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : importedId ? <CheckCircle2 size={14} /> : null}
          {importedId ? t('settlement_ui.deal_code.imported') : t('settlement_ui.deal_code.verify')}
        </button>
      </div>
      {errMsg && (
        <p className="text-xs text-red-400 flex items-start gap-1.5">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{errMsg}</span>
        </p>
      )}
    </div>
  );
}
