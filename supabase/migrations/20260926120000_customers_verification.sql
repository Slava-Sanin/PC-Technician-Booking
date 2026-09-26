-- Customers, verification challenges, and booking confirmation flow.

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

DROP FUNCTION IF EXISTS public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text);

-- The previous catalog RPC still rejected onsite bookings without a city.

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_city text,
  p_service_mode text,
  p_device_type text,
  p_operating_system text,
  p_device_brand text,
  p_device_model text,
  p_problem_description text,
  p_comments text,
  p_appointment_date text,
  p_appointment_time text,
  p_service_ids uuid[],
  p_payment_method_code text,
  p_automatic_ready boolean,
  p_source_hash text,
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.booking_settings%ROWTYPE;
  v_hours public.working_hours%ROWTYPE;
  v_method public.payment_methods%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_first text;
  v_last text;
  v_phone text;
  v_email text;
  v_address text;
  v_city text;
  v_comments text;
  v_problem text;
  v_brand text;
  v_model text;
  v_os text;
  v_device text;
  v_mode text;
  v_date date;
  v_time time;
  v_local timestamp;
  v_start timestamptz;
  v_end timestamptz;
  v_end_local timestamp;
  v_today date;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_line_total numeric;
  v_duration integer := 0;
  v_total numeric;
  v_currency text;
  v_requires_device boolean := false;
  v_requires_os boolean := false;
  v_requires_payment boolean := false;
  v_optional_payment boolean := false;
  v_method_code text;
  v_payment_status text;
  v_status public.booking_status;
  v_expires timestamptz;
  v_phone_hash text;
  v_limit_code text;
  v_count integer;
  v_distinct integer;
  v_id uuid;
  v_number text;
  v_payment_id uuid;
  v_attempt integer;
  v_inserted boolean := false;
  v_bank jsonb;
  v_external_url text;
  v_offset numeric;
  v_customer_id uuid;
