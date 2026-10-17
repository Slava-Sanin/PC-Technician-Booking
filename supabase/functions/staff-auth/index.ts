import { createAuthUser, signInWithPassword } from '../_shared/authAdmin.ts';
import { hashVerificationSecret, maskEmail, randomDigits, randomToken } from '../_shared/crypto.ts';
import { sendVerificationEmail } from '../_shared/email.ts';
import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function textField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

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

async function subscriptionRequired(userId: unknown): Promise<boolean> {
  if (typeof userId !== 'string') return false;
  try {
    const state = await supabaseRpc('subscription_state', { p_user_id: userId });
    if (!isRecord(state) || state.ok !== true) return false;
    return state.hasAccess !== true;
  } catch {
    return false;
  }
}

async function registrationEligibility(email: string): Promise<{
  blocked: Response | null;
  linkExistingAuth: boolean;
  userId: string | null;
}> {
  const result = await supabaseRpc('check_technician_registration_eligibility', { p_email: email });
  if (!isRecord(result)) {
    return { blocked: json({ error: 'INTERNAL_ERROR' }, 500), linkExistingAuth: false, userId: null };
  }
  if (result.ok !== true) {
    const code = typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
    return { blocked: json({ error: code }, statusForCode(code)), linkExistingAuth: false, userId: null };
  }
  return {
    blocked: null,
    linkExistingAuth: result.linkExistingAuth === true,
    userId: typeof result.userId === 'string' ? result.userId : null,
  };
}

async function startRegistration(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<Response> {
  const eligibility = await registrationEligibility(input.email);
  if (eligibility.blocked) return eligibility.blocked;

  const code = randomDigits(6);
  const token = randomToken();
  const codeHash = await hashVerificationSecret(code);
  const tokenHash = await hashVerificationSecret(token);

  const challengeId = await supabaseRpc('issue_verification_challenge', {
    p_purpose: 'staff_registration',
    p_channel: 'email',
    p_target: input.email,
    p_code_hash: codeHash,
    p_token_hash: tokenHash,
    p_payload: {
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone || null,
    },
    p_customer_id: null,
    p_ttl_minutes: 20,
  });

  if (typeof challengeId !== 'string') {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }

  const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173';
  const confirmUrl = `${siteUrl.replace(/\/$/, '')}/?staffRegisterToken=${challengeId}.${token}`;

  const sent = await sendVerificationEmail({
    to: input.email,
    subject: 'Регистрация техника',
    text: `Код подтверждения регистрации техника: ${code}. Или перейдите по ссылке для подтверждения.`,
    confirmUrl,
  });
  if (!sent) return json({ error: 'EMAIL_FAILED' }, 500);

  return json({
    challengeId,
    channel: 'email',
    maskedTarget: maskEmail(input.email),
    emailLinkSent: true,
    linkExistingAuth: eligibility.linkExistingAuth,
  });
}

async function finishRegistration(challengeId: string, code?: string, token?: string): Promise<Response> {
  const codeHash = code ? await hashVerificationSecret(code) : null;
  const tokenHash = token ? await hashVerificationSecret(token) : null;
  const verified = await supabaseRpc('complete_verification_challenge', {
    p_id: challengeId,
    p_code_hash: codeHash,
    p_token_hash: tokenHash,
  });

  if (!isRecord(verified) || verified.ok !== true || verified.purpose !== 'staff_registration') {
    const codeName = isRecord(verified) && typeof verified.code === 'string' ? verified.code : 'INTERNAL_ERROR';
    return json({ error: codeName }, statusForCode(codeName));
  }

  const payload = isRecord(verified.payload) ? verified.payload : null;
  if (!payload) return json({ error: 'INTERNAL_ERROR' }, 500);

  const password = typeof payload.password === 'string' ? payload.password : '';
  const firstName = textField(payload.firstName, 120);
  const lastName = textField(payload.lastName, 120);
  const phone = textField(payload.phone, 32);
  const email = emailField(payload.email);
  if (!passwordField(password) || !firstName || !lastName || !email) {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const eligibility = await registrationEligibility(email);
  if (eligibility.blocked) return eligibility.blocked;

  let userId: string;
  if (eligibility.linkExistingAuth && eligibility.userId) {
    // The email already has a customer account: verify the password before linking the technician profile.
    try {
      await signInWithPassword(email, password);
    } catch {
      return json({ error: 'INVALID_CREDENTIALS' }, 401);
    }
    userId = eligibility.userId;
  } else {
    try {
      userId = await createAuthUser(email, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      if (message === 'ALREADY_REGISTERED') {
        return json({ error: 'ALREADY_REGISTERED' }, 409);
      }
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  }

  const completed = await supabaseRpc('complete_technician_registration', {
    p_user_id: userId,
    p_email: email,
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone: phone || null,
  });
  if (!isRecord(completed) || completed.ok !== true) {
    const codeName = isRecord(completed) && typeof completed.code === 'string' ? completed.code : 'INTERNAL_ERROR';
    return json({ error: codeName }, statusForCode(codeName));
  }

  try {
    const session = await signInWithPassword(email, password);
    return json({
      registered: true,
      subscriptionRequired: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
      staff: { userId, role: 'technician' },
    });
  } catch {
    return json({ registered: true, loginRequired: true });
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
    const raw = await req.text();
    if (raw.length > 8192) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }
    const body: unknown = JSON.parse(raw);
    if (!isRecord(body) || typeof body.action !== 'string') {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    if (body.action === 'registerStart') {
      const email = emailField(body.email);
      const password = passwordField(body.password);
      const firstName = textField(body.firstName, 120);
      const lastName = textField(body.lastName, 120);
      const phone = textField(body.phone, 32);
      if (!email || !password || !firstName || !lastName) {
        return json({ error: 'INVALID_INPUT' }, 400);
      }
      return await startRegistration({ email, password, firstName, lastName, phone });
    }

    if (body.action === 'registerVerify') {
      const challengeId = textField(body.challengeId, 80);
      const code = textField(body.code, 12);
      const token = textField(body.token, 128);
      if (!challengeId || (!code && !token)) {
        return json({ error: 'INVALID_INPUT' }, 400);
      }
      return await finishRegistration(challengeId, code || undefined, token || undefined);
    }

    if (body.action !== 'login') {
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
        subscriptionRequired: await subscriptionRequired(lookup.userId),
      });
    } catch {
      return json({ error: 'INVALID_CREDENTIALS' }, 401);
    }
  } catch {
    console.error('staff_auth_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
