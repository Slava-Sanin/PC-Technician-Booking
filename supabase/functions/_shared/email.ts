export async function sendVerificationEmail(input: {
  to: string;
  subject: string;
  text: string;
  confirmUrl?: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('VERIFICATION_EMAIL_FROM') || 'onboarding@resend.dev';

  if (!apiKey) {
    console.error('email_not_configured');
    if (Deno.env.get('VERIFICATION_LOG_CODES') === 'true') {
      console.log('verification_email_fallback', { to: input.to, text: input.text, confirmUrl: input.confirmUrl });
    }
    return Deno.env.get('VERIFICATION_LOG_CODES') === 'true';
  }

  const html = input.confirmUrl
    ? `<p>${input.text}</p><p><a href="${input.confirmUrl}">${input.confirmUrl}</a></p>`
    : `<p>${input.text}</p>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.confirmUrl ? `${input.text}\n\n${input.confirmUrl}` : input.text,
      html,
    }),
  });

  if (!response.ok) {
    console.error('email_provider_failed', { status: response.status });
    return false;
  }

  return true;
}
