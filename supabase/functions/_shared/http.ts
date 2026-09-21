export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function statusForCode(code: string): number {
  switch (code) {
    case 'INVALID_INPUT':
    case 'DATE_IN_PAST':
    case 'OUTSIDE_WORKING_HOURS':
    case 'DISABLED_DATE':
    case 'DISABLED_WEEKDAY':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'SLOT_UNAVAILABLE':
    case 'DAILY_LIMIT_REACHED':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}
