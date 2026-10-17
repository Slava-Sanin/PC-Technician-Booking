import { authUserFromRequest } from '../_shared/authUser.ts';
import { createLowProfile, isCardcomConfigured, refundByTransactionId } from '../_shared/cardcom.ts';
import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { applyLowProfileResult } from '../_shared/subscriptionPayment.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function monthsField(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1200) return null;
  return parsed;
}

function languageField(value: unknown): 'he' | 'en' | 'ru' {
  return value === 'he' || value === 'en' || value === 'ru' ? value : 'he';
}

function rpcError(result: unknown): Response {
  const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
  return json({ error: code }, statusForCode(code));
}

async function loadState(userId: string): Promise<Record<string, unknown> | Response> {
  const state = await supabaseRpc('subscription_state', { p_user_id: userId });
  if (!isRecord(state) || state.ok !== true) return rpcError(state);
  return state;
}

function withAvailability(state: Record<string, unknown>): Record<string, unknown> {
  return { ...state, paymentAvailable: isCardcomConfigured() };
}

function siteUrl(): string {
  return (Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173').replace(/\/$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  try {
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: 'INVALID_INPUT' }, 400);
    const body: unknown = raw ? JSON.parse(raw) : {};
    if (!isRecord(body) || typeof body.action !== 'string') {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const user = await authUserFromRequest(req);
    if (!user) return json({ error: 'UNAUTHORIZED' }, 401);

    if (body.action === 'state') {
      const state = await loadState(user.id);
      if (state instanceof Response) return state;
      return json(withAvailability(state));
    }

    if (body.action === 'quote') {
      const months = monthsField(body.months);
      if (!months) return json({ error: 'INVALID_INPUT' }, 400);
      const quote = await supabaseRpc('quote_subscription', { p_months: months });
      if (!isRecord(quote) || quote.ok !== true) return rpcError(quote);
      return json(quote);
    }

    if (body.action === 'createCheckout') {
      const months = monthsField(body.months);
      if (!months) return json({ error: 'INVALID_INPUT' }, 400);
      if (!isCardcomConfigured()) {
        return json({ error: 'PAYMENT_UNAVAILABLE' }, statusForCode('PAYMENT_UNAVAILABLE'));
      }

      const order = await supabaseRpc('create_subscription_order', { p_user_id: user.id, p_months: months });
      if (!isRecord(order) || order.ok !== true || typeof order.id !== 'string') return rpcError(order);

      const amount = Number(order.amountTotal);
      const currency = typeof order.currency === 'string' ? order.currency : 'ILS';
      const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

      try {
        const checkout = await createLowProfile({
          amount,
          currency,
          language: languageField(body.language),
          productName: `Technician subscription ${months} mo`,
          returnValue: order.id,
          successRedirectUrl: `${siteUrl()}/?subscription=success&id=${order.id}`,
          failedRedirectUrl: `${siteUrl()}/?subscription=failed&id=${order.id}`,
          webHookUrl: `${supabaseUrl}/functions/v1/cardcom-webhook`,
          cardOwnerEmail: user.email,
        });
        const attached = await supabaseRpc('attach_subscription_checkout', {
          p_id: order.id,
          p_low_profile_id: checkout.lowProfileId,
        });
        if (!isRecord(attached) || attached.ok !== true) {
          await supabaseRpc('discard_subscription_order', { p_id: order.id });
          return rpcError(attached);
        }
        return json({ ok: true, subscriptionId: order.id, url: checkout.url, amountTotal: amount, currency });
      } catch (error) {
        console.error('subscription_checkout_failed', error instanceof Error ? error.message : error);
        await supabaseRpc('discard_subscription_order', { p_id: order.id });
        return json({ error: 'PAYMENT_FAILED' }, statusForCode('PAYMENT_FAILED'));
      }
    }

    if (body.action === 'sync') {
      const state = await loadState(user.id);
      if (state instanceof Response) return state;
      const subscription = isRecord(state.subscription) ? state.subscription : null;
      const lowProfileId = subscription && typeof subscription.lowProfileId === 'string' ? subscription.lowProfileId : null;

      if (subscription && subscription.status === 'pending_payment' && lowProfileId && isCardcomConfigured()) {
        try {
          await applyLowProfileResult(lowProfileId, 'sync');
        } catch (error) {
          console.error('subscription_sync_failed', error instanceof Error ? error.message : error);
        }
      }

      const refreshed = await loadState(user.id);
      if (refreshed instanceof Response) return refreshed;
      return json(withAvailability(refreshed));
    }

    if (body.action === 'abandon') {
      const state = await loadState(user.id);
      if (state instanceof Response) return state;
      const subscription = isRecord(state.subscription) ? state.subscription : null;
      if (subscription && subscription.status === 'pending_payment' && typeof subscription.id === 'string') {
        await supabaseRpc('discard_subscription_order', { p_id: subscription.id });
      }
      const refreshed = await loadState(user.id);
      if (refreshed instanceof Response) return refreshed;
      return json(withAvailability(refreshed));
    }

    if (body.action === 'cancel') {
      const state = await loadState(user.id);
      if (state instanceof Response) return state;
      const subscription = isRecord(state.subscription) ? state.subscription : null;
      if (!subscription || subscription.status !== 'active' || typeof subscription.id !== 'string') {
        return json({ error: 'SUBSCRIPTION_NOT_ACTIVE' }, statusForCode('SUBSCRIPTION_NOT_ACTIVE'));
      }

      const refund = await supabaseRpc('compute_subscription_refund', { p_id: subscription.id });
      if (!isRecord(refund) || refund.ok !== true) return rpcError(refund);

      const refundAmount = Number(refund.refundAmount ?? 0);
      const transactionId = typeof refund.transactionId === 'string' ? refund.transactionId : null;
      let refundStatus: 'none' | 'refunded' | 'failed' = 'none';
      let refundTransactionId: string | null = null;

      if (refundAmount > 0) {
        if (transactionId && isCardcomConfigured()) {
          try {
            const result = await refundByTransactionId({ transactionId, amount: refundAmount });
            refundStatus = result.ok ? 'refunded' : 'failed';
            refundTransactionId = result.refundTransactionId;
            if (!result.ok) console.error('cardcom_refund_declined', { description: result.description });
          } catch (error) {
            console.error('cardcom_refund_failed', error instanceof Error ? error.message : error);
            refundStatus = 'failed';
          }
        } else {
          refundStatus = 'failed';
        }
      }

      const marked = await supabaseRpc('mark_subscription_cancelled', {
        p_id: subscription.id,
        p_refund_amount: refundAmount,
        p_refund_status: refundStatus,
        p_refund_transaction_id: refundTransactionId,
      });
      if (!isRecord(marked) || marked.ok !== true) return rpcError(marked);

      const refreshed = await loadState(user.id);
      if (refreshed instanceof Response) return refreshed;
      return json({ ...withAvailability(refreshed), refundAmount, refundStatus });
    }

    return json({ error: 'INVALID_INPUT' }, 400);
  } catch (error) {
    console.error('technician_subscription_failed', error instanceof Error ? error.message : error);
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
