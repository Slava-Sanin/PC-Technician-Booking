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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  try {
    const raw = await req.text();
    if (raw.length > 16000) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const body: unknown = JSON.parse(raw);
    if (!isRecord(body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const ids = serviceIds(body.serviceIds);
    if (!ids) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }

    const automaticReady = Boolean(Deno.env.get('CARD_CHECKOUT_SECRET'));
    const result = await supabaseRpc('create_booking_atomic', {
      p_first_name: stringField(body.firstName),
      p_last_name: stringField(body.lastName),
      p_phone: stringField(body.phone),
      p_email: stringField(body.email),
      p_address: stringField(body.address),
      p_city: stringField(body.city),
      p_service_mode: stringField(body.serviceMode),
      p_device_type: stringField(body.deviceType),
      p_operating_system: stringField(body.operatingSystem),
      p_device_brand: stringField(body.deviceBrand),
      p_device_model: stringField(body.deviceModel),
      p_problem_description: stringField(body.problemDescription),
      p_comments: stringField(body.comments),
      p_appointment_date: stringField(body.appointmentDate),
      p_appointment_time: stringField(body.appointmentTime),
      p_service_ids: ids,
      p_payment_method_code: stringField(body.paymentMethodCode),
      p_automatic_ready: automaticReady,
      p_source_hash: await sourceHash(req),
    });

    if (!isRecord(result) || result.ok !== true) {
      const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
      return json({ error: code }, statusForCode(code));
    }

    const bookingNumber = typeof result.bookingNumber === 'string' ? result.bookingNumber : '';
    const appointmentDate = typeof result.appointmentDate === 'string' ? result.appointmentDate : '';
    const appointmentTime = typeof result.appointmentTime === 'string' ? result.appointmentTime : '';
    const firstName = typeof result.firstName === 'string' ? result.firstName : '';
    const phone = typeof result.phone === 'string' ? result.phone : '';
    const shouldSendSms = result.sendSms === true;

    let smsSent = false;
    if (shouldSendSms && phone && bookingNumber) {
      try {
        smsSent = await sendOfficialSms(
          phone,
          buildBookingSms({
            locale: normalizeLocale(body.locale),
            firstName,
            bookingNumber,
            appointmentDate,
            appointmentTime,
          }),
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
  } catch {
    console.error('create_booking_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