BEGIN
  v_first := trim(coalesce(p_first_name, ''));
  v_last := trim(coalesce(p_last_name, ''));
  v_address := trim(coalesce(p_address, ''));
  v_city := trim(coalesce(p_city, ''));
  v_comments := trim(coalesce(p_comments, ''));
  v_problem := trim(coalesce(p_problem_description, ''));
  v_brand := trim(coalesce(p_device_brand, ''));
  v_model := trim(coalesce(p_device_model, ''));
  v_email := trim(coalesce(p_email, ''));
  v_mode := lower(trim(coalesce(p_service_mode, '')));
  v_device := lower(trim(coalesce(p_device_type, '')));
  v_os := lower(trim(coalesce(p_operating_system, '')));
  IF v_os = '' THEN
    v_os := 'not_applicable';
  END IF;

  IF char_length(v_first) < 1 OR char_length(v_first) > 80
     OR char_length(v_last) < 1 OR char_length(v_last) > 80
     OR char_length(v_address) < 1 OR char_length(v_address) > 200
     OR char_length(v_city) > 80
     OR char_length(v_comments) > 1000
     OR char_length(v_problem) > 2000
     OR char_length(v_brand) > 80
     OR char_length(v_model) > 80
     OR char_length(v_email) > 120
     OR v_mode NOT IN ('onsite', 'remote', 'workshop')
     OR v_os NOT IN ('windows', 'macos', 'linux', 'chromeos', 'other', 'unknown', 'not_applicable')
     OR (v_email <> '' AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (v_device <> '' AND v_device NOT IN (
       'desktop', 'laptop', 'mac', 'server', 'printer', 'router', 'nas', 'smart_home', 'smartphone', 'other'
     ))
     OR p_service_ids IS NULL
     OR cardinality(p_service_ids) < 1
     OR cardinality(p_service_ids) > 12 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_phone := public.normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_customer_id := p_customer_id;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers AS customer WHERE customer.id = v_customer_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF p_appointment_date IS NULL OR p_appointment_time IS NULL
     OR p_appointment_date !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_appointment_time !~ '^\d{2}:\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  BEGIN
    v_date := p_appointment_date::date;
    v_time := p_appointment_time::time;
  EXCEPTION
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END;

  IF to_char(v_date, 'YYYY-MM-DD') <> p_appointment_date
     OR to_char(v_time, 'HH24:MI') <> p_appointment_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT count(*)::integer, count(DISTINCT service_id)::integer
  INTO v_count, v_distinct
  FROM unnest(p_service_ids) AS service_id;

  IF v_count <> v_distinct THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pc-technician-booking-schedule')::bigint);

  SELECT * INTO v_settings FROM public.booking_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  FOR v_service IN
    SELECT service.*
    FROM public.services AS service
    JOIN public.service_categories AS category ON category.id = service.category_id
    WHERE service.id = ANY (p_service_ids)
      AND service.active
      AND service.archived_at IS NULL
      AND category.active
      AND category.archived_at IS NULL
  LOOP
    v_line_total := public.service_line_total(
      v_service.price_type,
      v_service.price,
      v_service.default_duration_minutes,
      1
    );
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'serviceId', v_service.id,
      'name', jsonb_build_object('ru', v_service.name_ru, 'he', v_service.name_he, 'en', v_service.name_en),
      'duration', v_service.default_duration_minutes,
      'unitPrice', v_service.price,
      'priceType', v_service.price_type,
      'total', v_line_total,
      'currency', v_service.currency,
      'onsite', v_service.onsite_available,
      'remote', v_service.remote_available,
      'workshop', v_service.workshop_available,
      'requiresDevice', v_service.requires_device,
      'requiresOs', v_service.requires_operating_system,
      'paymentPolicy', v_service.payment_policy
    ));
  END LOOP;

  IF jsonb_array_length(v_lines) <> v_distinct THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SERVICE_UNAVAILABLE');
  END IF;

  IF v_mode = 'onsite' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE (line->>'onsite')::boolean IS DISTINCT FROM true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SERVICE_MODE');
  END IF;

  IF v_mode = 'remote' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE (line->>'remote')::boolean IS DISTINCT FROM true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SERVICE_MODE');
  END IF;

  IF v_mode = 'workshop' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE (line->>'workshop')::boolean IS DISTINCT FROM true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SERVICE_MODE');
  END IF;

  SELECT COALESCE(sum((line->>'duration')::integer), 0)::integer
  INTO v_duration
  FROM jsonb_array_elements(v_lines) AS line;

  SELECT sum((line->>'total')::numeric)
  INTO v_total
  FROM jsonb_array_elements(v_lines) AS line
  WHERE line->>'total' IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE line->>'total' IS NOT NULL
  ) THEN
    v_total := NULL;
  END IF;

  SELECT min(line->>'currency') INTO v_currency FROM jsonb_array_elements(v_lines) AS line;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE line->>'currency' IS DISTINCT FROM v_currency
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT bool_or((line->>'requiresDevice')::boolean), bool_or((line->>'requiresOs')::boolean)
  INTO v_requires_device, v_requires_os
  FROM jsonb_array_elements(v_lines) AS line;

  IF v_requires_device AND v_device = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF v_requires_os AND v_os IN ('not_applicable', '') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE line->>'paymentPolicy' IN ('required_before_booking', 'deposit')
  ), EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line
    WHERE line->>'paymentPolicy' = 'optional'
  )
  INTO v_requires_payment, v_optional_payment;

  v_method_code := nullif(lower(trim(coalesce(p_payment_method_code, ''))), '');
  IF NOT v_requires_payment AND NOT v_optional_payment THEN
    v_method_code := NULL;
  END IF;
  IF v_requires_payment AND v_method_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_REQUIRED');
  END IF;

  IF v_method_code IS NOT NULL THEN
    SELECT * INTO v_method
    FROM public.payment_methods
    WHERE code = v_method_code AND active = true AND archived_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_lines) AS line
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.service_payment_methods AS link
        WHERE link.service_id = (line->>'serviceId')::uuid
          AND link.payment_method_id = v_method.id
          AND link.enabled
      )
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
    END IF;

    v_external_url := v_method.external_url;

    IF v_method.integration_type = 'automatic' AND COALESCE(p_automatic_ready, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
    END IF;

    IF v_total IS NULL OR v_total <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
    END IF;
  END IF;

  v_local := v_date + v_time;
  v_start := v_local AT TIME ZONE v_settings.timezone;
  v_end := v_start + make_interval(mins => v_duration);
  v_end_local := v_end AT TIME ZONE v_settings.timezone;

  IF (v_start AT TIME ZONE v_settings.timezone)::date IS DISTINCT FROM v_date
     OR to_char((v_start AT TIME ZONE v_settings.timezone)::time, 'HH24:MI') IS DISTINCT FROM to_char(v_time, 'HH24:MI') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_today := (now() AT TIME ZONE v_settings.timezone)::date;
  IF v_date > v_today + 730 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;
  IF v_date < v_today OR v_start <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DATE_IN_PAST');
  END IF;

  SELECT * INTO v_hours
  FROM public.working_hours
  WHERE weekday = EXTRACT(DOW FROM v_date)::smallint;

  IF NOT FOUND OR NOT v_hours.enabled THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISABLED_WEEKDAY');
  END IF;

  IF EXISTS (SELECT 1 FROM public.booking_disabled_dates AS disabled WHERE disabled.disabled_date = v_date) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISABLED_DATE');
  END IF;

  v_offset := EXTRACT(EPOCH FROM (v_time - v_hours.start_time));
  IF v_time < v_hours.start_time
     OR v_end_local::date IS DISTINCT FROM v_date
     OR v_end_local::time > v_hours.end_time
     OR v_offset < 0
     OR mod(v_offset, (v_settings.slot_step_minutes * 60)::numeric) <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_WORKING_HOURS');
  END IF;

  v_phone_hash := encode(extensions.digest(convert_to(v_phone, 'UTF8'), 'sha256'), 'hex');
  v_limit_code := public.enforce_booking_rate_limit(v_phone_hash, NULLIF(trim(coalesce(p_source_hash, '')), ''));
  IF v_limit_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', v_limit_code);
  END IF;

  PERFORM public.expire_stale_payment_holds();

  IF public.booking_range_conflicts(v_start, v_end, v_settings.buffer_minutes) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
  END IF;

  IF v_settings.max_bookings_per_day IS NOT NULL THEN
    v_count := public.blocking_bookings_on_date(v_date, v_settings.timezone);
    IF v_count >= v_settings.max_bookings_per_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT_REACHED');
    END IF;
  END IF;

  IF v_method_code IS NOT NULL THEN
    v_status := 'pending_payment';
    v_payment_status := CASE
      WHEN v_method.integration_type = 'automatic' THEN 'pending'
      ELSE 'awaiting_verification'
    END;
    v_expires := now() + make_interval(mins => v_settings.payment_hold_minutes);
  ELSE
    v_status := 'new';
    v_payment_status := NULL;
    v_expires := NULL;
  END IF;

  FOR v_attempt IN 1..3 LOOP
    BEGIN
      INSERT INTO public.bookings (
        first_name, last_name, phone, email, address, city,
        operating_system, comments, problem_description,
        service_mode, device_type, device_brand, device_model,
        appointment_date, appointment_start, appointment_end,
        status, completed, subtotal, total_amount, currency,
        payment_status, payment_expires_at, customer_id
      ) VALUES (
        v_first, v_last, v_phone, NULLIF(v_email, ''), v_address, NULLIF(v_city, ''),
        v_os, NULLIF(v_comments, ''), NULLIF(v_problem, ''),
        v_mode, NULLIF(v_device, ''), NULLIF(v_brand, ''), NULLIF(v_model, ''),
        v_start, v_start, v_end,
        v_status, false, v_total, v_total, COALESCE(v_currency, 'ILS'),
        v_payment_status, v_expires, v_customer_id
      )
      RETURNING id, booking_number INTO v_id, v_number;

      v_inserted := true;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 3 THEN
          RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
        END IF;
    END;
  END LOOP;

  IF NOT v_inserted OR v_id IS NULL OR v_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO public.booking_services (
      booking_id, service_id, service_name_snapshot, duration_minutes,
      unit_price, price_type_snapshot, quantity, total_price, currency
    ) VALUES (
      v_id,
      (v_line->>'serviceId')::uuid,
      v_line->'name',
      (v_line->>'duration')::integer,
      (v_line->>'unitPrice')::numeric,
      v_line->>'priceType',
      1,
      (v_line->>'total')::numeric,
      v_line->>'currency'
    );
  END LOOP;

  INSERT INTO public.booking_history (booking_id, action, old_data, new_data, changed_by)
  VALUES (v_id, 'services_changed', NULL, jsonb_build_object('services', v_lines), auth.uid());

  IF v_method_code IS NOT NULL THEN
    INSERT INTO public.payments (
      booking_id, payment_method_id, provider, amount, currency, status, expires_at
    ) VALUES (
      v_id,
      v_method.id,
      v_method.code,
      v_total,
      COALESCE(v_currency, 'ILS'),
      v_payment_status,
      v_expires
    )
    RETURNING id INTO v_payment_id;
  END IF;

  INSERT INTO public.booking_rate_limits (subject_hash, limit_kind)
  VALUES (v_phone_hash, 'phone_success');

  v_bank := NULL;
  IF v_method_code = 'bank_transfer' THEN
    SELECT jsonb_build_object(
      'bankName', bank.bank_name,
      'branch', bank.branch,
      'account', bank.account_number,
      'beneficiary', bank.beneficiary,
      'iban', bank.iban,
      'instructions', jsonb_build_object('ru', bank.instructions_ru, 'he', bank.instructions_he, 'en', bank.instructions_en)
    )
    INTO v_bank
    FROM public.bank_transfer_profiles AS bank
    WHERE bank.id = 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'bookingId', v_id,
    'bookingNumber', v_number,
    'appointmentDate', to_char(v_date, 'YYYY-MM-DD'),
    'appointmentTime', to_char(v_time, 'HH24:MI'),
    'durationMinutes', v_duration,
    'firstName', v_first,
    'phone', v_phone,
    'sendSms', v_settings.send_sms,
    'status', v_status,
    'currency', COALESCE(v_currency, 'ILS'),
    'totalAmount', v_total,
    'paymentRequired', v_requires_payment,
    'paymentStatus', v_payment_status,
    'paymentExpiresAt', v_expires,
    'paymentId', v_payment_id,
    'paymentMethodCode', v_method_code,
    'externalUrl', v_external_url,
    'bankInstructions', v_bank
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_booking_atomic failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text, uuid) TO service_role;
