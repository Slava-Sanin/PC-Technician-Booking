-- Allow active staff to add a customer profile on the same auth.users account.

CREATE OR REPLACE FUNCTION public.check_customer_registration_eligibility(
  p_email text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := public.normalize_phone(p_phone);
  v_user_id uuid;
  v_link_staff boolean := false;
BEGIN
  IF v_email <> '' AND EXISTS (
    SELECT 1 FROM public.customers AS customer WHERE lower(customer.email) = v_email
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.customers AS customer WHERE customer.phone = v_phone
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
  END IF;

  IF v_email <> '' THEN
    SELECT users.id INTO v_user_id
    FROM auth.users AS users
    WHERE lower(users.email) = v_email
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.customers AS customer WHERE customer.user_id = v_user_id
      ) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        WHERE profile.user_id = v_user_id
          AND profile.active = true
          AND profile.role IN ('admin'::public.staff_role, 'technician'::public.staff_role)
      ) THEN
        v_link_staff := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'linkExistingStaffAuth', v_link_staff
  );
END;
$$;
