import { createAuthUser, signInWithPassword } from '../_shared/authAdmin.ts';
import { hashVerificationSecret, maskEmail, maskPhone, randomDigits, randomToken } from '../_shared/crypto.ts';
import { sendVerificationEmail } from '../_shared/email.ts';
import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { sourceHash } from '../_shared/rateLimit.ts';
import { sendOfficialSms } from '../_shared/twilio.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function textField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function passwordField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 6 && trimmed.length <= 128 ? trimmed : null;
}

function emailField(value: unknown): string | null {
  const normalized = textField(value, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function channelField(value: unknown): 'email' | 'sms' | null {
  return value === 'email' || value === 'sms' ? value : null;
}

async function issueRegistrationChallenge(input: {
  email: string | null;
  phone: string | null;
  channel: 'email' | 'sms';
  password: string;
  firstName: string;
  lastName: string;
}): Promise<Response> {
  const target = input.channel === 'email' ? input.email : input.phone;
  if (!target) {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const code = randomDigits(6);
  const token = randomToken();
  const codeHash = await hashVerificationSecret(code);
  const tokenHash = await hashVerificationSecret(token);

  const challengeId = await supabaseRpc('issue_verification_challenge', {
    p_purpose: 'customer_registration',
    p_channel: input.channel,
    p_target: target,
    p_code_hash: codeHash,
    p_token_hash: tokenHash,
    p_payload: {
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
    },
    p_customer_id: null,
    p_ttl_minutes: 20,
  });

  if (typeof challengeId !== 'string') {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }

  const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173';
  const confirmUrl = `${siteUrl.replace(/\/$/, '')}/?registerToken=${challengeId}.${token}`;

  if (input.channel === 'sms') {
    const sent = await sendOfficialSms(target, `Код регистрации: ${code}. Действителен 20 минут.`);
    if (!sent) return json({ error: 'SMS_FAILED' }, 500);
    return json({
      challengeId,
      channel: 'sms',
      maskedTarget: maskPhone(target),
    });
  }

  const sent = await sendVerificationEmail({
    to: target,
    subject: 'Подтверждение регистрации',
    text: `Код регистрации: ${code}. Или перейдите по ссылке для подтверждения.`,
    confirmUrl,
  });
  if (!sent) return json({ error: 'EMAIL_FAILED' }, 500);

  return json({
    challengeId,
    channel: 'email',
    maskedTarget: maskEmail(target),
    emailLinkSent: true,
  });
}

async function finalizeRegistration(challengeId: string, code?: string, token?: string): Promise<Response> {
  const codeHash = code ? await hashVerificationSecret(code) : null;
  const tokenHash = token ? await hashVerificationSecret(token) : null;
  const verified = await supabaseRpc('complete_verification_challenge', {
    p_id: challengeId,
    p_code_hash: codeHash,
    p_token_hash: tokenHash,
  });

  if (!isRecord(verified) || verified.ok !== true || verified.purpose !== 'customer_registration') {
    const codeName = isRecord(verified) && typeof verified.code === 'string' ? verified.code : 'INTERNAL_ERROR';
    return json({ error: codeName }, statusForCode(codeName));
  }

  const payload = isRecord(verified.payload) ? verified.payload : null;
  if (!payload) return json({ error: 'INTERNAL_ERROR' }, 500);

  const password = typeof payload.password === 'string' ? payload.password : '';
  const firstName = textField(payload.firstName, 80);
  const lastName = textField(payload.lastName, 80);
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  const phone = typeof payload.phone === 'string' ? payload.phone : null;
  if (!passwordField(password) || !firstName || !lastName || (!email && !phone)) {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const loginEmail = email ?? `phone.${(phone ?? '').replace(/\D/g, '')}@customers.local`;
  let userId: string;
  try {
    userId = await createAuthUser(loginEmail, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    if (message === 'ALREADY_REGISTERED') return json({ error: 'ALREADY_REGISTERED' }, 409);
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'INTERNAL_ERROR' }, 500);

  const insertResponse = await fetch(`${url}/rest/v1/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id: userId,
      login_email: loginEmail,
      email,
      phone,
      first_name: firstName,
      last_name: lastName,
      email_verified_at: verified.channel === 'email' ? new Date().toISOString() : null,
      phone_verified_at: verified.channel === 'sms' ? new Date().toISOString() : null,
    }),
  });

  if (!insertResponse.ok) {
    console.error('customer_insert_failed', { status: insertResponse.status });
    return json({ error: 'ALREADY_REGISTERED' }, 409);
  }

  try {
    const session = await signInWithPassword(loginEmail, password);
    return json({
      customerCreated: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
    });
  } catch {
    return json({ customerCreated: true, loginRequired: true });
  }
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

    if (body.action === 'registerStart') {
      const password = passwordField(body.password);
      const firstName = textField(body.firstName, 80);
      const lastName = textField(body.lastName, 80);
      const channel = channelField(body.verifyChannel);
      const email = body.email ? emailField(body.email) : null;
      const phoneRaw = textField(body.phone, 40);
      if (!password || !firstName || !lastName || !channel) {
        return json({ error: 'INVALID_INPUT' }, 400);
      }
      if (channel === 'email' && !email) return json({ error: 'INVALID_INPUT' }, 400);
      if (channel === 'sms' && !phoneRaw) return json({ error: 'INVALID_INPUT' }, 400);

      const normalizedPhone = phoneRaw
        ? await supabaseRpc('normalize_phone', { p_phone: phoneRaw })
        : null;
      const phone = typeof normalizedPhone === 'string' ? normalizedPhone : null;
      if (channel === 'sms' && !phone) return json({ error: 'INVALID_INPUT' }, 400);

      return issueRegistrationChallenge({ email, phone, channel, password, firstName, lastName });
    }

    if (body.action === 'registerVerify') {
      const challengeId = textField(body.challengeId, 80);
      const code = textField(body.code, 12);
      const token = textField(body.token, 128);
      if (!challengeId || (!code && !token)) {
        return json({ error: 'INVALID_INPUT' }, 400);
      }
      return finalizeRegistration(challengeId, code || undefined, token || undefined);
    }

    if (body.action === 'login') {
      const identifier = textField(body.identifier, 120);
      const password = passwordField(body.password);
      if (!identifier || !password) return json({ error: 'INVALID_INPUT' }, 400);

      const lookup = await supabaseRpc('lookup_customer_for_login', { p_identifier: identifier });
      if (!isRecord(lookup) || lookup.ok !== true || typeof lookup.loginEmail !== 'string') {
        return json({ error: 'INVALID_CREDENTIALS' }, 401);
      }

      try {
        const session = await signInWithPassword(lookup.loginEmail, password);
        return json({
          session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          },
          customer: {
            id: lookup.customerId,
            firstName: lookup.firstName,
            lastName: lookup.lastName,
          },
        });
      } catch {
        return json({ error: 'INVALID_CREDENTIALS' }, 401);
      }
    }

    if (body.action === 'me') {
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
      if (!isRecord(profile) || profile.ok !== true) {
        return json({ error: 'FORBIDDEN' }, 403);
      }
      return json({ customer: profile });
    }

    await sourceHash(req);
    return json({ error: 'INVALID_INPUT' }, 400);
  } catch {
    console.error('customer_auth_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
