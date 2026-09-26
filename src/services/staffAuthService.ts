import { supabase } from '../lib/supabase';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

export async function loginStaff(email: string, password: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('staff-auth', {
    body: { action: 'login', email, password },
  });

  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        const code = readErrorCode(payload);
        if (code) throw new BookingApiError(normalizeErrorCode(code));
      } catch (parseError) {
        if (parseError instanceof BookingApiError) throw parseError;
      }
    }
    const direct = readErrorCode(data);
    if (direct) throw new BookingApiError(normalizeErrorCode(direct));
    throw new BookingApiError('INTERNAL_ERROR');
  }

  const session = data as { session?: { access_token?: string; refresh_token?: string } };
  if (!session.session?.access_token || !session.session.refresh_token) {
    throw new BookingApiError('INTERNAL_ERROR');
  }

  const { error: setError } = await supabase.auth.setSession({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  });
  if (setError) throw new BookingApiError('INTERNAL_ERROR');
}
