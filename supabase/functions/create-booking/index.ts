import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { sourceHash } from '../_shared/rateLimit.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';
import { buildBookingSms, normalizeLocale, sendOfficialSms } from '../_shared/twilio.ts';

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

    const result = await supabaseRpc('create_booking_atomic', {
      p_first_name: stringField(body.firstName),
      p_last_name: stringField(body.lastName),
      p_phone: stringField(body.phone),
      p_address: stringField(body.address),
      p_city: stringField(body.city),
      p_operating_system: stringField(body.operatingSystem),
      p_comments: stringField(body.comments),
      p_appointment_date: stringField(body.appointmentDate),
      p_appointment_time: stringField(body.appointmentTime),
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

    return json({
      bookingCreated: true,
      bookingNumber,
      smsSent,
      smsSkipped: !shouldSendSms,
      appointmentDate,
      appointmentTime,
    });
  } catch {
    console.error('create_booking_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
