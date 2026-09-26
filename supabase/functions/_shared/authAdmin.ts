export async function createAuthUser(email: string, password: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('MISSING_SUPABASE_ENV');
  }

  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });

  if (response.ok) {
    const payload = await response.json() as { id?: string };
    if (!payload.id) throw new Error('AUTH_USER_CREATE_FAILED');
    return payload.id;
  }

  const payload = await response.json().catch(() => null) as { msg?: string; message?: string } | null;
  const message = payload?.msg || payload?.message || '';
  if (message.toLowerCase().includes('already')) {
    throw new Error('ALREADY_REGISTERED');
  }
  throw new Error('AUTH_USER_CREATE_FAILED');
}

export async function signInWithPassword(email: string, password: string): Promise<Record<string, unknown>> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('MISSING_SUPABASE_ENV');
  }

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error('INVALID_CREDENTIALS');
  }

  return await response.json() as Record<string, unknown>;
}
