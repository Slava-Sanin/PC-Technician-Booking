import { getLowProfileResult } from './cardcom.ts';
import { isRecord } from './http.ts';
import { supabaseRpc } from './supabaseRpc.ts';

export type LowProfileOutcome = 'active' | 'failed' | 'pending' | 'duplicate';

/**
 * Verifies a Cardcom LowProfile transaction with GetLpResult (never trusts the webhook body)
 * and records the outcome idempotently through apply_subscription_payment.
 */
export async function applyLowProfileResult(lowProfileId: string, source: 'sync' | 'webhook'): Promise<LowProfileOutcome> {
  const result = await getLowProfileResult(lowProfileId);
  const eventBase = `cardcom:lp:${lowProfileId}`;

  if (result.responseCode === 0) {
    const applied = await supabaseRpc('apply_subscription_payment', {
      p_low_profile_id: lowProfileId,
      p_status: 'paid',
      p_transaction_id: result.transactionId,
      p_amount: result.amount,
      p_card_last4: result.last4,
      p_event_id: `${eventBase}:paid`,
      p_payload: {
        source,
        responseCode: result.responseCode,
        transactionId: result.transactionId,
        amount: result.amount,
        returnValue: result.returnValue,
      },
    });
    if (isRecord(applied) && applied.ok === true) {
      return applied.duplicate === true ? 'duplicate' : 'active';
    }
    console.error('subscription_payment_apply_failed', applied);
    throw new Error('APPLY_FAILED');
  }

  if (source === 'webhook') {
    await supabaseRpc('apply_subscription_payment', {
      p_low_profile_id: lowProfileId,
      p_status: 'failed',
      p_transaction_id: result.transactionId,
      p_amount: null,
      p_card_last4: null,
      p_event_id: `${eventBase}:failed:${result.responseCode ?? 'x'}`,
      p_payload: { source, responseCode: result.responseCode, description: result.description },
    });
    return 'failed';
  }

  // Manual sync: a non-zero code may only mean the cardholder has not finished yet.
  return 'pending';
}
