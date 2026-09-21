async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sourceHash(request: Request): Promise<string | null> {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  if (!ip) return null;

  const pepper = Deno.env.get('RATE_LIMIT_PEPPER') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!pepper) return null;

  return sha256(`${pepper}:ip:${ip}`);
}
