import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function publicPayload(result: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...result };
  delete payload.ok;
  delete payload.code;
  return payload;
}

function serviceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  if (!value.every((item) => typeof item === 'string' && /^[0-9a-f-]{36}$/i.test(item))) return null;
  return value;
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
    if (raw.length > 8000) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const date = typeof body.date === 'string' ? body.date : '';
    const month = typeof body.month === 'string' ? body.month : '';
    const serviceMode = typeof body.serviceMode === 'string' ? body.serviceMode : '';
    const ids = serviceIds(body.serviceIds);
    if ((date && month) || (!date && !month) || !ids) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const result = date
      ? await supabaseRpc('get_availability', {
        p_date: date,
        p_service_ids: ids,
        p_service_mode: serviceMode,
      })
      : await supabaseRpc('get_month_availability', {
        p_month: month,
        p_service_ids: ids,
        p_service_mode: serviceMode,
      });

    if (!isRecord(result) || result.ok !== true) {
      const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
      return json({ error: code }, statusForCode(code));
    }

    return json(publicPayload(result));
  } catch {
    console.error('get_availability_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
