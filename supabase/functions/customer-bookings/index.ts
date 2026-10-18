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

const BOOKING_SELECT = 'id,booking_number,first_name,last_name,phone,email,address,city,appointment_date,appointment_start,appointment_end,status,comments,problem_description,service_mode,device_type,device_brand,device_model,operating_system,subtotal,total_amount,currency,payment_status,payment_expires_at,customer_edited_at,created_at,updated_at,booking_services(*),payments(id,kind,amount,currency,status,provider,created_at,paid_at,refunded_at)';

const UUID_RE = /^[0-9a-f-]{36}$/i;

const EDIT_STRING_FIELDS = [
  'firstName', 'lastName', 'phone', 'email', 'address', 'city', 'serviceMode',
  'deviceType', 'operatingSystem', 'deviceBrand', 'deviceModel',
  'problemDescription', 'comments', 'appointmentDate', 'appointmentTime',
] as const;

function serviceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  if (!value.every((item) => typeof item === 'string' && UUID_RE.test(item))) return null;
  return value;
}

function publicPayload(result: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...result };
  delete payload.ok;
  delete payload.code;
  return payload;
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
        `bookings?select=${BOOKING_SELECT}&customer_id=eq.${identity.customerId}&deleted_at=is.null&order=appointment_date.desc`,
        { method: 'GET' },
      );
      if (!response.ok) return json({ error: 'INTERNAL_ERROR' }, 500);
      const bookings = await response.json();
      return json({ bookings });
    }

    const bookingId = typeof body.bookingId === 'string' && UUID_RE.test(body.bookingId) ? body.bookingId : '';
    if (!bookingId) return json({ error: 'INVALID_INPUT' }, 400);

    const loadBooking = async (): Promise<unknown | null> => {
      const response = await restAsUser(
        req,
        `bookings?select=${BOOKING_SELECT}&id=eq.${bookingId}&customer_id=eq.${identity.customerId}&deleted_at=is.null`,
        { method: 'GET' },
      );
      if (!response.ok) return null;
      const rows = await response.json();
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    };

    if (body.action === 'availability') {
      // Slots for moving this booking: its own time range must not count as taken.
      const owned = await loadBooking();
      if (!owned) return json({ error: 'FORBIDDEN' }, 403);

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
          p_exclude_booking_id: bookingId,
        })
        : await supabaseRpc('get_month_availability', {
          p_month: month,
          p_service_ids: ids,
          p_service_mode: serviceMode,
          p_exclude_booking_id: bookingId,
        });

      if (!isRecord(result) || result.ok !== true) {
        const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
        return json({ error: code }, statusForCode(code));
      }
      return json(publicPayload(result));
    }

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
      // Full edit: prices, duration, slot checks, payment reconciliation and the
      // once-per-day limit are all enforced inside customer_update_booking().
      const payload: Record<string, unknown> = {};
      for (const key of EDIT_STRING_FIELDS) {
        const value = body[key];
        if (typeof value === 'string') {
          if (value.length > 4000) return json({ error: 'INVALID_INPUT' }, 400);
          payload[key] = value;
        }
      }
      const ids = serviceIds(body.serviceIds);
      if (!ids) return json({ error: 'INVALID_INPUT' }, 400);
      payload.serviceIds = ids;

      const result = await supabaseRpc('customer_update_booking', {
        p_booking_id: bookingId,
        p_customer_id: identity.customerId,
        p_payload: payload,
      });

      if (!isRecord(result) || result.ok !== true) {
        const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
        const extra = isRecord(result) && typeof result.nextEditAt === 'string' ? { nextEditAt: result.nextEditAt } : {};
        return json({ error: code, ...extra }, statusForCode(code));
      }

      const booking = await loadBooking();
      if (!booking) return json({ error: 'INTERNAL_ERROR' }, 500);
      return json({ booking, result: publicPayload(result) });
    }

    return json({ error: 'INVALID_INPUT' }, 400);
  } catch {
    console.error('customer_bookings_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
