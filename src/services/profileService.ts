import { supabase } from '../lib/supabase';
import type { StaffProfile } from '../types/bookingSettings';

interface ProfileRow {
  user_id: string;
  role: 'admin' | 'technician';
  active: boolean;
  subscription_exempt?: boolean | null;
}

export async function fetchMyProfile(): Promise<StaffProfile | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, role, active, subscription_exempt')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as ProfileRow;
  if (row.role !== 'admin' && row.role !== 'technician') return null;

  return {
    userId: row.user_id,
    role: row.role,
    active: row.active,
    subscriptionExempt: row.subscription_exempt === true,
  };
}

export function isActiveStaff(profile: StaffProfile | null): boolean {
  return Boolean(profile && profile.active && (profile.role === 'admin' || profile.role === 'technician'));
}

/** Technicians need a paid subscription unless exempted; administrators never do. */
export function needsSubscription(profile: StaffProfile | null): boolean {
  return Boolean(profile && profile.active && profile.role === 'technician' && !profile.subscriptionExempt);
}
