DO $$
BEGIN
  CREATE TYPE public.verification_purpose AS ENUM ('customer_registration', 'booking_confirmation');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.verification_channel AS ENUM ('email', 'sms');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  login_email text NOT NULL UNIQUE,
  email text,
  phone text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT customers_email_format CHECK (
    email IS NULL OR email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique_idx
  ON public.customers (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique_idx
  ON public.customers (phone)
  WHERE phone IS NOT NULL;

DROP TRIGGER IF EXISTS update_customers_updated_at ON public.customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_customer_id_idx ON public.bookings (customer_id);

CREATE TABLE IF NOT EXISTS public.verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose public.verification_purpose NOT NULL,
  channel public.verification_channel NOT NULL,
  target text NOT NULL,
  code_hash text,
  token_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_challenges_target_idx
  ON public.verification_challenges (purpose, target, created_at DESC);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_challenges ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_customer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customers AS customer
    WHERE customer.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_customer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_customer() TO authenticated, service_role;

DROP POLICY IF EXISTS "Customers read own profile" ON public.customers;
CREATE POLICY "Customers read own profile"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Customers update own profile" ON public.customers;
CREATE POLICY "Customers update own profile"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.customers FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.customers TO authenticated;

REVOKE ALL ON TABLE public.verification_challenges FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Customers read own bookings" ON public.bookings;
CREATE POLICY "Customers read own bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    customer_id IS NOT NULL
    AND customer_id IN (
      SELECT customer.id FROM public.customers AS customer WHERE customer.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Customers update own bookings" ON public.bookings;
CREATE POLICY "Customers update own bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    deleted_at IS NULL
    AND status NOT IN ('completed', 'cancelled', 'no_show', 'payment_expired')
    AND customer_id IN (
      SELECT customer.id FROM public.customers AS customer WHERE customer.user_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT customer.id FROM public.customers AS customer WHERE customer.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.issue_verification_challenge(
  p_purpose public.verification_purpose,
  p_channel public.verification_channel,
  p_target text,
  p_code_hash text,
  p_token_hash text,
  p_payload jsonb,
  p_customer_id uuid,
  p_ttl_minutes integer DEFAULT 15
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_target IS NULL OR char_length(trim(p_target)) < 3 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  INSERT INTO public.verification_challenges (
    purpose, channel, target, code_hash, token_hash, payload, customer_id, expires_at
  ) VALUES (
    p_purpose,
    p_channel,
    lower(trim(p_target)),
    p_code_hash,
    p_token_hash,
    coalesce(p_payload, '{}'::jsonb),
    p_customer_id,
    now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 15), 5))
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_verification_challenge(
  p_id uuid,
  p_code_hash text DEFAULT NULL,
  p_token_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.verification_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.verification_challenges
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF v_row.verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERIFICATION_EXPIRED');
  END IF;

  IF v_row.attempt_count >= v_row.max_attempts THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERIFICATION_LOCKED');
  END IF;

  UPDATE public.verification_challenges
  SET attempt_count = attempt_count + 1
  WHERE id = p_id;

  IF p_code_hash IS NOT NULL AND v_row.code_hash IS NOT NULL AND p_code_hash = v_row.code_hash THEN
    UPDATE public.verification_challenges
    SET verified_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object(
      'ok', true,
      'purpose', v_row.purpose,
      'payload', v_row.payload,
      'customerId', v_row.customer_id,
      'channel', v_row.channel,
      'target', v_row.target
    );
  END IF;

  IF p_token_hash IS NOT NULL AND v_row.token_hash IS NOT NULL AND p_token_hash = v_row.token_hash THEN
    UPDATE public.verification_challenges
    SET verified_at = now()
    WHERE id = p_id;
    RETURN jsonb_build_object(
      'ok', true,
      'purpose', v_row.purpose,
      'payload', v_row.payload,
      'customerId', v_row.customer_id,
      'channel', v_row.channel,
      'target', v_row.target
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'VERIFICATION_INVALID');
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_customer_for_login(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identifier text := lower(trim(coalesce(p_identifier, '')));
  v_row public.customers%ROWTYPE;
BEGIN
  IF v_identifier = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF position('@' in v_identifier) > 0 THEN
    SELECT * INTO v_row FROM public.customers WHERE lower(email) = v_identifier LIMIT 1;
  ELSE
    SELECT * INTO v_row FROM public.customers WHERE phone = public.normalize_phone(v_identifier) LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDENTIALS');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'loginEmail', v_row.login_email,
    'customerId', v_row.id,
    'firstName', v_row.first_name,
    'lastName', v_row.last_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_by_user_id(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN customer.id IS NULL THEN jsonb_build_object('ok', false)
    ELSE jsonb_build_object(
      'ok', true,
      'id', customer.id,
      'email', customer.email,
      'phone', customer.phone,
      'firstName', customer.first_name,
      'lastName', customer.last_name,
      'emailVerified', customer.email_verified_at IS NOT NULL,
      'phoneVerified', customer.phone_verified_at IS NOT NULL
    )
  END
  FROM public.customers AS customer
  WHERE customer.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.issue_verification_challenge(public.verification_purpose, public.verification_channel, text, text, text, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_verification_challenge(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lookup_customer_for_login(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_by_user_id(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_verification_challenge(public.verification_purpose, public.verification_channel, text, text, text, jsonb, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_verification_challenge(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_customer_for_login(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_by_user_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO service_role;

GRANT ALL ON TABLE public.customers TO service_role;
GRANT ALL ON TABLE public.verification_challenges TO service_role;
