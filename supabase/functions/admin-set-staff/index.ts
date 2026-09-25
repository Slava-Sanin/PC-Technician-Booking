import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';

function emailField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function roleField(value: unknown): 'admin' | 'technician' | null {
  return value === 'admin' || value === 'technician' ? value : null;
}

function passwordField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 6 ? trimmed : null;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

async function rpcAsUser(name: string, args: Record<string, unknown>, authorization: string): Promise<unknown> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    console.error('missing_supabase_function_env');
    throw new Error('MISSING_SUPABASE_ENV');
  }

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: authorization,
    },
    body: JSON.stringify(args),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error('rpc_failed', { name, status: response.status });
    throw new Error('RPC_FAILED');
  }

  if (!text) return null;
  return JSON.parse(text) as unknown;
}

async function ensureAuthUser(email: string, password: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    console.error('missing_supabase_function_env');
    throw new Error('MISSING_SUPABASE_ENV');
  }

  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });

  if (response.ok) return;

  const payload = await response.json().catch(() => null);
  const message = isRecord(payload) && typeof payload.msg === 'string' ? payload.msg : '';
  if (response.status === 422 && /already been registered|already exists/i.test(message)) {
    return;
  }

  console.error('auth_user_create_failed', { status: response.status, message });
  throw new Error('AUTH_USER_CREATE_FAILED');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  try {
    const raw = await req.text();
    if (raw.length > 4096) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const email = emailField(body.email);
    const role = roleField(body.role);
    const active = typeof body.active === 'boolean' ? body.active : null;
    const password = passwordField(body.password);

    if (!email || !role || active === null) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const adminCheck = await rpcAsUser('is_admin', {}, authorization);
    if (adminCheck !== true) {
      return json({ error: 'FORBIDDEN' }, 403);
    }

    const rpcArgs = {
      p_email: email,
      p_role: role,
      p_active: active,
      p_first_name: optionalText(body.firstName, 120),
      p_last_name: optionalText(body.lastName, 120),
      p_phone: optionalText(body.phone, 32),
      p_address: optionalText(body.address, 500),
    };
    let result = await rpcAsUser('admin_set_staff', rpcArgs, authorization);

    if (isRecord(result) && result.ok === true) {
      return json({ ok: true, ...result });
    }

    const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
    if (code === 'STAFF_USER_NOT_FOUND') {
      if (!password) {
        return json({ error: 'STAFF_PASSWORD_REQUIRED' }, statusForCode('STAFF_PASSWORD_REQUIRED'));
      }
      await ensureAuthUser(email, password);
      result = await rpcAsUser('admin_set_staff', rpcArgs, authorization);
      if (isRecord(result) && result.ok === true) {
        return json({ ok: true, ...result });
      }
      const retryCode = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
      return json({ error: retryCode }, statusForCode(retryCode));
    }

    return json({ error: code }, statusForCode(code));
  } catch (error) {
    console.error('admin_set_staff_function_failed', error);
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
