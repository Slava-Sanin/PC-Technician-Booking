import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.error('rejected_arbitrary_sms');
  return json({ error: 'FORBIDDEN' }, 403);
});
