export interface AuthUser {
  id: string;
  email: string | null;
}

/** Resolves the caller from the Authorization header (verify_jwt = false functions). */
export async function authUserFromRequest(req: Request): Promise<AuthUser | null> {
  const authorization = req.headers.get('Authorization');
  if (!authorization) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return null;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!response.ok) return null;

  const user = await response.json() as { id?: string; email?: string };
  if (!user.id) return null;
  return { id: user.id, email: typeof user.email === 'string' ? user.email : null };
}
