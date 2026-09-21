export type SmsLocale = 'ru' | 'he' | 'en';

export function normalizeLocale(value: unknown): SmsLocale {
  if (value === 'he' || value === 'en' || value === 'ru') return value;
  return 'ru';
}

export function buildBookingSms(input: {
  locale: SmsLocale;
  firstName: string;
  bookingNumber: string;
  appointmentDate: string;
  appointmentTime: string;
}): string {
  const when = `${input.appointmentDate} ${input.appointmentTime}`;
  if (input.locale === 'he') {
    return `שלום, ${input.firstName}! ההזמנה שלך #${input.bookingNumber} להתקנת מערכת הפעלה נוצרה בהצלחה. צפו לטכנאי ב-${when}. אם יש לך שאלות, אנא צור קשר.`;
  }
  if (input.locale === 'en') {
    return `Hello, ${input.firstName}! Your booking #${input.bookingNumber} for OS installation has been created. A technician is scheduled for ${when}. If you have questions, please contact us.`;
  }
  return `Здравствуйте, ${input.firstName}! Ваша заявка #${input.bookingNumber} на установку ОС успешно создана. Ожидайте техника ${when}. При возникновении вопросов свяжитесь с нами.`;
}

export async function sendOfficialSms(phone: string, message: string): Promise<boolean> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const configuredFrom = Deno.env.get('TWILIO_PHONE_NUMBER');
  if (!accountSid || !authToken || !configuredFrom) {
    console.error('sms_not_configured');
    return false;
  }

  let from = configuredFrom.trim();
  if (!from.startsWith('+')) {
    from = `+${from.replace(/\s+/g, '')}`;
  }

  const form = new FormData();
  form.append('From', from);
  form.append('To', phone);
  form.append('Body', message);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      body: form,
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      },
    },
  );

  if (!response.ok) {
    console.error('sms_provider_failed', { status: response.status });
    return false;
  }

  return true;
}
