import { hashVerificationSecret, maskEmail, maskPhone, randomDigits } from '../_shared/crypto.ts';
import { sendVerificationEmail } from '../_shared/email.ts';
import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { sourceHash } from '../_shared/rateLimit.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';
import { buildBookingSms, normalizeLocale, sendOfficialSms } from '../_shared/twilio.ts';

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function serviceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  if (!value.every((item) => typeof item === 'string' && /^[0-9a-f-]{36}$/i.test(item))) return null;
  return value;
}

function channelField(value: unknown): 'email' | 'sms' | null {
  return value === 'email' || value === 'sms' ? value : null;
}

function bookingPayload(body: Record<string, unknown>) {
  const ids = serviceIds(body.serviceIds);
  if (!ids) return null;
  return {
    firstName: stringField(body.firstName),
    lastName: stringField(body.lastName),
    phone: stringField(body.phone),
    email: stringField(body.email),
    address: stringField(body.address),
    city: stringField(body.city),
    serviceMode: stringField(body.serviceMode),
    deviceType: stringField(body.deviceType),
    operatingSystem: stringField(body.operatingSystem),
    deviceBrand: stringField(body.deviceBrand),
    deviceModel: stringField(body.deviceModel),
    problemDescription: stringField(body.problemDescription),
    comments: stringField(body.comments),
    appointmentDate: stringField(body.appointmentDate),
    appointmentTime: stringField(body.appointmentTime),
    serviceIds: ids,
    paymentMethodCode: stringField(body.paymentMethodCode),
    locale: normalizeLocale(body.locale),
    customerId: typeof body.customerId === 'string' ? body.customerId : null,
  };
}

