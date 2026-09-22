export type SmsLocale = 'ru' | 'he' | 'en';

function formatSmsDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}

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
  const when = `${formatSmsDate(input.appointmentDate)} ${input.appointmentTime}`;
  if (input.locale === 'he') {
    return `שלום, ${input.firstName}! ההזמנה שלך #${input.bookingNumber} לטכנאי מחשבים נוצרה. הפגישה נקבעה ל-${when}. אם יש שאלות, אנא צרו קשר.`;
  }
  if (input.locale === 'en') {
    return `Hello, ${input.firstName}! Your booking #${input.bookingNumber} for a computer technician is confirmed for ${when}. If you have questions, please contact us.`;
  }
  return `Здравствуйте, ${input.firstName}! Заявка #${input.bookingNumber} на заказ компьютерного техника создана. Визит назначен на ${when}. Если есть вопросы, свяжитесь с нами.`;
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
