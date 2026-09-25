CREATE OR REPLACE FUNCTION public.admin_set_staff(
  p_email text,
  p_role text,
  p_active boolean
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

  INSERT INTO public.profiles (user_id, role, active, email)
  VALUES (v_user_id, p_role::public.staff_role, p_active, v_email)
  ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, active = EXCLUDED.active, email = EXCLUDED.email;

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'role', p_role, 'active', p_active);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_set_staff failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;
