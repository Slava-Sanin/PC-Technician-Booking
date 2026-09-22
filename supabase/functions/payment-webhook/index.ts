import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const secret = Deno.env.get('PAYMENT_WEBHOOK_SECRET');
  if (!secret) {
    console.error('payment_webhook_unconfigured');
    return json({ error: 'PAYMENT_FAILED' }, 503);
  }

  try {
    const raw = await req.text();
    if (raw.length > 16000) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const provided = req.headers.get('x-payment-signature') ?? '';
    const expected = await signature(secret, raw);
    if (!safeEqual(provided.toLowerCase(), expected)) {
      return json({ error: 'UNAUTHORIZED' }, 401);
    }

    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const result = await supabaseRpc('apply_provider_payment', {
      p_provider: typeof body.provider === 'string' ? body.provider : '',
      p_provider_payment_id: typeof body.providerPaymentId === 'string' ? body.providerPaymentId : '',
      p_status: typeof body.status === 'string' ? body.status : '',
      p_event_id: typeof body.eventId === 'string' ? body.eventId : '',
      p_payload: { provider: body.provider, status: body.status, eventId: body.eventId },
    });

    if (!isRecord(result) || result.ok !== true) {
      const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
      return json({ error: code }, statusForCode(code));
    }

    return json({ ok: true, duplicate: result.duplicate === true });
  } catch {
    console.error('payment_webhook_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
