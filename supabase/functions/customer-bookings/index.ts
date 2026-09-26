import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

async function userCustomerId(req: Request): Promise<{ customerId: string } | Response> {
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'UNAUTHORIZED' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json({ error: 'INTERNAL_ERROR' }, 500);

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: 'UNAUTHORIZED' }, 401);
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return json({ error: 'UNAUTHORIZED' }, 401);

  const profile = await supabaseRpc('get_customer_by_user_id', { p_user_id: user.id });
  if (!isRecord(profile) || profile.ok !== true || typeof profile.id !== 'string') {
    return json({ error: 'FORBIDDEN' }, 403);
  }

  return { customerId: profile.id };
}

async function restAsUser(req: Request, path: string, init: RequestInit): Promise<Response> {
  const authorization = req.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey || !authorization) {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }

  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: authorization,
      Prefer: init.method === 'PATCH' ? 'return=representation' : 'return=representation',
      ...(init.headers ?? {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  try {
    const body: unknown = JSON.parse(await req.text());
    if (!isRecord(body) || typeof body.action !== 'string') {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const identity = await userCustomerId(req);
    if (identity instanceof Response) return identity;

    if (body.action === 'list') {
      const response = await restAsUser(
        req,
        'bookings?select=id,booking_number,first_name,last_name,phone,email,address,city,appointment_date,appointment_start,appointment_end,status,comments,problem_description,service_mode,device_type,device_brand,device_model,operating_system,total_amount,currency,payment_status,booking_services(*)&customer_id=eq.' + identity.customerId + '&deleted_at=is.null&order=appointment_date.desc',
        { method: 'GET' },
      );
      if (!response.ok) return json({ error: 'INTERNAL_ERROR' }, 500);
      const bookings = await response.json();
      return json({ bookings });
    }

    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    if (!bookingId) return json({ error: 'INVALID_INPUT' }, 400);

    if (body.action === 'cancel') {
      const response = await restAsUser(
        req,
        `bookings?id=eq.${bookingId}&customer_id=eq.${identity.customerId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'cancelled', completed: false }),
        },
      );
      if (!response.ok) return json({ error: 'FORBIDDEN' }, 403);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'FORBIDDEN' }, 403);
      return json({ booking: rows[0] });
    }

    if (body.action === 'update') {
      const patch: Record<string, unknown> = {};
      const allowed = [
        'first_name', 'last_name', 'phone', 'address', 'city', 'comments',
        'problem_description', 'appointment_date', 'operating_system',
      ] as const;

      for (const key of allowed) {
        if (typeof body[key] === 'string') {
          patch[key] = body[key];
        }
      }

      if (Object.keys(patch).length === 0) {
        return json({ error: 'INVALID_INPUT' }, 400);
      }

      const response = await restAsUser(
        req,
        `bookings?id=eq.${bookingId}&customer_id=eq.${identity.customerId}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      );
      if (!response.ok) {
        const code = response.status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR';
        return json({ error: code }, statusForCode(code));
      }
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'FORBIDDEN' }, 403);
      return json({ booking: rows[0] });
    }

    return json({ error: 'INVALID_INPUT' }, 400);
  } catch {
    console.error('customer_bookings_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
