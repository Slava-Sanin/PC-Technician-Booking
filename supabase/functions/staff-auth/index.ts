import { signInWithPassword } from '../_shared/authAdmin.ts';
import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function emailField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function passwordField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 6 && trimmed.length <= 128 ? trimmed : null;
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
    if (!isRecord(body) || body.action !== 'login') {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const email = emailField(body.email);
    const password = passwordField(body.password);
    if (!email || !password) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const lookup = await supabaseRpc('lookup_staff_for_login', { p_email: email });
    if (!isRecord(lookup) || lookup.ok !== true || typeof lookup.loginEmail !== 'string') {
      const code = isRecord(lookup) && typeof lookup.code === 'string' ? lookup.code : 'INVALID_CREDENTIALS';
      return json({ error: code }, statusForCode(code));
    }

    try {
      const session = await signInWithPassword(lookup.loginEmail, password);
      return json({
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        },
        staff: {
          userId: lookup.userId,
          role: lookup.role,
        },
      });
    } catch {
      return json({ error: 'INVALID_CREDENTIALS' }, 401);
    }
  } catch {
    console.error('staff_auth_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
