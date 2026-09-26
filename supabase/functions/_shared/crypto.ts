async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashVerificationSecret(value: string): Promise<string> {
  const pepper = Deno.env.get('VERIFICATION_PEPPER') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return sha256(`${pepper}:v1:${value}`);
}

export function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => (byte % 10).toString()).join('');
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return '***';
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
