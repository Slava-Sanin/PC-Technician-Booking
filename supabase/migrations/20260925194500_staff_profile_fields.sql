ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text;

DROP FUNCTION IF EXISTS public.admin_set_staff(text, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_set_staff(
  p_email text,
  p_role text,
  p_active boolean,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_other_admins integer;
  v_first_name text;
  v_last_name text;
  v_phone text;
  v_address text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR p_role NOT IN ('admin', 'technician')
     OR p_active IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_first_name := nullif(left(trim(coalesce(p_first_name, '')), 120), '');
  v_last_name := nullif(left(trim(coalesce(p_last_name, '')), 120), '');
  v_phone := nullif(left(trim(coalesce(p_phone, '')), 32), '');
  v_address := nullif(left(trim(coalesce(p_address, '')), 500), '');

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = v_email;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STAFF_USER_NOT_FOUND');
  END IF;

  SELECT count(*)::integer INTO v_other_admins
  FROM public.profiles
  WHERE role = 'admin' AND active = true AND user_id <> v_user_id;

  IF v_other_admins = 0 AND (p_role <> 'admin' OR p_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  INSERT INTO public.profiles (user_id, role, active, email, first_name, last_name, phone, address)
  VALUES (v_user_id, p_role::public.staff_role, p_active, v_email, v_first_name, v_last_name, v_phone, v_address)
  ON CONFLICT (user_id) DO UPDATE
  SET
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    email = EXCLUDED.email,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address;

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'role', p_role, 'active', p_active);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_set_staff failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff(text, text, boolean, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff(text, text, boolean, text, text, text, text) TO authenticated;
