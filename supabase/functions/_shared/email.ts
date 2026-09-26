import { Resend } from 'npm:resend@4.0.1';

export async function sendVerificationEmail(input: {
  to: string;
  subject: string;
  text: string;
  confirmUrl?: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('VERIFICATION_EMAIL_FROM') || 'onboarding@resend.dev';

  if (!apiKey) {
    if (Deno.env.get('VERIFICATION_LOG_CODES') === 'true') {
      console.warn('verification_email_dev_mode', {
        to: input.to,
        subject: input.subject,
        body: input.text,
        confirmUrl: input.confirmUrl ?? null,
        hint: 'Resend не настроен: код выше. Supabase → Edge Functions → Logs (customer-auth / create-booking).',
      });
      return true;
    }
    console.error('email_not_configured');
    return false;
  }

  const html = input.confirmUrl
    ? `<p>${input.text}</p><p><a href="${input.confirmUrl}">${input.confirmUrl}</a></p>`
    : `<p>${input.text}</p>`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    text: input.confirmUrl ? `${input.text}\n\n${input.confirmUrl}` : input.text,
    html,
  });

  if (error) {
    console.error('email_provider_failed', { message: error.message, name: error.name });
    return false;
  }

  return true;
}
