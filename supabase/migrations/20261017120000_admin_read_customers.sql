-- Allow admins to list customer profiles in the admin UI.

DROP POLICY IF EXISTS "Admins read customers" ON public.customers;
CREATE POLICY "Admins read customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (public.is_admin());
