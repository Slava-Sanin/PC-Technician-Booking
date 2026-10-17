export interface AdminCustomer {
  id: string;
  user_id: string;
  login_email: string;
  email: string | null;
  phone: string | null;
  first_name: string;
  last_name: string;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  created_at: string;
  updated_at: string;
}
