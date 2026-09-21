import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function publicPayload(result: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...result };
  delete payload.ok;
  delete payload.code;
  return payload;
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
    if (raw.length > 2000) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const date = typeof body.date === 'string' ? body.date : '';
    const month = typeof body.month === 'string' ? body.month : '';
    if ((date && month) || (!date && !month)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const result = date
      ? await supabaseRpc('get_availability', { p_date: date })
      : await supabaseRpc('get_month_availability', { p_month: month });

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
