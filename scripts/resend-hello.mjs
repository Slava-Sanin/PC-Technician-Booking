/**
 * Локальная проверка Resend (аналог quickstart из документации).
 *
 *   set RESEND_API_KEY=re_xxxxxxxxx   ← замените на свой ключ
 *   npm run email:test
 */
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey || apiKey === 're_xxxxxxxxx') {
  console.error(
    'Задайте RESEND_API_KEY: замените re_xxxxxxxxx на ключ из https://resend.com/api-keys',
  );
  process.exit(1);
}

const resend = new Resend(apiKey);

const { data, error } = await resend.emails.send({
  from: process.env.VERIFICATION_EMAIL_FROM || 'onboarding@resend.dev',
  to: process.env.RESEND_TEST_TO || 'slava.sanin@gmail.com',
  subject: 'Hello World',
  html: '<p>Congrats on sending your <strong>first email</strong>!</p>',
});

if (error) {
  console.error(error);
  process.exit(1);
}

console.log('Sent:', data);
