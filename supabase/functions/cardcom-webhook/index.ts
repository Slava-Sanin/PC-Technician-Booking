// Cardcom WebHookUrl receiver for technician subscriptions.
// The body is only used to find the LowProfileId; the outcome is always re-read
// from Cardcom with GetLpResult before anything is written to the database.
// Cardcom retries up to 7 times unless it receives HTTP 200, so duplicates are expected.

import { isCardcomConfigured } from '../_shared/cardcom.ts';
import { corsHeaders, isRecord, json } from '../_shared/http.ts';
import { applyLowProfileResult } from '../_shared/subscriptionPayment.ts';

function pick(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  const lower = new Map(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lower.get(key.toLowerCase());
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') ?? '';
  const raw = await req.text();
  if (raw.length > 32000) return {};

  if (contentType.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  const params = new URLSearchParams(raw);
  const result: Record<string, unknown> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  if (Object.keys(result).length === 0 && raw.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!isCardcomConfigured()) {
    console.error('cardcom_webhook_unconfigured');
    return json({ error: 'PAYMENT_UNAVAILABLE' }, 503);
  }

  try {
    const url = new URL(req.url);
    const query: Record<string, unknown> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const body = req.method === 'POST' ? await parseBody(req) : {};
    const merged = { ...query, ...body };

    const lowProfileId = pick(merged, ['LowProfileId', 'lowprofilecode', 'LowProfileCode']);
    if (!lowProfileId || lowProfileId.length > 120) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const outcome = await applyLowProfileResult(lowProfileId, 'webhook');
    return json({ ok: true, outcome });
  } catch (error) {
    console.error('cardcom_webhook_failed', error instanceof Error ? error.message : error);
    // Non-200 makes Cardcom retry later, which is what we want for transient failures.
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
