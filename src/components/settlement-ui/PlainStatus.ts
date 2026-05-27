// PlainStatus — single source of truth for translating backend
// AgreementStatusResult / Agreement.status fields into a plain-English
// status label, color tier, and primary action. Every UI surface that
// shows an agreement's state must derive its display from this function
// so labels and actions stay in lock-step.
//
// NOTE: This file is intentionally pure (no React, no Tauri imports).
// It returns i18n key strings; render-time components call t() against them.

import type { AgreementStatusResult, Agreement } from '../../lib/types';

export type PlainStatusKind =
  | 'setting_up'      // draft / proposed — funding tx not on-chain yet
  | 'waiting'         // funded, no proof, no release-eligibility
  | 'ready_release'   // release_eligible === true
  | 'ready_refund'    // refund_eligible === true (timeout reached)
  | 'disputed'        // disputed_metadata_only
  | 'complete'        // released
  | 'refunded'        // refunded
  | 'expired'         // expired
  | 'unknown';

export type PlainStatusColor = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export type PrimaryActionKind = 'release' | 'refund' | 'view_dispute' | 'view_details' | null;

export interface PlainStatus {
  kind: PlainStatusKind;
  labelKey: string;
  color: PlainStatusColor;
  primaryAction: PrimaryActionKind;
  primaryActionLabelKey: string;
}

export interface PlainStatusInput {
  agreementStatus?: string;          // Agreement.status or AgreementStatusResult.status
  releaseEligible?: boolean;
  refundEligible?: boolean;
  hasOpenDispute?: boolean;
}

// Centralized status derivation. Precedence rules (highest first):
//   1. Open dispute → 'disputed' (overrides eligibility flags)
//   2. Terminal states from agreementStatus (released / refunded / expired)
//   3. Eligibility flags (release_eligible / refund_eligible)
//   4. funded with neither eligibility → 'waiting'
//   5. draft / proposed → 'setting_up'
//   6. anything else → 'unknown'
export function derivePlainStatus(input: PlainStatusInput): PlainStatus {
  const status = (input.agreementStatus ?? '').toLowerCase();

  if (input.hasOpenDispute || status === 'disputed_metadata_only') {
    return {
      kind: 'disputed',
      labelKey: 'settlement_ui.status.disputed',
      color: 'warning',
      primaryAction: 'view_dispute',
      primaryActionLabelKey: 'settlement_ui.actions.view_dispute',
    };
  }

  if (status === 'released') {
    return {
      kind: 'complete',
      labelKey: 'settlement_ui.status.complete',
      color: 'success',
      primaryAction: 'view_details',
      primaryActionLabelKey: 'settlement_ui.actions.view_details',
    };
  }

  if (status === 'refunded') {
    return {
      kind: 'refunded',
      labelKey: 'settlement_ui.status.refunded',
      color: 'neutral',
      primaryAction: 'view_details',
      primaryActionLabelKey: 'settlement_ui.actions.view_details',
    };
  }

  if (status === 'expired') {
    return {
      kind: 'expired',
      labelKey: 'settlement_ui.status.expired',
      color: 'error',
      primaryAction: 'refund',
      primaryActionLabelKey: 'settlement_ui.actions.claim_refund',
    };
  }

  if (input.releaseEligible === true) {
    return {
      kind: 'ready_release',
      labelKey: 'settlement_ui.status.ready_release',
      color: 'success',
      primaryAction: 'release',
      primaryActionLabelKey: 'settlement_ui.actions.release_funds',
    };
  }

  if (input.refundEligible === true) {
    return {
      kind: 'ready_refund',
      labelKey: 'settlement_ui.status.ready_refund',
      color: 'warning',
      primaryAction: 'refund',
      primaryActionLabelKey: 'settlement_ui.actions.claim_refund',
    };
  }

  if (status === 'funded') {
    return {
      kind: 'waiting',
      labelKey: 'settlement_ui.status.waiting',
      color: 'info',
      primaryAction: 'view_details',
      primaryActionLabelKey: 'settlement_ui.actions.view_details',
    };
  }

  if (status === 'draft' || status === 'proposed' || status === 'open' || status === 'pending') {
    return {
      kind: 'setting_up',
      labelKey: 'settlement_ui.status.setting_up',
      color: 'neutral',
      primaryAction: 'view_details',
      primaryActionLabelKey: 'settlement_ui.actions.view_details',
    };
  }

  return {
    kind: 'unknown',
    labelKey: 'settlement_ui.status.unknown',
    color: 'neutral',
    primaryAction: 'view_details',
    primaryActionLabelKey: 'settlement_ui.actions.view_details',
  };
}

// Adapter that converts the two backend shapes (list-style Agreement and
// status-RPC AgreementStatusResult) into a PlainStatus without the caller
// needing to know which one they have. `hasOpenDispute` is passed
// separately because neither shape carries it inline.
export function plainStatusFromAgreement(
  agreement: Agreement | undefined | null,
  opts: { hasOpenDispute?: boolean } = {},
): PlainStatus {
  return derivePlainStatus({
    agreementStatus: agreement?.status,
    releaseEligible: agreement?.release_eligible,
    refundEligible: undefined,
    hasOpenDispute: opts.hasOpenDispute,
  });
}

export function plainStatusFromStatusResult(
  result: AgreementStatusResult | undefined | null,
  opts: { hasOpenDispute?: boolean } = {},
): PlainStatus {
  return derivePlainStatus({
    agreementStatus: result?.status,
    releaseEligible: result?.release_eligible,
    refundEligible: result?.refund_eligible,
    hasOpenDispute: opts.hasOpenDispute,
  });
}
