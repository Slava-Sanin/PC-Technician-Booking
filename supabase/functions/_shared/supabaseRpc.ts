export async function supabaseRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    console.error('missing_supabase_function_env');
    throw new Error('MISSING_SUPABASE_ENV');
  }

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(args),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error('rpc_failed', { name, status: response.status });
    throw new Error('RPC_FAILED');
  }

  if (!text) return null;
  return JSON.parse(text) as unknown;
}
