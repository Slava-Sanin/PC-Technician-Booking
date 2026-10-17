import { supabase } from '../lib/supabase';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

async function invokeStaffAuth<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-auth', { body });

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

  return data as T;
}

interface SessionPayload {
  session?: { access_token?: string; refresh_token?: string };
  subscriptionRequired?: boolean;
  loginRequired?: boolean;
}

async function applySession(payload: SessionPayload): Promise<boolean> {
  if (!payload.session?.access_token || !payload.session.refresh_token) return false;
  const { error } = await supabase.auth.setSession({
    access_token: payload.session.access_token,
    refresh_token: payload.session.refresh_token,
  });
  if (error) throw new BookingApiError('INTERNAL_ERROR');
  return true;
}

export interface StaffLoginResult {
  subscriptionRequired: boolean;
}

export async function loginStaff(email: string, password: string): Promise<StaffLoginResult> {
  const payload = await invokeStaffAuth<SessionPayload>({ action: 'login', email, password });
  const applied = await applySession(payload);
  if (!applied) throw new BookingApiError('INTERNAL_ERROR');
  return { subscriptionRequired: payload.subscriptionRequired === true };
}

export interface TechnicianRegistrationStart {
  challengeId: string;
  maskedTarget: string;
  linkExistingAuth: boolean;
}

export async function registerTechnicianStart(input: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
}): Promise<TechnicianRegistrationStart> {
  const payload = await invokeStaffAuth<{ challengeId?: string; maskedTarget?: string; linkExistingAuth?: boolean }>({
    action: 'registerStart',
    ...input,
  });
  if (!payload.challengeId) throw new BookingApiError('INTERNAL_ERROR');
  return {
    challengeId: payload.challengeId,
    maskedTarget: payload.maskedTarget ?? input.email,
    linkExistingAuth: payload.linkExistingAuth === true,
  };
}

export interface TechnicianRegistrationResult {
  sessionStarted: boolean;
}

export async function registerTechnicianVerify(input: {
  challengeId: string;
  code?: string;
  token?: string;
}): Promise<TechnicianRegistrationResult> {
  const payload = await invokeStaffAuth<SessionPayload>({ action: 'registerVerify', ...input });
  const sessionStarted = await applySession(payload);
  return { sessionStarted };
}