async function resolveCustomerId(req: Request, body: Record<string, unknown>): Promise<string | null> {
  if (typeof body.customerId === 'string' && body.customerId) {
    return body.customerId;
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return null;

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;

  const profile = await supabaseRpc('get_customer_by_user_id', { p_user_id: user.id });
  if (!isRecord(profile) || profile.ok !== true || typeof profile.id !== 'string') return null;
  return profile.id;
}

async function requestConfirmation(req: Request, body: Record<string, unknown>): Promise<Response> {
  const payload = bookingPayload(body);
  const channel = channelField(body.confirmChannel);
  if (!payload || !channel) {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  if (channel === 'email' && !payload.email.trim()) {
    return json({ error: 'EMAIL_REQUIRED' }, 400);
  }

  const customerId = await resolveCustomerId(req, body);
  if (customerId) payload.customerId = customerId;

  const normalizedPhone = await supabaseRpc('normalize_phone', { p_phone: payload.phone });
  const phone = typeof normalizedPhone === 'string' ? normalizedPhone : payload.phone.trim();
  const target = channel === 'email' ? payload.email.trim().toLowerCase() : phone;

  const code = randomDigits(6);
  const codeHash = await hashVerificationSecret(code);

  const challengeId = await supabaseRpc('issue_verification_challenge', {
    p_purpose: 'booking_confirmation',
    p_channel: channel,
    p_target: target,
    p_code_hash: codeHash,
    p_token_hash: null,
    p_payload: payload,
    p_customer_id: customerId,
    p_ttl_minutes: 15,
  });

  if (typeof challengeId !== 'string') {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }

  if (channel === 'sms') {
    const sent = await sendOfficialSms(phone, `Код подтверждения заявки: ${code}. Действителен 15 минут.`);
    if (!sent) return json({ error: 'SMS_FAILED' }, 500);
    return json({ confirmationRequested: true, confirmationId: challengeId, channel, maskedTarget: maskPhone(phone) });
  }

  const sent = await sendVerificationEmail({
    to: target,
    subject: 'Подтверждение заявки',
    text: `Код подтверждения заявки: ${code}. Действителен 15 минут.`,
  });
  if (!sent) return json({ error: 'EMAIL_FAILED' }, 500);

  return json({
    confirmationRequested: true,
    confirmationId: challengeId,
    channel,
    maskedTarget: maskEmail(target),
  });
}

async function confirmAndCreate(req: Request, body: Record<string, unknown>): Promise<Response> {
  const confirmationId = stringField(body.confirmationId);
  const code = stringField(body.code);
  if (!confirmationId || !/^\d{6}$/.test(code)) {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const codeHash = await hashVerificationSecret(code);
  const verified = await supabaseRpc('complete_verification_challenge', {
    p_id: confirmationId,
    p_code_hash: codeHash,
    p_token_hash: null,
  });

  if (!isRecord(verified) || verified.ok !== true || verified.purpose !== 'booking_confirmation') {
    const errCode = isRecord(verified) && typeof verified.code === 'string' ? verified.code : 'INTERNAL_ERROR';
    return json({ error: errCode }, statusForCode(errCode));
  }

  const payload = isRecord(verified.payload) ? verified.payload : null;
  if (!payload || !serviceIds(payload.serviceIds)) {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }

  const customerIdFromSession = await resolveCustomerId(req, body);
  const payloadCustomerId = typeof payload.customerId === 'string' ? payload.customerId : null;
  const customerId = customerIdFromSession ?? payloadCustomerId;

  const automaticReady = Boolean(Deno.env.get('CARD_CHECKOUT_SECRET'));
  const result = await supabaseRpc('create_booking_atomic', {
    p_first_name: stringField(payload.firstName),
    p_last_name: stringField(payload.lastName),
    p_phone: stringField(payload.phone),
    p_email: stringField(payload.email),
    p_address: stringField(payload.address),
    p_city: stringField(payload.city),
    p_service_mode: stringField(payload.serviceMode),
    p_device_type: stringField(payload.deviceType),
    p_operating_system: stringField(payload.operatingSystem),
    p_device_brand: stringField(payload.deviceBrand),
    p_device_model: stringField(payload.deviceModel),
    p_problem_description: stringField(payload.problemDescription),
    p_comments: stringField(payload.comments),
    p_appointment_date: stringField(payload.appointmentDate),
    p_appointment_time: stringField(payload.appointmentTime),
    p_service_ids: payload.serviceIds as string[],
    p_payment_method_code: stringField(payload.paymentMethodCode),
    p_automatic_ready: automaticReady,
    p_source_hash: await sourceHash(req),
    p_customer_id: customerId,
  });

  if (!isRecord(result) || result.ok !== true) {
    const err = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
    return json({ error: err }, statusForCode(err));
  }

  const bookingNumber = typeof result.bookingNumber === 'string' ? result.bookingNumber : '';
  const appointmentDate = typeof result.appointmentDate === 'string' ? result.appointmentDate : '';
  const appointmentTime = typeof result.appointmentTime === 'string' ? result.appointmentTime : '';
  const firstName = typeof result.firstName === 'string' ? result.firstName : '';
  const phone = typeof result.phone === 'string' ? result.phone : '';
  const shouldSendSms = result.sendSms === true;
  const locale = normalizeLocale(payload.locale);

  let smsSent = false;
  if (shouldSendSms && phone && bookingNumber) {
    try {
      smsSent = await sendOfficialSms(
        phone,
        buildBookingSms({ locale, firstName, bookingNumber, appointmentDate, appointmentTime }),
      );
    } catch {
      console.error('sms_failed', { bookingId: result.bookingId });
      smsSent = false;
    }
  }

  const response = { ...result };
  delete response.ok;
  delete response.code;
  delete response.sendSms;
  delete response.phone;
  return json({
    ...response,
    bookingCreated: true,
    smsSent,
    smsSkipped: !shouldSendSms,
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
    const raw = await req.text();
    if (raw.length > 32000) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const phase = stringField(body.phase) || 'confirm';
    if (phase === 'request') {
      return requestConfirmation(req, body);
    }
    if (phase === 'confirm') {
      return confirmAndCreate(req, body);
    }

    return json({ error: 'INVALID_INPUT' }, 400);
  } catch {
    console.error('create_booking_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
