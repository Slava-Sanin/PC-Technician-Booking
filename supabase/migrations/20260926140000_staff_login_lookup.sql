CREATE OR REPLACE FUNCTION public.lookup_staff_for_login(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
  v_role public.staff_role;
  v_login_email text;
BEGIN
  IF v_email = '' OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT profile.user_id, profile.role, users.email
  INTO v_user_id, v_role, v_login_email
  FROM public.profiles AS profile
  JOIN auth.users AS users ON users.id = profile.user_id
  WHERE profile.active = true
    AND profile.role IN ('admin'::public.staff_role, 'technician'::public.staff_role)
    AND (
      lower(coalesce(profile.email, '')) = v_email
      OR lower(users.email) = v_email
    )
  LIMIT 1;

  IF NOT FOUND OR v_login_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDENTIALS');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'loginEmail', lower(v_login_email),
    'userId', v_user_id,
    'role', v_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_staff_for_login(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_staff_for_login(text) TO service_role;
