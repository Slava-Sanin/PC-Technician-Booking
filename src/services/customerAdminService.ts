import { supabase } from '../lib/supabase';
import type { AdminCustomer } from '../types/customer';

export async function fetchAdminCustomers(): Promise<AdminCustomer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select(
      'id, user_id, login_email, email, phone, first_name, last_name, email_verified_at, phone_verified_at, created_at, updated_at',
    )
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as AdminCustomer[];
}
